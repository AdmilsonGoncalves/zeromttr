#!/usr/bin/env bash
set -euo pipefail

# scripts/measure-mttr.sh — Medição cronometrada de TTD, TTPR e entrega de Post-Mortem
# Lê os timestamps de transição de GET /api/incidents/:id e valida contra as metas (15s / 30s / 45s).

CALLER_ORCH_URL="${ORCHESTRATOR_URL:-}"

ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ORCH_URL="${CALLER_ORCH_URL:-http://127.0.0.1:8080}"
TOKEN="${DASHBOARD_API_TOKEN:-}"
INCIDENT_ID="${1:-}"
MAX_WAIT_SECONDS="${MTTR_TIMEOUT_SECONDS:-60}"

if [ -z "$TOKEN" ]; then
  echo "❌ DASHBOARD_API_TOKEN não configurado (defina no ambiente ou em ${ENV_FILE})." >&2
  exit 1
fi

if [ -z "$INCIDENT_ID" ]; then
  LIST_JSON=$(curl -fsS --max-time 10 -H "Authorization: Bearer ${TOKEN}" "${ORCH_URL}/api/incidents")
  INCIDENT_ID=$(node -e "
    const items = JSON.parse(process.argv[1]);
    if (!Array.isArray(items) || items.length === 0) {
      process.exit(1);
    }
    const sorted = [...items].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const preferred = sorted.find((i) => i.mode === 'live') ?? sorted[0];
    process.stdout.write(String(preferred.id));
  " "$LIST_JSON" 2>/dev/null || true)

  if [ -z "$INCIDENT_ID" ]; then
    echo "❌ Nenhum incidente encontrado em ${ORCH_URL}/api/incidents. Informe um ID como argumento." >&2
    exit 1
  fi
fi

echo "=========================================================="
echo "⏱️  ZeroMTTR — Medição Cronometrada de TTD / TTPR"
echo "Orchestrator: ${ORCH_URL}"
echo "Incident ID:  ${INCIDENT_ID}"
echo "=========================================================="

DEADLINE=$(( $(date +%s) + MAX_WAIT_SECONDS ))
INCIDENT_JSON=""
STATE=""
while true; do
  NOW=$(date +%s)
  REMAINING=$((DEADLINE - NOW))
  if [ "$REMAINING" -le 0 ]; then
    echo "⚠️  Timeout após ${MAX_WAIT_SECONDS}s aguardando estado terminal/NOTIFIED (estado atual: ${STATE:-desconhecido})." >&2
    break
  fi

  FETCH_RESULT=$(curl -fsS --max-time "$REMAINING" -H "Authorization: Bearer ${TOKEN}" "${ORCH_URL}/api/incidents/${INCIDENT_ID}" 2>/dev/null || true)
  if [ -n "$FETCH_RESULT" ]; then
    INCIDENT_JSON="$FETCH_RESULT"
    STATE=$(node -e "const d = JSON.parse(process.argv[1]); process.stdout.write(String(d.state || ''));" "$INCIDENT_JSON")
    if [ "$STATE" = "NOTIFIED" ] || [ "$STATE" = "RESOLVED" ] || [ "$STATE" = "REJECTED" ] || [ "$STATE" = "FAILED" ]; then
      break
    fi
  fi

  NOW=$(date +%s)
  if [ "$NOW" -ge "$DEADLINE" ]; then
    echo "⚠️  Timeout após ${MAX_WAIT_SECONDS}s aguardando estado terminal/NOTIFIED (estado atual: ${STATE:-desconhecido})." >&2
    break
  fi
  sleep 1
done

if [ -z "$INCIDENT_JSON" ]; then
  echo "❌ Falha ao obter dados do incidente ${INCIDENT_ID} antes do timeout de ${MAX_WAIT_SECONDS}s." >&2
  exit 1
fi

node -e "
const inc = JSON.parse(process.argv[1]);
const transitions = Array.isArray(inc.transitions) ? inc.transitions : [];
const findTs = (...states) => {
  for (const s of states) {
    const t = transitions.find((tr) => tr.to === s);
    if (t && t.at) {
      return new Date(t.at).getTime();
    }
  }
  return null;
};

const receivedMs = findTs('RECEIVED') ?? (inc.startedAt ? new Date(inc.startedAt).getTime() : null);
const remediatingMs = findTs('REMEDIATING');
const awaitingPrMs = findTs('AWAITING_PR');
const notifiedMs = findTs('NOTIFIED');

const fmt = (endMs) => (receivedMs !== null && endMs !== null ? ((endMs - receivedMs) / 1000).toFixed(2) : null);
const ttd = fmt(remediatingMs);
const ttpr = fmt(awaitingPrMs);
const postMortem = fmt(notifiedMs);

console.log('Modo:               ', inc.mode || 'unknown');
console.log('Estado atual:       ', inc.state);
console.log('Notificação:        ', inc.notification?.status || 'n/a');
console.log('Reasoning Source:   ', inc.rca?.reasoningSource || 'n/a');
console.log('Evidence Coverage:  ', inc.rca ? \`\${inc.rca.signalsCollected}/\${inc.rca.signalsTotal} (\${inc.rca.evidenceCoveragePercent}%)\` : 'n/a');
console.log('PII Guard Passed:   ', inc.rca?.piiGuardAudit ? String(inc.rca.piiGuardAudit.passed) : 'n/a');
console.log('FinOps Reduction:   ', inc.finops ? \`\${inc.finops.payloadReductionPercent}% (\${inc.finops.estimatedTokensSaved} tokens saved)\` : 'n/a');
console.log('Pull Request URL:   ', inc.remediation?.pullRequestUrl || 'n/a');
console.log('----------------------------------------------------------');
console.log(\`TTD  (RECEIVED -> REMEDIATING):   \${ttd !== null ? ttd + 's' : 'n/a'}  [meta <= 15s]\`);
console.log(\`TTPR (RECEIVED -> AWAITING_PR):   \${ttpr !== null ? ttpr + 's' : 'n/a'}  [meta <= 30s]\`);
console.log(\`Post-Mortem (RECEIVED -> NOTIFIED): \${postMortem !== null ? postMortem + 's' : 'n/a'}  [meta <= 45s]\`);
console.log('==========================================================');

if (inc.state === 'FAILED') {
  console.error('❌ Incidente terminou em FAILED.');
  process.exit(1);
}
const notifiedTransition = transitions.find((tr) => tr.to === 'NOTIFIED');
const notifStatus = String(inc.notification?.status || '').toLowerCase();
const isDegradedNotification =
  notifStatus === 'degraded' ||
  Boolean(notifiedTransition?.reason && /degraded|fallback/i.test(String(notifiedTransition.reason)));
if (isDegradedNotification) {
  console.error('❌ Notificação pós-incidente em modo DEGRADED/fallback; entrega real não confirmada.');
  process.exit(1);
}
if (ttd === null || Number(ttd) > 15 || ttpr === null || Number(ttpr) > 30 || postMortem === null || Number(postMortem) > 45) {
  console.error('❌ Uma ou mais metas de TTD/TTPR/Post-Mortem não foram atingidas.');
  process.exit(1);
}
if (inc.mode === 'replay') {
  console.log(
    'ℹ️  Modo replay: metas cronometradas da simulação cumpridas (não certifica criação real de PR nem envio real de e-mail).'
  );
} else {
  if (!inc.remediation?.pullRequestUrl || !/^https?:\/\//.test(inc.remediation.pullRequestUrl)) {
    console.error('❌ Execução live sem URL válida de Pull Request de remediação.');
    process.exit(1);
  }
  if (notifStatus !== 'dispatched') {
    console.error('❌ Execução live não confirmou entrega real de e-mail (notification.status != dispatched).');
    process.exit(1);
  }
  console.log('✅ Execução live: metas de TTD, TTPR, PR real e envio real de e-mail cumpridas.');
}
" "$INCIDENT_JSON"
