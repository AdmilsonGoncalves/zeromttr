import http from 'node:http';
import { isNonEmptyString, parseNumber } from '@zeromttr/utils';
import { ConsoleJsonLogger } from './adapters/logger.console.js';
import { FileIncidentRepository } from './adapters/repo.file.js';
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
import { SystemClock } from './ports/clock.port.js';
import { createApp } from './http/app.js';
import { SseEventBroadcaster } from './http/events.sse.js';

/**
 * Instantiates orchestrator adapters, use cases, Express app, and starts the HTTP server.
 */
export function bootstrap(port: number = parseNumber(process.env.PORT, 8080)): http.Server {
  const logger = new ConsoleJsonLogger();
  const repository = new FileIncidentRepository(process.env.INCIDENT_STORE_PATH, logger);
  const toolsPort = new McpClientAdapter();
  const targetStatusPort = createTargetStatusPort(toolsPort);
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
    {
      syntaxValidator: patchSyntaxValidator
    }
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
  const demoConfig = resolveDemoConfig(process.env);
  const demoEnabled = demoConfig.demoModeEnabled;
  const demoControlPort = demoEnabled ? new HttpDemoControlAdapter() : undefined;
  const replayRunner = demoEnabled
    ? new ReplayRunner(repository, broadcaster, {}, logger)
    : undefined;
  const demoLifecycle =
    demoEnabled && demoControlPort
      ? createDemoSessionLifecycle(demoControlPort, replayRunner, targetStatusPort)
      : undefined;

  const recordDecision = new RecordDecision(
    repository,
    toolsPort,
    clock,
    broadcaster,
    hmacSecret,
    logger,
    demoLifecycle ? (incident) => demoLifecycle.handleLiveIncidentApproved(incident) : undefined
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

  const demoRouter =
    demoEnabled && demoControlPort && demoLifecycle
      ? createDemoRouterFactory({
          repository,
          targetStatusPort,
          demoControlPort,
          simulateDemoDecision,
          replayRunner,
          lifecycle: demoLifecycle,
          liveDemoKey: process.env.LIVE_DEMO_KEY,
          requireDemoKey: demoConfig.requireDemoKey,
          publicLiveDemo: demoConfig.publicLiveDemo,
          turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
          turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
          cooldownMs: demoCooldownMs
        })
      : undefined;

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
