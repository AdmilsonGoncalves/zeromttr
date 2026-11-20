#!/usr/bin/env bash
set -euo pipefail

# scripts/record-replay.sh — Grava snapshot sanitizado de execução Live em data/last-recorded-incident.json
# Uso: ./scripts/record-replay.sh [INCIDENT_ID]
# Se INCIDENT_ID não for informado, dispara modo Live, gera tráfego concorrente limitado em /payments
# para acionar o alerta do Grafana e grava o snapshot validado por ReplaySnapshotSchema.

CALLER_ORCH_URL="${ORCHESTRATOR_URL:-}"
CALLER_TARGET_URL="${TARGET_DEMO_URL:-}"

ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ORCH_URL="${CALLER_ORCH_URL:-http://127.0.0.1:8080}"
TARGET_URL="${CALLER_TARGET_URL:-http://127.0.0.1:3001}"
TOKEN="${DASHBOARD_API_TOKEN:-}"
LIVE_KEY="${LIVE_DEMO_KEY:-}"
OUTPUT_PATH="${REPLAY_SNAPSHOT_PATH:-data/last-recorded-incident.json}"
INCIDENT_ID="${1:-}"
MAX_WAIT_SECONDS="${RECORD_TIMEOUT_SECONDS:-90}"
TRAFFIC_CONCURRENCY="${RECORD_TRAFFIC_CONCURRENCY:-4}"
TRIGGERED_LIVE=0
CHAOS_ENABLED_BY_RUN=0

if [ -z "$TOKEN" ]; then
  echo "❌ DASHBOARD_API_TOKEN não configurado." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
TRAFFIC_PIDS=()

stop_traffic() {
  touch "${TMP_DIR}/stop_traffic" 2>/dev/null || true
  for pid in "${TRAFFIC_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${TRAFFIC_PIDS[@]:-}"; do
    wait "$pid" 2>/dev/null || true
  done
  TRAFFIC_PIDS=()
}

cleanup() {
  stop_traffic
  if [ "$CHAOS_ENABLED_BY_RUN" -eq 1 ]; then
    local reset_headers=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")
    if [ -n "$LIVE_KEY" ]; then
      reset_headers+=(-H "X-Live-Demo-Key: ${LIVE_KEY}")
    fi
    curl -fsS --max-time 10 -X POST "${ORCH_URL}/api/demo/reset" "${reset_headers[@]}" > /dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

if [ -z "$INCIDENT_ID" ]; then
  TRIGGERED_LIVE=1
  echo "⚡ Capturando baseline de incidentes e disparando simulação Live para gravação de Replay..."
  EXISTING_LIST_JSON=$(curl -fsS --max-time 10 -H "Authorization: Bearer ${TOKEN}" "${ORCH_URL}/api/incidents" || echo "[]")
  TRIGGER_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  HEADERS=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")
  if [ -n "$LIVE_KEY" ]; then
    HEADERS+=(-H "X-Live-Demo-Key: ${LIVE_KEY}")
  fi

  CHAOS_ENABLED_BY_RUN=1
  curl -fsS --max-time 15 -X POST "${ORCH_URL}/api/demo/chaos" "${HEADERS[@]}" -d '{"mode":"live"}' > /dev/null

  echo "Gerando tráfego concorrente limitado em ${TARGET_URL}/payments e aguardando alerta Grafana (<= ${MAX_WAIT_SECONDS}s)..."
  TRAFFIC_PAYLOAD='{
    "amount": 150.00,
    "currency": "BRL",
    "payerCpf": "123.456.789-00",
    "merchantCnpj": "12.345.678/0001-99",
    "pixKey": "cliente.silva@exemplo.com.br",
    "description": "Record Replay Trigger Traffic",
    "authHeader": "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
  }'

  TRAFFIC_DEADLINE=$(( $(date +%s) + MAX_WAIT_SECONDS ))
  traffic_worker() {
    while [ ! -f "${TMP_DIR}/stop_traffic" ] && [ "$(date +%s)" -lt "$TRAFFIC_DEADLINE" ]; do
      curl -s -o /dev/null -X POST "${TARGET_URL}/payments" \
        -H "Content-Type: application/json" \
        -d "${TRAFFIC_PAYLOAD}" \
        --max-time 6 || true
      sleep 0.2
    done
  }

  for _ in $(seq 1 "$TRAFFIC_CONCURRENCY"); do
    traffic_worker &
    TRAFFIC_PIDS+=($!)
  done

  DEADLINE=$(( $(date +%s) + MAX_WAIT_SECONDS ))
  while true; do
    NOW=$(date +%s)
    REMAINING=$((DEADLINE - NOW))
    if [ "$REMAINING" -le 0 ]; then
      echo "❌ Timeout aguardando incidente Live ser criado." >&2
      exit 1
    fi

    LIST_JSON=$(curl -fsS --max-time "$REMAINING" -H "Authorization: Bearer ${TOKEN}" "${ORCH_URL}/api/incidents" || echo "[]")
    INCIDENT_ID=$(node -e "
      const items = JSON.parse(process.argv[1]);
      const preExisting = new Set(JSON.parse(process.argv[2]).map((i) => String(i.id)));
      const triggerMs = new Date(process.argv[3]).getTime();
      const live = items
        .filter((i) => i.mode === 'live' && !preExisting.has(String(i.id)) && new Date(i.startedAt).getTime() >= triggerMs)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      if (live[0]) {
        process.stdout.write(String(live[0].id));
      }
    " "$LIST_JSON" "$EXISTING_LIST_JSON" "$TRIGGER_TS")

    if [ -n "$INCIDENT_ID" ]; then
      stop_traffic
      break
    fi

    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      echo "❌ Timeout aguardando incidente Live ser criado." >&2
      exit 1
    fi
    sleep 2
  done
fi

echo "Capturando incidente ${INCIDENT_ID}..."
DEADLINE=$(( $(date +%s) + MAX_WAIT_SECONDS ))
INCIDENT_JSON=""
STATE=""
while true; do
  NOW=$(date +%s)
  REMAINING=$((DEADLINE - NOW))
  if [ "$REMAINING" -le 0 ]; then
    echo "❌ Timeout aguardando incidente ${INCIDENT_ID} atingir NOTIFIED (estado: ${STATE:-desconhecido})." >&2
    exit 1
  fi

  FETCH_RESULT=$(curl -fsS --max-time "$REMAINING" -H "Authorization: Bearer ${TOKEN}" "${ORCH_URL}/api/incidents/${INCIDENT_ID}" 2>/dev/null || true)
  if [ -n "$FETCH_RESULT" ]; then
    INCIDENT_JSON="$FETCH_RESULT"
    STATE=$(node -e "const d = JSON.parse(process.argv[1]); process.stdout.write(String(d.state || ''));" "$INCIDENT_JSON")
    if [ "$STATE" = "NOTIFIED" ] || [ "$STATE" = "RESOLVED" ] || [ "$STATE" = "REJECTED" ]; then
      break
    fi
    if [ "$STATE" = "FAILED" ]; then
      echo "❌ Incidente ${INCIDENT_ID} falhou durante execução Live." >&2
      exit 1
    fi
  fi

  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "❌ Timeout aguardando incidente ${INCIDENT_ID} atingir NOTIFIED (estado: ${STATE:-desconhecido})." >&2
    exit 1
  fi
  sleep 1
done

TARGET_STATUS_JSON="{}"
if [ "$TRIGGERED_LIVE" -eq 1 ]; then
  TARGET_STATUS_JSON=$(curl -fsS --max-time 10 -H "Authorization: Bearer ${TOKEN}" "${ORCH_URL}/api/target/status" || echo '{}')
fi

echo "⚙️  Garantindo compilação atualizada de @zeromttr/contracts e @zeromttr/orchestrator..."
CI=true pnpm nx run-many -t build -p @zeromttr/contracts @zeromttr/orchestrator > /dev/null

node -e "
const fs = require('node:fs');
const { IncidentEventType, ReplaySnapshotSchema } = require('./libs/contracts/dist/index.js');
const { PiiPromptGuard } = require('./apps/orchestrator/dist/domain/pii-prompt-guard.js');

const inc = JSON.parse(process.argv[1]);
const target = JSON.parse(process.argv[2] || '{}');
const outputPath = process.argv[3];
const triggeredLive = process.argv[4] === '1';

if (
  !inc.rca ||
  !inc.finops ||
  !inc.remediation ||
  !inc.remediation.branchUrl ||
  !inc.remediation.pullRequestUrl ||
  !inc.remediation.commitSha
) {
  throw new Error(
    'Incident (state=' +
      String(inc.state || 'unknown') +
      ') is missing required rca, finops, or remediation PR fields (branchUrl, pullRequestUrl, commitSha)'
  );
}
if (!inc.rca.piiGuardAudit || inc.rca.piiGuardAudit.passed !== true) {
  throw new Error('Incident failed PII guard audit; refusing to persist replay snapshot');
}

const persistedTexts = [
  inc.rca.summary,
  inc.rca.rootCause || inc.rca.summary,
  inc.rca.logSample || '',
  ...(Array.isArray(inc.rca.mitigations) ? inc.rca.mitigations : [])
].join('\n');
const postAudit = PiiPromptGuard.inspectAndEnforceFailClosed(persistedTexts);
if (!postAudit.passed) {
  throw new Error(
    'Residual PII detected in incident fields before saving replay snapshot: ' +
      postAudit.detectedTypes.join(', ')
  );
}

const canUseTargetEdgeLog =
  triggeredLive &&
  target &&
  target.service === inc.service &&
  (!inc.rca.deployVersion || target.version === inc.rca.deployVersion);

const eventsTimeline = [
  { event: IncidentEventType.CREATED, delayMs: 500 },
  { event: IncidentEventType.TRANSITION, state: 'INVESTIGATING', delayMs: 2000 },
  { event: IncidentEventType.TRANSITION, state: 'ENRICHING', delayMs: 3000 },
  { event: IncidentEventType.RCA, delayMs: 4000 },
  { event: IncidentEventType.TRANSITION, state: 'REMEDIATING', delayMs: 2000 },
  { event: IncidentEventType.TRANSITION, state: 'AWAITING_PR', delayMs: 3000 },
  { event: IncidentEventType.REMEDIATION, delayMs: 2000 },
  { event: IncidentEventType.TRANSITION, state: 'NOTIFIED', delayMs: 3000 }
];

const snapshot = {
  recordedAt: new Date().toISOString(),
  incidentId: inc.id,
  service: inc.service,
  severity: inc.severity,
  evidenceCoverage: {
    score: inc.rca.evidenceCoveragePercent,
    signalsCollected: inc.rca.signalsCollected,
    signalsTotal: inc.rca.signalsTotal,
    signals: ['promql_anomaly', 'metric_exemplar', 'tempo_error_span', 'loki_log_diff']
  },
  blastRadius: {
    servicesInvolved: inc.rca.blastRadius
  },
  finops: {
    rawBytesFetched: inc.finops.rawBytesFetched,
    compactedBytesSentToLlm: inc.finops.compactedBytesSent,
    payloadReductionPercent: inc.finops.payloadReductionPercent,
    estimatedTokensSaved: inc.finops.estimatedTokensSaved
  },
  piiGuardAudit: inc.rca.piiGuardAudit,
  rca: {
    summary: inc.rca.summary,
    rootCause: inc.rca.rootCause || inc.rca.summary,
    reasoningSource: inc.rca.reasoningSource,
    suspectFilePath:
      (canUseTargetEdgeLog ? target.suspectFilePath : undefined) ||
      'apps/target-app-demo/src/repositories/payment.repository.ts',
    diagnosisSeconds: inc.rca.diagnosisSeconds,
    traceId: inc.rca.traceId,
    criticalSpan: inc.rca.criticalSpan,
    spans: inc.rca.spans,
    rawEdgeLogPreCollector:
      inc.rca.rawEdgeLogPreCollector ||
      (canUseTargetEdgeLog ? target.rawEdgeLogPreCollector : undefined),
    logSample: inc.rca.logSample,
    deployVersion: inc.rca.deployVersion,
    mitigations: inc.rca.mitigations,
    grafanaAnnotationId: inc.rca.grafanaAnnotationId
  },
  remediation: {
    branchName:
      inc.remediation.branchName ||
      (inc.remediation.branchUrl && inc.remediation.branchUrl.includes('/tree/')
        ? inc.remediation.branchUrl.split('/tree/')[1]
        : undefined),
    branchUrl: inc.remediation.branchUrl,
    pullRequestUrl: inc.remediation.pullRequestUrl,
    commitSha: inc.remediation.commitSha,
    suspectCommitSha: inc.remediation.suspectCommitSha
  },
  eventsTimeline
};

const parsed = ReplaySnapshotSchema.parse(snapshot);
fs.mkdirSync(require('node:path').dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
console.log('✅ Snapshot Replay sanitizado gravado e validado em:', outputPath);
" "$INCIDENT_JSON" "$TARGET_STATUS_JSON" "$OUTPUT_PATH" "$TRIGGERED_LIVE"
