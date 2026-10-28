#!/usr/bin/env bash
# Opens the bounded, operator-only hosted live test on Railway (75 Qloo calls, $2.00 Haiku, 3-hour expiry).
# The operator token is written to a mode-600 file and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN_FILE="${1:-$HOME/.ce-operator-token}"
umask 077
openssl rand -hex 32 > "$TOKEN_FILE"
EXPIRES=$(date -u -v+3H +%Y-%m-%dT%H:%M:%SZ)
railway variable set CE_PAID_OPERATOR_TOKEN --stdin --skip-deploys < "$TOKEN_FILE" > /dev/null
for kv in \
  "CE_PAID_OPERATOR_EXPIRES_AT=$EXPIRES" \
  CE_SPEND_BUDGET_USD=2.00 \
  CE_INVESTIGATION_RESERVE_USD=0.50 \
  CE_PROCESS_QLOO_CALL_LIMIT=75 \
  CE_BASELINE_TOTAL_QLOO_CALLS=35 \
  CE_BASELINE_ENABLED=1 \
  CE_BASELINE_LIVE_ENABLED=1 \
  CE_ACCEPT_INVESTIGATIONS=1; do
  railway variable set "$kv" --skip-deploys > /dev/null
  echo "set ${kv%%=*}"
done
railway redeploy --yes > /dev/null
APP_URL="${CE_APP_URL:-https://cultural-elasticity-raulmermans-projects.vercel.app}"
echo "Redeploy started; waiting for live research to open (about 2 minutes)..."
for _ in $(seq 1 60); do
  curl -fsS "$APP_URL/api/brands/status" 2>/dev/null | grep -q '"enabled":true' && break
  sleep 5
done
# The fragment stays in this browser: it is never sent to Vercel or Railway, and the page removes it at once.
open "$APP_URL/operator#token=$(cat "$TOKEN_FILE")"
echo "Browser authorized and opened (expires $EXPIRES). Token kept in $TOKEN_FILE."
