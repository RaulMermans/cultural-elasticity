#!/usr/bin/env bash
# Kill switch for the Sprint 9M public evaluation: anonymous paid research off, every admission flag back to 0.
# The durable counters are kept, so reopening the same evaluation id continues them.
set -euo pipefail
cd "$(dirname "$0")/.."
for kv in CE_PUBLIC_EVALUATION=0 CE_ACCEPT_INVESTIGATIONS=0 CE_BASELINE_ENABLED=0 CE_BASELINE_LIVE_ENABLED=0 CE_BASELINE_TOTAL_QLOO_CALLS=0; do
  railway variable set "$kv" --skip-deploys > /dev/null
  echo "set ${kv%%=*}"
done
railway redeploy --yes > /dev/null
echo "Public evaluation closed; redeploy started. Verify with: curl -s https://cultural-elasticity-raulmermans-projects.vercel.app/api/brands/status"
