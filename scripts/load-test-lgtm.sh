#!/usr/bin/env bash
set -euo pipefail

# scripts/load-test-lgtm.sh — Validação de carga na stack LGTM + aplicações ZeroMTTR
# Verifica limites de RAM sob carga (pico <= 2200 MiB total), taxa de sucesso HTTP,
# ausência de OOMKill, incremento real de histograma OTLP e saúde dos serviços.

CALLER_TARGET_URL="${TARGET_DEMO_URL:-}"
CALLER_ORCH_URL="${ORCHESTRATOR_URL:-}"
CALLER_DASHBOARD_URL="${DASHBOARD_URL:-}"
CALLER_MCP_URL="${MCP_SERVER_URL:-}"

ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

CONCURRENCY="${LOAD_CONCURRENCY:-10}"
DURATION="${LOAD_DURATION:-20}"
MAX_RAM_MIB="${MAX_TOTAL_RAM_MIB:-2200}"
MIN_SUCCESS_RATE="${LOAD_MIN_SUCCESS_RATE:-95}"
DOCKER_TIMEOUT="${DOCKER_CMD_TIMEOUT_SECONDS:-10}"
TARGET_URL="${CALLER_TARGET_URL:-http://127.0.0.1:3001}"
ORCH_URL="${CALLER_ORCH_URL:-http://127.0.0.1:8080}"
DASHBOARD_URL="${CALLER_DASHBOARD_URL:-http://127.0.0.1:4200}"
MCP_URL="${CALLER_MCP_URL:-http://127.0.0.1:8000}"
MCP_HEALTH_BASE="${MCP_URL%/}"
MCP_HEALTH_BASE="${MCP_HEALTH_BASE%/mcp}"

validate_positive_int() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "❌ ${name} deve ser um inteiro positivo >= 1 (recebido: '${value}')." >&2
    exit 1
  fi
}

validate_positive_int "LOAD_CONCURRENCY" "$CONCURRENCY"
validate_positive_int "LOAD_DURATION" "$DURATION"
validate_positive_int "MAX_TOTAL_RAM_MIB" "$MAX_RAM_MIB"
validate_positive_int "DOCKER_CMD_TIMEOUT_SECONDS" "$DOCKER_TIMEOUT"
if [[ ! "$MIN_SUCCESS_RATE" =~ ^(100|[1-9]?[0-9])$ ]]; then
  echo "❌ LOAD_MIN_SUCCESS_RATE deve ser um inteiro entre 0 e 100 (recebido: '${MIN_SUCCESS_RATE}')." >&2
  exit 1
fi

CONTAINERS=(
  zeromttr-prometheus
  zeromttr-loki
  zeromttr-tempo
  zeromttr-grafana
  zeromttr-otel-collector
  zeromttr-postgres
  zeromttr-mcp-server
  zeromttr-orchestrator
  zeromttr-target-app-demo
  zeromttr-dashboard
)

TMP_DIR=$(mktemp -d)
SAMPLER_PID=""
WORKER_PIDS=()

cleanup() {
  touch "${TMP_DIR}/load_done" 2>/dev/null || true
  if [ -n "$SAMPLER_PID" ]; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
  for pid in "${WORKER_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

query_hist_count() {
  local raw
  raw=$(curl -fsS --max-time 10 -G "http://127.0.0.1:9090/api/v1/query" --data-urlencode 'query=sum(http_server_duration_milliseconds_count{service="api-pagamentos-core"})')
  node -e "
    const res = JSON.parse(process.argv[1]);
    if (res.status !== 'success') {
      process.exit(1);
    }
    const rawVal = res?.data?.result?.[0]?.value?.[1];
    const val = rawVal === undefined ? 0 : Number(rawVal);
    if (!Number.isFinite(val)) {
      process.exit(1);
    }
    process.stdout.write(String(val));
  " "$raw"
}

echo "=========================================================="
echo "🔥 ZeroMTTR — Teste de Carga LGTM & Verificação de RAM"
echo "Concorrência: ${CONCURRENCY} | Duração: ${DURATION}s | Limite RAM: ${MAX_RAM_MIB} MiB"
echo "=========================================================="

check_endpoints_health() {
  curl -fsS --max-time 10 "${TARGET_URL}/health" > /dev/null
  curl -fsS --max-time 10 "${ORCH_URL}/health" > /dev/null
  curl -fsS --max-time 10 "${MCP_HEALTH_BASE}/health" > /dev/null
  curl -fsS --max-time 10 "${DASHBOARD_URL}/" | grep -q "ZeroMTTR"
}

echo "[1/4] Verificando saúde dos endpoints principais..."
check_endpoints_health
echo "✅ target-app-demo, orchestrator, mcp-server e dashboard respondendo HTTP 200."

BEFORE_HIST_COUNT=$(query_hist_count)
echo "Baseline Prometheus http_server_duration_milliseconds_count=${BEFORE_HIST_COUNT}"

echo "[2/4] Executando carga concorrente de transações PIX (${DURATION}s, ${CONCURRENCY} workers)..."
PAYLOAD='{
  "amount": 125.00,
  "currency": "BRL",
  "payerCpf": "123.456.789-00",
  "merchantCnpj": "12.345.678/0001-99",
  "pixKey": "cliente.silva@exemplo.com.br",
  "description": "Load Test ZeroMTTR Phase 5",
  "authHeader": "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
}'

sample_ram_during_load() {
  local peak_mib="0"
  local expected_count="${#CONTAINERS[@]}"
  local samples_ok=0
  local samples_fail=0
  while [ ! -f "${TMP_DIR}/load_done" ]; do
    local stats
    local sample_recorded=0
    stats=$(timeout "${DOCKER_TIMEOUT}" docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}" "${CONTAINERS[@]}" 2>/dev/null) || stats=""
    if [ -n "$stats" ]; then
      local current_mib
      current_mib=$(node -e "
        const lines = process.argv[1].trim().split('\n').filter(Boolean);
        const expected = Number(process.argv[2]);
        if (lines.length < expected) {
          process.exit(1);
        }
        const toMiB = (str) => {
          const m = str.match(/([\d.]+)\s*(KiB|MiB|GiB|B)/i);
          if (!m) return null;
          const num = Number(m[1]);
          const unit = m[2].toLowerCase();
          if (unit === 'gib') return num * 1024;
          if (unit === 'mib') return num;
          if (unit === 'kib') return num / 1024;
          return num / (1024 * 1024);
        };
        let total = 0;
        for (const line of lines) {
          const [, usage] = line.split('\t');
          const mib = toMiB((usage || '').split('/')[0] || '');
          if (mib === null) {
            process.exit(1);
          }
          total += mib;
        }
        process.stdout.write(total.toFixed(1));
      " "$stats" "$expected_count" 2>/dev/null || true)
      if [ -n "$current_mib" ]; then
        sample_recorded=1
        samples_ok=$((samples_ok + 1))
        if node -e "process.exit(Number(process.argv[1]) > Number(process.argv[2]) ? 0 : 1)" "$current_mib" "$peak_mib"; then
          peak_mib="$current_mib"
          printf '%s\n' "$peak_mib" > "${TMP_DIR}/peak_ram_mib"
          printf '%s\n' "$stats" > "${TMP_DIR}/peak_stats"
        fi
      fi
    fi
    if [ "$sample_recorded" -eq 0 ]; then
      samples_fail=$((samples_fail + 1))
    fi
    printf '%s %s\n' "$samples_ok" "$samples_fail" > "${TMP_DIR}/sampler_counts"
    sleep 1
  done
}

LOAD_START_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sample_ram_during_load &
SAMPLER_PID=$!

END_TIME=$((SECONDS + DURATION))
worker() {
  local ok=0
  local fail=0
  while [ $SECONDS -lt $END_TIME ]; do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${TARGET_URL}/payments" \
      -H "Content-Type: application/json" \
      -d "${PAYLOAD}" \
      --max-time 5) || code="000"
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
    fi
    sleep 0.1
  done
  printf '%s %s\n' "$ok" "$fail" >> "${TMP_DIR}/results"
}

for _ in $(seq 1 "$CONCURRENCY"); do
  worker &
  WORKER_PIDS+=($!)
done
wait "${WORKER_PIDS[@]}"
WORKER_PIDS=()

touch "${TMP_DIR}/load_done"
SAMPLER_EXIT=0
wait "$SAMPLER_PID" || SAMPLER_EXIT=$?
SAMPLER_PID=""
if [ "$SAMPLER_EXIT" -ne 0 ]; then
  echo "❌ Sampler de RAM encerrou de forma anormal (exit=${SAMPLER_EXIT})." >&2
  exit 1
fi

node -e "
const fs = require('node:fs');
const path = process.argv[1];
const minRate = Number(process.argv[2]);
const raw = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim() : '';
let ok = 0;
let fail = 0;
for (const line of raw ? raw.split('\n') : []) {
  const [a, b] = line.trim().split(/\s+/).map(Number);
  ok += a || 0;
  fail += b || 0;
}
const total = ok + fail;
const rate = total > 0 ? (ok / total) * 100 : 0;
console.log(\`✅ Carga concluída: \${ok}/\${total} HTTP 2xx (\${rate.toFixed(1)}%, falhas=\${fail}).\`);
if (total === 0 || rate < minRate) {
  console.error(\`❌ Taxa de sucesso abaixo do mínimo (\${minRate}%).\`);
  process.exit(1);
}
" "${TMP_DIR}/results" "$MIN_SUCCESS_RATE"

echo "[3/4] Consultando incremento do histograma OTLP no Prometheus..."
AFTER_HIST_COUNT="$BEFORE_HIST_COUNT"
POLL_DEADLINE=$(( $(date +%s) + 20 ))
while [ "$(date +%s)" -lt "$POLL_DEADLINE" ]; do
  AFTER_HIST_COUNT=$(query_hist_count)
  if node -e "process.exit(Number(process.argv[1]) > Number(process.argv[2]) ? 0 : 1)" "$AFTER_HIST_COUNT" "$BEFORE_HIST_COUNT"; then
    break
  fi
  sleep 2
done

if ! node -e "process.exit(Number(process.argv[1]) > Number(process.argv[2]) ? 0 : 1)" "$AFTER_HIST_COUNT" "$BEFORE_HIST_COUNT"; then
  echo "❌ Contador http_server_duration_milliseconds_count não aumentou após a carga (antes=${BEFORE_HIST_COUNT}, depois=${AFTER_HIST_COUNT})." >&2
  exit 1
fi
DELTA_HIST=$(node -e "process.stdout.write(String(Number(process.argv[1]) - Number(process.argv[2])))" "$AFTER_HIST_COUNT" "$BEFORE_HIST_COUNT")
echo "✅ Histograma OTLP confirmado no Prometheus (+${DELTA_HIST} novas amostras; total=${AFTER_HIST_COUNT})."

echo "[4/4] Auditando pico de memória RAM sob carga, OOM e saúde pós-carga dos contêineres..."
LOAD_END_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OOM_EVENTS=$(timeout "${DOCKER_TIMEOUT}" docker events --since "$LOAD_START_TS" --until "$LOAD_END_TS" --filter type=container --filter event=oom --format '{{.Actor.Attributes.name}}') || {
  echo "❌ Falha ao coletar eventos OOM do Docker na janela de carga (${LOAD_START_TS}..${LOAD_END_TS})." >&2
  exit 1
}
for c in "${CONTAINERS[@]}"; do
  if printf '%s\n' "$OOM_EVENTS" | grep -Fxq "$c"; then
    echo "❌ Evento OOM detectado pelo Docker durante a carga para o contêiner ${c}" >&2
    exit 1
  fi
  STATE_INFO=$(timeout "${DOCKER_TIMEOUT}" docker inspect --format='{{.State.Running}} {{.State.OOMKilled}}' "$c" 2>/dev/null) || {
    echo "❌ Falha ao inspecionar contêiner ${c} pós-carga." >&2
    exit 1
  }
  read -r RUNNING OOM <<< "$STATE_INFO"
  if [ "$RUNNING" != "true" ] || [ "$OOM" != "false" ]; then
    echo "❌ Contêiner ${c} com Running=${RUNNING:-unknown}, OOMKilled=${OOM:-unknown}" >&2
    exit 1
  fi
done

if [ ! -s "${TMP_DIR}/sampler_counts" ]; then
  echo "❌ Sampler de RAM não produziu contagem de amostras." >&2
  exit 1
fi
read -r SAMPLES_OK SAMPLES_FAIL < "${TMP_DIR}/sampler_counts"
if [ "${SAMPLES_OK:-0}" -eq 0 ] || [ "${SAMPLES_FAIL:-1}" -gt 0 ] || [ ! -s "${TMP_DIR}/peak_ram_mib" ] || [ ! -s "${TMP_DIR}/peak_stats" ]; then
  echo "❌ Medição incompleta de RAM sob carga (amostras_ok=${SAMPLES_OK:-0}, falhas=${SAMPLES_FAIL:-1})." >&2
  timeout "${DOCKER_TIMEOUT}" docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}" "${CONTAINERS[@]}" >&2 || true
  exit 1
fi

PEAK_RAM_MIB=$(cat "${TMP_DIR}/peak_ram_mib")
cat "${TMP_DIR}/peak_stats"
echo "Pico total de RAM sob carga (10 contêineres): ${PEAK_RAM_MIB} MiB (limite: ${MAX_RAM_MIB} MiB)"
if node -e "process.exit(Number(process.argv[1]) > Number(process.argv[2]) ? 0 : 1)" "$PEAK_RAM_MIB" "$MAX_RAM_MIB"; then
  echo "❌ Pico de consumo total de RAM sob carga excedeu ${MAX_RAM_MIB} MiB" >&2
  exit 1
fi
check_endpoints_health
echo "✅ Stack LGTM + ZeroMTTR estável dentro do orçamento de RAM sob carga, sem OOMKill e endpoints saudáveis."
