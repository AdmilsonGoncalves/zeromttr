#!/usr/bin/env bash
set -euo pipefail

# scripts/reset.sh — ZeroMTTR Demo Restoration & Cleanup
# Desativa a degradação no contêiner, limpa incidentes ativos e fecha PRs/branches hotfix/zeromttr-* no GitHub.

TARGET_URL="${TARGET_DEMO_URL:-http://localhost:3001}"
ORCH_URL="${ORCHESTRATOR_URL:-http://localhost:8080}"
GITHUB_REPO="${TARGET_GITHUB_REPO:-AdmilsonGoncalves/zeromttr}"
# Normalize repo string in case full URL was passed
GITHUB_REPO="${GITHUB_REPO#https://github.com/}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

echo "=========================================================="
echo "⚡ ZeroMTTR — Restauração de Ambiente e Limpeza (Reset)"
echo "Target App: ${TARGET_URL}"
echo "Orchestrator: ${ORCH_URL}"
echo "GitHub Repo: ${GITHUB_REPO}"
echo "=========================================================="

echo "[1/3] Restaurando contêiner api-pagamentos-core para estado saudável (v2.14.7)..."
RESET_RES=$(curl -s -X POST "${TARGET_URL}/chaos/pool-saturation?enable=false" \
  -H "Content-Type: application/json" || true)
echo "Resposta do contêiner alvo: ${RESET_RES}"

echo "[2/3] Verificando status pós-reset..."
STATUS_RES=$(curl -s "${TARGET_URL}/chaos/status" || true)
echo "Status: ${STATUS_RES}"

echo "[3/3] Limpando Pull Requests e branches hotfix/zeromttr-* no GitHub..."
if [ -n "${GITHUB_TOKEN}" ]; then
  # List open PRs with up to 100 items per page
  PRS=$(curl -s -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPO}/pulls?state=open&per_page=100" || echo "[]")

  # Find PRs with head branch starting with hotfix/zeromttr-
  if ! echo "${PRS}" | jq -e 'type == "array"' > /dev/null 2>&1; then
    echo "⚠️ Resposta inesperada da API do GitHub. Pulando limpeza de PRs." >&2
    PRS="[]"
  fi
  HOTFIX_PRS=$(echo "${PRS}" | jq -r '.[] | select(.head.ref | startswith("hotfix/zeromttr-")) | "\(.number) \(.head.ref)"' || true)

  if [ -n "${HOTFIX_PRS}" ]; then
    CLEANUP_ERRORS=0
    while read -r pr_number branch_ref; do
      if [ -n "${pr_number}" ]; then
        echo "Fechando PR #${pr_number} (branch: ${branch_ref})..."
        if ! curl -fsS -X PATCH -H "Authorization: Bearer ${GITHUB_TOKEN}" \
          -H "Accept: application/vnd.github+json" \
          "https://api.github.com/repos/${GITHUB_REPO}/pulls/${pr_number}" \
          -d '{"state":"closed"}' > /dev/null; then
          echo "⚠️ Falha ao fechar PR #${pr_number}" >&2
          CLEANUP_ERRORS=$((CLEANUP_ERRORS + 1))
        fi

        echo "Removendo branch remota ${branch_ref}..."
        if ! curl -fsS -X DELETE -H "Authorization: Bearer ${GITHUB_TOKEN}" \
          -H "Accept: application/vnd.github+json" \
          "https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/${branch_ref}" > /dev/null; then
          echo "⚠️ Falha ao remover branch ${branch_ref}" >&2
          CLEANUP_ERRORS=$((CLEANUP_ERRORS + 1))
        fi
      fi
    done <<< "${HOTFIX_PRS}"

    if [ "$CLEANUP_ERRORS" -eq 0 ]; then
      echo "Pull Requests e branches temporárias limpos com sucesso."
    else
      echo "⚠️ Limpeza de PRs/branches concluída com ${CLEANUP_ERRORS} falha(s)." >&2
    fi
  else
    echo "Nenhum PR ativo de hotfix encontrado para fechar."
  fi
else
  echo "GITHUB_TOKEN não configurado. Pulando limpeza de PRs remotos no GitHub."
fi

echo ""
echo "=========================================================="
echo "✅ Ambiente restaurado para Baseline Saudável (v2.14.7)."
echo "=========================================================="
