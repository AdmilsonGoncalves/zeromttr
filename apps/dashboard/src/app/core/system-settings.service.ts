import { Injectable, signal } from '@angular/core';
import { isNonEmptyString, toErrorMessage } from '@zeromttr/utils';
import { CONTENT_TYPE, HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import type {
  SettingsAuditEntry,
  SystemSettings,
  SystemSettingsPatch,
  SystemSettingsReadonlyInfo,
  SystemSettingsResponse
} from './contract.js';

export interface SaveSettingsResult {
  ok: boolean;
  statusCode: number;
  errorCode?: string;
  error?: string;
}

/**
 * Reactive Signals service fetching and persisting runtime system settings and SQLite audit logs.
 */
@Injectable({ providedIn: 'root' })
export class SystemSettingsService {
  readonly settings = signal<SystemSettings | null>(null);
  readonly readonlyInfo = signal<SystemSettingsReadonlyInfo | null>(null);
  readonly editable = signal<boolean>(true);
  readonly requiresAuthKey = signal<boolean>(false);
  readonly auditLog = signal<SettingsAuditEntry[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isSaving = signal<boolean>(false);
  readonly lastError = signal<string | null>(null);

  private requestSeq = 0;
  private activeFetchCount = 0;

  /**
   * Loads the current runtime settings, read-only metadata, and recent SQLite audit entries.
   */
  async fetchSettings(baseUrl = ''): Promise<boolean> {
    const seq = ++this.requestSeq;
    this.activeFetchCount += 1;
    this.isLoading.set(true);
    this.lastError.set(null);

    try {
      const response = await fetch(`${baseUrl}/api/settings`);
      if (!response.ok) {
        if (seq === this.requestSeq) {
          this.lastError.set(`HTTP ${response.status}`);
        }
        return false;
      }

      const data = (await response.json()) as SystemSettingsResponse;
      if (seq !== this.requestSeq) {
        return false;
      }
      this.applyResponse(data);
      return true;
    } catch (err) {
      if (seq === this.requestSeq) {
        this.lastError.set(toErrorMessage(err));
      }
      return false;
    } finally {
      this.activeFetchCount = Math.max(0, this.activeFetchCount - 1);
      if (this.activeFetchCount === 0) {
        this.isLoading.set(false);
      }
    }
  }

  /**
   * Sends a partial settings update via `PATCH /api/settings` and refreshes the SQLite audit trail.
   */
  async saveSettings(
    patch: SystemSettingsPatch,
    authKey = '',
    baseUrl = ''
  ): Promise<SaveSettingsResult> {
    this.requestSeq += 1;
    this.isSaving.set(true);
    this.lastError.set(null);

    try {
      const headers: Record<string, string> = {
        [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON
      };
      if (isNonEmptyString(authKey)) {
        headers[HTTP_HEADERS.SETTINGS_ADMIN_TOKEN] = authKey.trim();
      }

      const response = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        let errorCode: string | undefined;
        try {
          const body = (await response.json()) as { error?: string; code?: string };
          if (isNonEmptyString(body?.error)) {
            errorMessage = body.error;
          }
          if (isNonEmptyString(body?.code)) {
            errorCode = body.code;
          }
        } catch {
          // Ignore non-JSON error body
        }
        this.lastError.set(errorMessage);
        return { ok: false, statusCode: response.status, errorCode, error: errorMessage };
      }

      const data = (await response.json()) as SystemSettingsResponse;
      this.applyResponse(data);
      return { ok: true, statusCode: HTTP_STATUS.OK };
    } catch (err) {
      const message = toErrorMessage(err);
      this.lastError.set(message);
      return { ok: false, statusCode: 0, error: message };
    } finally {
      this.isSaving.set(false);
    }
  }

  private applyResponse(data: SystemSettingsResponse): void {
    this.settings.set(data.settings);
    this.readonlyInfo.set(data.readonlyInfo);
    this.editable.set(data.editable);
    this.requiresAuthKey.set(data.requiresAuthKey);
    this.auditLog.set(data.auditLog ?? []);
  }
}
