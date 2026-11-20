import http from 'node:http';
import { isNonEmptyString, parseNumber } from '@zeromttr/utils';
import {
  ConsoleJsonLogger,
  FileIncidentRepository,
  HttpTargetStatusAdapter,
  McpClientAdapter,
  DeterministicFallbackReasoningAdapter,
  GeminiReasoningAdapter,
  TypeScriptPatchSyntaxValidator
} from './adapters/index.js';
import {
  createInitialIncident,
  HandleAlert,
  InvestigateIncident,
  EnrichWithDeployDiff,
  DispatchRemediation,
  NotifyOnCall,
  RecordDecision,
  OrchestratorWorkflow
} from './application/index.js';
import {
  HttpDemoControlAdapter,
  ReplayRunner,
  SimulateDemoDecision,
  createDemoRouterFactory
} from './demo/index.js';
import { OrchestratorLogEvent } from './domain/index.js';
import { SystemClock } from './ports/index.js';
import { createApp, SseEventBroadcaster } from './http/index.js';

export function bootstrap(port: number = parseNumber(process.env.PORT, 8080)): http.Server {
  const logger = new ConsoleJsonLogger();
  const repository = new FileIncidentRepository(process.env.INCIDENT_STORE_PATH, logger);
  const targetStatusPort = new HttpTargetStatusAdapter();
  const toolsPort = new McpClientAdapter();
  const fallbackAdapter = new DeterministicFallbackReasoningAdapter();
  const llmAdapter = new GeminiReasoningAdapter();
  const clock = new SystemClock();
  const broadcaster = new SseEventBroadcaster();

  const isTest = process.env.NODE_ENV === 'test';
  if (!isTest) {
    if (!process.env.DECISION_HMAC_SECRET) {
      throw new Error('FATAL: DECISION_HMAC_SECRET must be configured.');
    }
    if (!process.env.GRAFANA_WEBHOOK_TOKEN) {
      throw new Error('FATAL: GRAFANA_WEBHOOK_TOKEN must be configured.');
    }
    if (!process.env.DASHBOARD_API_TOKEN) {
      throw new Error('FATAL: DASHBOARD_API_TOKEN must be configured.');
    }
  }

  const hmacSecret =
    process.env.DECISION_HMAC_SECRET || (isTest ? 'test-hmac-secret-zeromttr-2026' : '');
  const dashboardUrl = process.env.PUBLIC_DASHBOARD_URL || 'https://zeromttr.agjworks.com';

  const handleAlert = new HandleAlert(repository, broadcaster);
  const investigateIncident = new InvestigateIncident(
    repository,
    toolsPort,
    targetStatusPort,
    broadcaster,
    logger
  );
  const enrichWithDeployDiff = new EnrichWithDeployDiff(repository, toolsPort, broadcaster);
  const patchSyntaxValidator = new TypeScriptPatchSyntaxValidator();
  const dispatchRemediation = new DispatchRemediation(
    repository,
    toolsPort,
    llmAdapter,
    fallbackAdapter,
    broadcaster,
    logger,
    { syntaxValidator: patchSyntaxValidator }
  );
  const onCallEmail = process.env.ON_CALL_ENGINEER_EMAIL || process.env.ONCALL_TO_EMAIL;
  const notifyOnCall = new NotifyOnCall(
    repository,
    toolsPort,
    clock,
    broadcaster,
    hmacSecret,
    dashboardUrl,
    logger,
    onCallEmail
  );
  const recordDecision = new RecordDecision(
    repository,
    toolsPort,
    clock,
    broadcaster,
    hmacSecret,
    logger
  );
  const simulateDemoDecision = new SimulateDemoDecision(repository, toolsPort, broadcaster, logger);

  const orchestratorWorkflow = new OrchestratorWorkflow(
    repository,
    investigateIncident,
    enrichWithDeployDiff,
    dispatchRemediation,
    notifyOnCall,
    broadcaster
  );

  const initialIncident = createInitialIncident();
  const rawCooldown = process.env.DEMO_COOLDOWN_MS ?? process.env.SIMULATION_COOLDOWN_MS;
  const demoCooldownMs = isNonEmptyString(rawCooldown)
    ? parseNumber(rawCooldown, 120_000)
    : undefined;

  const replayRunner = new ReplayRunner(repository, broadcaster, {}, logger);
  const demoRouter =
    process.env.ENABLE_DEMO_MODE === 'false'
      ? undefined
      : createDemoRouterFactory({
          repository,
          demoControlPort: new HttpDemoControlAdapter(),
          simulateDemoDecision,
          replayRunner,
          liveDemoKey: process.env.LIVE_DEMO_KEY,
          cooldownMs: demoCooldownMs
        });

  const app = createApp({
    repository,
    targetStatusPort,
    handleAlert,
    orchestratorWorkflow,
    recordDecision,
    broadcaster,
    grafanaWebhookToken: process.env.GRAFANA_WEBHOOK_TOKEN,
    dashboardApiToken: process.env.DASHBOARD_API_TOKEN,
    demoRouter
  });

  const server = http.createServer(app);

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
