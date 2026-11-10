#!/usr/bin/env bash
set -euo pipefail

# scripts/chaos.sh — ZeroMTTR Demo Chaos Injection
# Ativa a degradação da release v2.14.8 (saturação do pool de conexões) e gera carga concorrente por 60s.

TARGET_URL="${TARGET_DEMO_URL:-http://localhost:3001}"
DURATION="${CHAOS_DURATION:-60}"
CONCURRENCY="${CHAOS_CONCURRENCY:-5}"

echo "=========================================================="
echo "⚡ ZeroMTTR — Injeção de Caos (Release v2.14.8 Simulation)"
echo "Target: ${TARGET_URL}"
echo "Duração: ${DURATION}s | Concorrência: ${CONCURRENCY} workers"
echo "=========================================================="

echo "[1/2] Ativando saturação do pool de conexões (v2.14.8)..."
CHAOS_RES=$(curl -fsS -X POST "${TARGET_URL}/chaos/pool-saturation?enable=true" \
  -H "Content-Type: application/json") || {
  echo "❌ Falha ao ativar o caos em ${TARGET_URL}. Abortando." >&2
  exit 1
}

echo "Resposta do contêiner alvo: ${CHAOS_RES}"
echo ""

echo "[2/2] Gerando carga concorrente de transações PIX por ${DURATION}s..."

PAYLOAD='{
  "amount": 199.90,
  "currency": "BRL",
  "payerCpf": "123.456.789-00",
  "merchantCnpj": "12.345.678/0001-99",
  "pixKey": "cliente.silva@exemplo.com.br",
  "description": "Demonstracao ZeroMTTR Incidente PIX",
  "authHeader": "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
}'

END_TIME=$((SECONDS + DURATION))

worker_loop() {
  local worker_id=$1
  while [ $SECONDS -lt $END_TIME ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${TARGET_URL}/payments" \
      -H "Content-Type: application/json" \
      -d "${PAYLOAD}" \
      --max-time 6 || true)
    HTTP_CODE="${HTTP_CODE:-000}"
    
    if [ "$HTTP_CODE" = "201" ]; then
      echo "[Worker ${worker_id}] PIX processado (201 OK)"
    elif [ "$HTTP_CODE" = "503" ]; then
      echo "[Worker ${worker_id}] Pool Saturated (503 KnexTimeoutError) ⚠️"
    else
      echo "[Worker ${worker_id}] HTTP Code: ${HTTP_CODE}"
    fi
    sleep 0.2
  done
}

for i in $(seq 1 "$CONCURRENCY"); do
  worker_loop "$i" &
done

wait

echo ""
echo "=========================================================="
echo "⚡ Injeção de caos finalizada."
echo "Status atual da aplicação alvo:"
curl -s "${TARGET_URL}/chaos/status" | jq . || curl -s "${TARGET_URL}/chaos/status"
echo ""
echo "=========================================================="
