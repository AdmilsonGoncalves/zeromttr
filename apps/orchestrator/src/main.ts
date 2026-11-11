import http from 'node:http';
import {
  FileIncidentRepository,
  HttpTargetStatusAdapter,
  McpClientAdapter,
  DeterministicFallbackReasoningAdapter,
  GeminiReasoningAdapter
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
import { SystemClock } from './ports/index.js';
import { createApp, SseEventBroadcaster } from './http/index.js';

export function bootstrap(port: number = Number(process.env.PORT) || 8080): http.Server {
  const repository = new FileIncidentRepository(process.env.INCIDENT_STORE_PATH);
  const targetStatusPort = new HttpTargetStatusAdapter();
  const toolsPort = new McpClientAdapter();
  const fallbackAdapter = new DeterministicFallbackReasoningAdapter();
  const llmAdapter = new GeminiReasoningAdapter();
  const clock = new SystemClock();
  const broadcaster = new SseEventBroadcaster();

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DECISION_HMAC_SECRET) {
      throw new Error('FATAL: DECISION_HMAC_SECRET must be configured in production environment.');
    }
    if (!process.env.GRAFANA_WEBHOOK_TOKEN) {
      throw new Error('FATAL: GRAFANA_WEBHOOK_TOKEN must be configured in production environment.');
    }
    if (!process.env.DASHBOARD_API_TOKEN) {
      throw new Error('FATAL: DASHBOARD_API_TOKEN must be configured in production environment.');
    }
  }

  const hmacSecret = process.env.DECISION_HMAC_SECRET || 'zeromttr-default-hmac-secret-2026';
  const dashboardUrl = process.env.PUBLIC_DASHBOARD_URL || 'https://zeromttr.agjworks.com';

  const handleAlert = new HandleAlert(repository, broadcaster);
  const investigateIncident = new InvestigateIncident(
    repository,
    toolsPort,
    targetStatusPort,
    broadcaster
  );
  const enrichWithDeployDiff = new EnrichWithDeployDiff(repository, toolsPort, broadcaster);
  const dispatchRemediation = new DispatchRemediation(
    repository,
    toolsPort,
    llmAdapter,
    fallbackAdapter,
    broadcaster
  );
  const notifyOnCall = new NotifyOnCall(
    repository,
    toolsPort,
    clock,
    broadcaster,
    hmacSecret,
    dashboardUrl
  );
  const recordDecision = new RecordDecision(repository, toolsPort, clock, broadcaster, hmacSecret);

  const orchestratorWorkflow = new OrchestratorWorkflow(
    repository,
    investigateIncident,
    enrichWithDeployDiff,
    dispatchRemediation,
    notifyOnCall,
    broadcaster
  );

  const initialIncident = createInitialIncident();

  const app = createApp({
    repository,
    targetStatusPort,
    handleAlert,
    orchestratorWorkflow,
    recordDecision,
    broadcaster,
    grafanaWebhookToken: process.env.GRAFANA_WEBHOOK_TOKEN,
    dashboardApiToken: process.env.DASHBOARD_API_TOKEN,
    liveDemoKey: process.env.LIVE_DEMO_KEY,
    ...(process.env.DEMO_COOLDOWN_MS
      ? { demoCooldownMs: Number(process.env.DEMO_COOLDOWN_MS) }
      : {})
  });

  const server = http.createServer(app);

  server.listen(port, () => {
    console.log(`[orchestrator] Initialized with state ${initialIncident.state} on port ${port}`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
