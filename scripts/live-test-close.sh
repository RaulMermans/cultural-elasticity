#!/usr/bin/env bash
# Closes the hosted live test: every admission flag back to 0 and the operator token removed.
set -euo pipefail
cd "$(dirname "$0")/.."
for kv in CE_ACCEPT_INVESTIGATIONS=0 CE_BASELINE_ENABLED=0 CE_BASELINE_LIVE_ENABLED=0 CE_BASELINE_TOTAL_QLOO_CALLS=0 CE_SPEND_BUDGET_USD=2.5 CE_INVESTIGATION_RESERVE_USD=1; do
  railway variable set "$kv" --skip-deploys > /dev/null
  echo "set ${kv%%=*}"
done
railway variable delete CE_PAID_OPERATOR_TOKEN > /dev/null || true
railway variable delete CE_PAID_OPERATOR_EXPIRES_AT > /dev/null || true
railway variable delete CE_PROCESS_QLOO_CALL_LIMIT > /dev/null || true
railway redeploy --yes > /dev/null
rm -f "${1:-$HOME/.ce-operator-token}"
echo "Admissions closed and redeploy started."
