import http from 'node:http';
import path from 'node:path';
import { SettingsPersistenceEngine } from '@zeromttr/contracts';
import { isEmpty, isNonEmptyString, parseNumber } from '@zeromttr/utils';
import { ConsoleJsonLogger } from './adapters/logger.console.js';
import { FileIncidentRepository } from './adapters/repo.file.js';
import { SqliteSettingsRepository } from './adapters/settings.sqlite.js';
import { createTargetStatusPort } from './adapters/target-status.prometheus.js';
import { McpClientAdapter } from './adapters/mcp.client.js';
import { DeterministicFallbackReasoningAdapter } from './adapters/llm.fallback.js';
import { GeminiReasoningAdapter } from './adapters/llm.gemini.js';
import { TypeScriptPatchSyntaxValidator } from './adapters/patch-syntax-validator.js';
import { createInitialIncident } from './application/create-initial-incident.js';
import { HandleAlert } from './application/handle-alert.js';
import { InvestigateIncident } from './application/investigate-incident.js';
import { EnrichWithDeployDiff } from './application/enrich-with-deploy-diff.js';
import { DispatchRemediation } from './application/dispatch-remediation.js';
import { NotifyOnCall } from './application/notify-on-call.js';
import { RecordDecision } from './application/record-decision.js';
import { OrchestratorWorkflow } from './application/orchestrator-workflow.js';
import { HttpDemoControlAdapter } from './demo/demo-control.http.js';
import { resolveDemoConfig } from './demo/demo-config.js';
import { ReplayRunner } from './demo/replay-runner.js';
import { SimulateDemoDecision } from './demo/simulate-demo-decision.js';
import { createDemoRouterFactory, createDemoSessionLifecycle } from './demo/demo.controller.js';
import { OrchestratorLogEvent } from './domain/log-enums.js';
import { resolveDefaultSystemSettings } from './domain/system-settings.js';
import { resolveTargetRepoUrl } from './domain/target-repo-url.js';
import { SystemClock } from './ports/clock.port.js';
import { createApp } from './http/app.js';
import { SseEventBroadcaster } from './http/events.sse.js';
import { createSettingsRouter } from './http/settings.controller.js';

interface BootCredentials {
  hmacSecret: string;
  dashboardUrl: string;
  onCallEmail?: string;
  grafanaWebhookToken?: string;
  dashboardApiToken?: string;
}

function validateAndResolveBootCredentials(isTest: boolean): BootCredentials {
  if (!isTest) {
    if (isEmpty(process.env.DECISION_HMAC_SECRET)) {
      throw new Error('FATAL: DECISION_HMAC_SECRET must be configured.');
    }
    if (isEmpty(process.env.GRAFANA_WEBHOOK_TOKEN)) {
      throw new Error('FATAL: GRAFANA_WEBHOOK_TOKEN must be configured.');
    }
    if (isEmpty(process.env.DASHBOARD_API_TOKEN)) {
      throw new Error('FATAL: DASHBOARD_API_TOKEN must be configured.');
    }
  }

  return {
    hmacSecret:
      process.env.DECISION_HMAC_SECRET || (isTest ? 'test-hmac-secret-zeromttr-2026' : ''),
    dashboardUrl: process.env.PUBLIC_DASHBOARD_URL || 'https://zeromttr.agjworks.com',
    onCallEmail: process.env.ON_CALL_ENGINEER_EMAIL || process.env.ONCALL_TO_EMAIL,
    grafanaWebhookToken: process.env.GRAFANA_WEBHOOK_TOKEN,
    dashboardApiToken: process.env.DASHBOARD_API_TOKEN
  };
}

function initializeSettingsAndLogger(isTest: boolean) {
  const defaultSettings = resolveDefaultSystemSettings(process.env);
  const logger = new ConsoleJsonLogger(defaultSettings.logLevel);
  const settingsDbPath =
    process.env.SETTINGS_DB_PATH ||
    (isTest ? ':memory:' : path.resolve(process.cwd(), 'var/zeromttr-settings.sqlite'));
  const settingsRepository = new SqliteSettingsRepository(settingsDbPath, defaultSettings, logger);
  const getSettings = () => settingsRepository.get();
  logger.setMinLevel(getSettings().logLevel);

  return { settingsRepository, getSettings, logger };
}

function createCoreAdapters(
  getSettings: () => ReturnType<SqliteSettingsRepository['get']>,
  logger: ConsoleJsonLogger
) {
  const repository = new FileIncidentRepository(process.env.INCIDENT_STORE_PATH, logger);
  const toolsPort = new McpClientAdapter();
  const targetStatusProvider = (process.env.TARGET_STATUS_PROVIDER || 'manifest')
    .trim()
    .toLowerCase();
  const targetStatusPort = createTargetStatusPort(toolsPort, {
    getErrorRateThreshold: () => getSettings().targetErrorRateThresholdPercent,
    getDiffRefs: () => {
      const current = getSettings();
      return {
        targetBaseRef: current.targetBaseRef,
        targetHeadRef: current.targetHeadRef
      };
    }
  });
  const fallbackAdapter = new DeterministicFallbackReasoningAdapter();
  const llmAdapter = new GeminiReasoningAdapter(undefined, undefined, {
    getModels: () => {
      const current = getSettings();
      return {
        modelName: current.llmModel,
        fallbackModelName: current.llmFallbackModel
      };
    }
  });
  const clock = new SystemClock();
  const broadcaster = new SseEventBroadcaster();

  return {
    repository,
    toolsPort,
    targetStatusProvider,
    targetStatusPort,
    fallbackAdapter,
    llmAdapter,
    clock,
    broadcaster
  };
}

function createDemoWiring(params: {
  repository: FileIncidentRepository;
  toolsPort: McpClientAdapter;
  targetStatusPort: ReturnType<typeof createTargetStatusPort>;
  targetStatusProvider: string;
  broadcaster: SseEventBroadcaster;
  logger: ConsoleJsonLogger;
}) {
  const demoConfig = resolveDemoConfig(process.env);
  if (!demoConfig.demoModeEnabled) {
    return {
      demoEnabled: false,
      demoLifecycle: undefined,
      demoRouter: undefined,
      replayRunner: undefined
    };
  }

  const demoControlPort = new HttpDemoControlAdapter();
  const replayRunner = new ReplayRunner(params.repository, params.broadcaster, {}, params.logger);
  const demoLifecycle = createDemoSessionLifecycle(
    demoControlPort,
    replayRunner,
    params.targetStatusPort,
    { passiveTarget: params.targetStatusProvider === 'prometheus' }
  );
  const simulateDemoDecision = new SimulateDemoDecision(
    params.repository,
    params.toolsPort,
    params.broadcaster,
    params.logger
  );

  const rawCooldown = process.env.DEMO_COOLDOWN_MS ?? process.env.SIMULATION_COOLDOWN_MS;
  const cooldownMs = isNonEmptyString(rawCooldown) ? parseNumber(rawCooldown, 120_000) : undefined;

  const demoRouter = createDemoRouterFactory({
    repository: params.repository,
    targetStatusPort: params.targetStatusPort,
    demoControlPort,
    simulateDemoDecision,
    replayRunner,
    lifecycle: demoLifecycle,
    liveDemoKey: process.env.LIVE_DEMO_KEY,
    requireDemoKey: demoConfig.requireDemoKey,
    publicLiveDemo: demoConfig.publicLiveDemo,
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
    cooldownMs
  });

  return { demoEnabled: true, demoLifecycle, demoRouter, replayRunner };
}

function createSettingsRouterFactory(params: {
  settingsRepository: SqliteSettingsRepository;
  logger: ConsoleJsonLogger;
  targetStatusProvider: string;
  demoEnabled: boolean;
}) {
  const readonlyInfo = {
    targetGithubRepo: resolveTargetRepoUrl(),
    targetBaseBranch: process.env.TARGET_BASE_BRANCH || 'release/target-v2.14.8',
    targetStatusProvider: params.targetStatusProvider,
    grafanaRepeatInterval: process.env.GRAFANA_ALERT_REPEAT_INTERVAL || '1m',
    persistenceEngine: SettingsPersistenceEngine.SQLITE
  };
  const adminToken = process.env.SETTINGS_ADMIN_TOKEN?.trim() || '';
  const hasAdminToken = isNonEmptyString(adminToken);
  // In demo mode without SETTINGS_ADMIN_TOKEN, settings stay strictly read-only for anonymous visitors.
  // When SETTINGS_ADMIN_TOKEN is set, it is always required to save (regardless of demo key settings).
  // In private deployments (ENABLE_DEMO_MODE=false) without a token, settings remain editable behind VPN/SSO.
  const editable = hasAdminToken || !params.demoEnabled;

  return {
    create: ({
      dashboardAuthMiddleware
    }: {
      dashboardAuthMiddleware: Parameters<
        typeof createSettingsRouter
      >[0]['dashboardAuthMiddleware'];
    }) =>
      createSettingsRouter({
        settingsRepository: params.settingsRepository,
        dashboardAuthMiddleware,
        readonlyInfo,
        editable,
        requiresAuthKey: hasAdminToken,
        adminToken,
        onSettingsUpdated: (updated) => {
          params.logger.setMinLevel(updated.logLevel);
        }
      })
  };
}

const GRACEFUL_SHUTDOWN_DEADLINE_MS = 10_000;

function attachGracefulShutdown(
  server: http.Server,
  broadcaster: SseEventBroadcaster,
  settingsRepository: SqliteSettingsRepository,
  replayRunner: ReplayRunner | undefined,
  isTest: boolean
): void {
  const originalClose = server.close.bind(server);
  server.close = ((callback?: (err?: Error) => void) => {
    // End active SSE streams and replay timers before waiting for Node's http.Server close event.
    replayRunner?.stop();
    broadcaster.close();
    return originalClose(callback);
  }) as http.Server['close'];

  let shutdownTimer: NodeJS.Timeout | undefined;
  const handleSignal = (): void => {
    server.close();
    shutdownTimer = setTimeout(() => {
      server.closeAllConnections?.();
    }, GRACEFUL_SHUTDOWN_DEADLINE_MS);
    shutdownTimer.unref();
  };

  if (!isTest) {
    process.once('SIGTERM', handleSignal);
    process.once('SIGINT', handleSignal);
  }

  server.once('close', () => {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = undefined;
    }
    if (!isTest) {
      process.off('SIGTERM', handleSignal);
      process.off('SIGINT', handleSignal);
    }
    replayRunner?.stop();
    broadcaster.close();
    settingsRepository.close();
  });
}

/**
 * Instantiates orchestrator adapters, use cases, Express app, and starts the HTTP server.
 */
export function bootstrap(port: number = parseNumber(process.env.PORT, 8080)): http.Server {
  const isTest = process.env.NODE_ENV === 'test';
  const credentials = validateAndResolveBootCredentials(isTest);
  const { settingsRepository, getSettings, logger } = initializeSettingsAndLogger(isTest);
  const adapters = createCoreAdapters(getSettings, logger);
  const { demoEnabled, demoLifecycle, demoRouter, replayRunner } = createDemoWiring({
    repository: adapters.repository,
    toolsPort: adapters.toolsPort,
    targetStatusPort: adapters.targetStatusPort,
    targetStatusProvider: adapters.targetStatusProvider,
    broadcaster: adapters.broadcaster,
    logger
  });

  const handleAlert = new HandleAlert(adapters.repository, adapters.broadcaster, getSettings);
  const investigateIncident = new InvestigateIncident(
    adapters.repository,
    adapters.toolsPort,
    adapters.targetStatusPort,
    adapters.broadcaster,
    logger
  );
  const enrichWithDeployDiff = new EnrichWithDeployDiff(
    adapters.repository,
    adapters.toolsPort,
    adapters.broadcaster,
    getSettings().targetServicePath,
    getSettings
  );
  const dispatchRemediation = new DispatchRemediation(
    adapters.repository,
    adapters.toolsPort,
    adapters.llmAdapter,
    adapters.fallbackAdapter,
    adapters.broadcaster,
    logger,
    { syntaxValidator: new TypeScriptPatchSyntaxValidator() }
  );
  const notifyOnCall = new NotifyOnCall(
    adapters.repository,
    adapters.toolsPort,
    adapters.clock,
    adapters.broadcaster,
    credentials.hmacSecret,
    credentials.dashboardUrl,
    logger,
    credentials.onCallEmail,
    getSettings
  );
  const recordDecision = new RecordDecision(
    adapters.repository,
    adapters.toolsPort,
    adapters.clock,
    adapters.broadcaster,
    credentials.hmacSecret,
    logger,
    demoLifecycle
      ? async (incident) => {
          if (getSettings().autoRestoreOnApprove) {
            await demoLifecycle.handleLiveIncidentApproved(incident);
          }
        }
      : undefined,
    demoLifecycle
      ? async (incident) => {
          if (!getSettings().autoRestoreOnApprove) {
            return false;
          }
          return demoLifecycle.retryPendingApprovalReset(incident);
        }
      : undefined
  );
  const orchestratorWorkflow = new OrchestratorWorkflow(
    adapters.repository,
    investigateIncident,
    enrichWithDeployDiff,
    dispatchRemediation,
    notifyOnCall,
    adapters.broadcaster,
    getSettings
  );

  const settingsRouter = createSettingsRouterFactory({
    settingsRepository,
    logger,
    targetStatusProvider: adapters.targetStatusProvider,
    demoEnabled
  });

  const app = createApp({
    repository: adapters.repository,
    targetStatusPort: adapters.targetStatusPort,
    handleAlert,
    orchestratorWorkflow,
    recordDecision,
    broadcaster: adapters.broadcaster,
    grafanaWebhookToken: credentials.grafanaWebhookToken,
    dashboardApiToken: credentials.dashboardApiToken,
    demoRouter,
    settingsRouter
  });

  const initialIncident = createInitialIncident();
  const server = http.createServer(app);
  attachGracefulShutdown(server, adapters.broadcaster, settingsRepository, replayRunner, isTest);

  server.listen(port, () => {
    logger.info({
      event: OrchestratorLogEvent.ORCHESTRATOR_INITIALIZED,
      state: initialIncident.state,
      port
    });
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
