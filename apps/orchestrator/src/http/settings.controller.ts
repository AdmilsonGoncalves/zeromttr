import { Router, type Request, type RequestHandler, type Response } from 'express';
import {
  SystemSettingsPatchSchema,
  type SystemSettings,
  type SystemSettingsReadonlyInfo,
  type SystemSettingsResponse
} from '@zeromttr/contracts';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { maskEmailForDisplay } from '../domain/system-settings.js';
import type { SettingsRepositoryPort } from '../ports/settings-repository.port.js';
import { createSettingsAdminMiddleware } from './auth.js';
import { SecurityErrorCode } from './http-constants.js';

export interface SettingsRouterDependencies {
  settingsRepository: SettingsRepositoryPort;
  dashboardAuthMiddleware: RequestHandler;
  readonlyInfo: SystemSettingsReadonlyInfo;
  editable?: boolean;
  requiresAuthKey?: boolean;
  adminToken?: string;
  writeAuthMiddleware?: RequestHandler;
  onSettingsUpdated?: (settings: SystemSettings) => void;
}

function buildSettingsResponse(
  settingsRepository: SettingsRepositoryPort,
  readonlyInfo: SystemSettingsReadonlyInfo,
  editable: boolean,
  requiresAuthKey: boolean
): SystemSettingsResponse {
  const current = settingsRepository.get();
  // Always mask onCallEmail on GET responses so PII is never exposed to unauthenticated viewers
  const safeSettings: SystemSettings = {
    ...current,
    onCallEmail: maskEmailForDisplay(current.onCallEmail)
  };

  return {
    settings: safeSettings,
    readonlyInfo,
    editable,
    requiresAuthKey,
    auditLog: settingsRepository.listAuditLog(25)
  };
}

/**
 * Express router exposing `GET /api/settings` and protected `PATCH /api/settings`.
 */
export function createSettingsRouter(dependencies: SettingsRouterDependencies): Router {
  const router = Router();
  const editable = dependencies.editable ?? true;
  const requiresAuthKey = dependencies.requiresAuthKey ?? false;

  const writeMiddlewares: RequestHandler[] = [dependencies.dashboardAuthMiddleware];
  if (dependencies.writeAuthMiddleware) {
    writeMiddlewares.push(dependencies.writeAuthMiddleware);
  } else if (requiresAuthKey) {
    writeMiddlewares.push(createSettingsAdminMiddleware(dependencies.adminToken));
  }

  router.get('/settings', dependencies.dashboardAuthMiddleware, (_req: Request, res: Response) => {
    const payload = buildSettingsResponse(
      dependencies.settingsRepository,
      dependencies.readonlyInfo,
      editable,
      requiresAuthKey
    );
    res.status(HTTP_STATUS.OK).json(payload);
  });

  router.patch('/settings', ...writeMiddlewares, (req: Request, res: Response) => {
    if (!editable) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        code: SecurityErrorCode.SETTINGS_READ_ONLY,
        error: 'System settings are read-only in this environment.'
      });
      return;
    }

    const parsed = SystemSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: 'Invalid system settings payload',
        details: parsed.error.format()
      });
      return;
    }

    const result = dependencies.settingsRepository.update(parsed.data, 'dashboard_operator');
    if (result.changes.length > 0) {
      dependencies.onSettingsUpdated?.(result.settings);
    }

    const payload = buildSettingsResponse(
      dependencies.settingsRepository,
      dependencies.readonlyInfo,
      editable,
      requiresAuthKey
    );
    res.status(HTTP_STATUS.OK).json(payload);
  });

  return router;
}
