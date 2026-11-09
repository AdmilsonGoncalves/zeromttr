#!/usr/bin/env bash
set -euo pipefail

echo "=================================================================="
echo "⚡ ZeroMTTR Phase 1 Verification Suite (Foundation & Infrastructure)"
echo "=================================================================="

# Carrega variáveis de ambiente locais se o arquivo existir (.env por padrão ou via ENV_FILE)
ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# 1. Healthcheck of stack
echo "Checking Docker Compose services health (<= 90s)..."
START_TIME=$(date +%s)
MAX_WAIT_SECONDS=90

check_healthy() {
  local service="$1"
  local status
  status=$(docker inspect --format='{{json .State.Health.Status}}' "zeromttr-${service}" 2>/dev/null || echo '"unknown"')
  [ "$status" = '"healthy"' ]
}

for svc in prometheus loki tempo grafana otel-collector; do
  echo -n "Waiting for ${svc} to be healthy... "
  while ! check_healthy "$svc"; do
    NOW=$(date +%s)
    ELAPSED=$((NOW - START_TIME))
    if [ "$ELAPSED" -gt "$MAX_WAIT_SECONDS" ]; then
      echo "FAILED (timed out after ${ELAPSED}s)"
      exit 1
    fi
    sleep 1
  done
  echo "HEALTHY"
done

# 2. Check Grafana datasources
echo "Checking Grafana provisioned datasources..."
ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
ADMIN_PASS="${GRAFANA_ADMIN_PASSWORD:-change-me-strong-password}"
DATASOURCES=$(curl -s -f -u "${ADMIN_USER}:${ADMIN_PASS}" http://127.0.0.1:3000/api/datasources)
echo "$DATASOURCES" | grep -q "prometheus-datasource" || { echo "Prometheus datasource missing"; exit 1; }
echo "$DATASOURCES" | grep -q "loki-datasource" || { echo "Loki datasource missing"; exit 1; }
echo "$DATASOURCES" | grep -q "tempo-datasource" || { echo "Tempo datasource missing"; exit 1; }
echo "✅ Grafana lists all 3 datasources without error."

# 3. Check Grafana Contact Point Token
echo "Checking Grafana contact point authentication token..."
CONTACT_POINTS=$(curl -s -f -u "${ADMIN_USER}:${ADMIN_PASS}" http://127.0.0.1:3000/api/v1/provisioning/contact-points)
echo "$CONTACT_POINTS" | grep -q '"authorization_credentials":"\[REDACTED\]"' || { echo "GRAFANA_WEBHOOK_TOKEN missing in contact points"; exit 1; }
echo "$CONTACT_POINTS" | grep -q '"authorization_scheme":"Bearer"' || { echo "Bearer scheme missing in contact points"; exit 1; }
echo "✅ Grafana contact point uses Bearer authentication with provisioned secret."

# 4. Check OTel Collector OTTL PII Redaction
echo "Testing OTel Collector OTTL PII Redaction with Loki persistence..."
TIMESTAMP_NANO=$(date +%s%N)
RUN_ID="smoke-$(date +%s)-${RANDOM}"
PAYLOAD=$(cat <<EOF
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "api-pagamentos-core" } }
        ]
      },
      "scopeLogs": [
        {
          "scope": { "name": "verification-logger" },
          "logRecords": [
            {
              "timeUnixNano": "${TIMESTAMP_NANO}",
              "severityNumber": 17,
              "severityText": "ERROR",
              "body": {
                "stringValue": "[RUN_ID:${RUN_ID}] Transaction failed for CPF 123.456.789-00 and CNPJ 12.345.678/0001-99 with auth Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig"
              }
            }
          ]
        }
      ]
    }
  ]
}
EOF
)

curl -s -f -X POST http://127.0.0.1:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > /dev/null

echo "Waiting for log to be processed by OTel Collector transform processor and flushed to Loki..."
REDACTION_VERIFIED=false
for i in $(seq 1 15); do
  sleep 1
  LOKI_RES=$(curl -s -G 'http://127.0.0.1:3100/loki/api/v1/query_range' --data-urlencode "query={service=\"api-pagamentos-core\"} |= \"${RUN_ID}\"" || true)
  if grep -q "${RUN_ID}" <<< "$LOKI_RES" && \
     grep -q '\[REDACTED_CPF\]' <<< "$LOKI_RES" && \
     grep -q '\[REDACTED_CNPJ\]' <<< "$LOKI_RES" && \
     grep -q 'Bearer \[REDACTED_TOKEN\]' <<< "$LOKI_RES"; then
    
    # Assert raw sensitive data is strictly absent from Loki output
    if grep -q '123\.456\.789-00' <<< "$LOKI_RES" || \
       grep -q '12\.345\.678/0001-99' <<< "$LOKI_RES" || \
       grep -q 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.e30\.sig' <<< "$LOKI_RES"; then
      echo "❌ Security failure: Raw unredacted PII or token detected in Loki response!"
      exit 1
    fi

    REDACTION_VERIFIED=true
    break
  fi
done

if [ "$REDACTION_VERIFIED" != "true" ]; then
  echo "❌ OTTL PII redaction verification failed. Loki query output: $LOKI_RES"
  exit 1
fi

echo "✅ Loki log verified with [REDACTED_CPF], [REDACTED_CNPJ] and Bearer [REDACTED_TOKEN]."
echo "=================================================================="
echo "🎉 ALL PHASE 1 ACCEPTANCE CRITERIA VERIFIED AND GREEN!"
echo "=================================================================="
