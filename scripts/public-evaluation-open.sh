#!/usr/bin/env bash
# Opens the Sprint 9M public evaluation on Railway: anonymous visitors may run real Qloo + Haiku research under
# durable global and per-network quotas until the expiry. Requires the owner's explicit approval of the caps below.
#   CE_APPROVED_QLOO_CALLS=<n> CE_APPROVED_USD=<usd> scripts/public-evaluation-open.sh
# Both approvals must be given explicitly; there is no default spend. The evaluation id keys the durable ledger,
# so reopening with the same id continues the same counters (a restart or a re-run never grants a fresh cap).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CE_APPROVED_QLOO_CALLS:?REFUSED: set CE_APPROVED_QLOO_CALLS to the owner-approved total Qloo call cap}"
: "${CE_APPROVED_USD:?REFUSED: set CE_APPROVED_USD to the owner-approved total model spend cap}"
EVALUATION_ID="${CE_PUBLIC_EVALUATION_ID:-qloo-hackathon-2026}"
EXPIRES="${CE_PUBLIC_EVALUATION_EXPIRES_AT:-2026-11-06T05:00:00Z}"   # Judging ends 2026-11-05 23:45 ET.
BASELINE_SHARE="${CE_BASELINE_ALLOCATION:-$((CE_APPROVED_QLOO_CALLS * 2 / 5))}"
API="${CE_API_URL:-https://cultural-elasticity-api-production.up.railway.app}"
APP_URL="${CE_APP_URL:-https://cultural-elasticity-raulmermans-projects.vercel.app}"

railway status --json | node -e '
  const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const env = s.environments?.edges?.map((e) => e.node).find((e) => e.name === "production");
  if (s.name !== "cultural-elasticity" || !env) { console.error("REFUSED: Railway CLI is not linked to cultural-elasticity/production"); process.exit(1); }'

# The baseline budget is cumulative in PostgreSQL: the absolute limit is today's usage plus this evaluation's share.
USED=$(railway variables --json | node -e '
  const v = JSON.parse(require("fs").readFileSync(0, "utf8"));
  fetch(process.argv[1] + "/ops/baselines", { headers: { "x-ce-operator": v.CE_OPERATOR_TOKEN ?? "" } })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .then((b) => { if (typeof b.qlooCallBudget?.usedCalls !== "number") throw new Error("no budget"); console.log(b.qlooCallBudget.usedCalls); })
    .catch(() => { console.error("REFUSED: cannot read cumulative baseline usage"); process.exit(1); });' "$API")
echo "baseline calls already used: $USED; baseline share of this evaluation: $BASELINE_SHARE"

for kv in \
  CE_PUBLIC_EVALUATION=1 \
  "CE_PUBLIC_EVALUATION_ID=$EVALUATION_ID" \
  "CE_PUBLIC_EVALUATION_EXPIRES_AT=$EXPIRES" \
  "CE_PUBLIC_QUOTA_RESOLVES=${CE_PUBLIC_QUOTA_RESOLVES:-10}" \
  "CE_PUBLIC_QUOTA_SCANS=${CE_PUBLIC_QUOTA_SCANS:-4}" \
  "CE_PUBLIC_QUOTA_INVESTIGATIONS=${CE_PUBLIC_QUOTA_INVESTIGATIONS:-4}" \
  "CE_SPEND_BUDGET_USD=$CE_APPROVED_USD" \
  CE_INVESTIGATION_RESERVE_USD=0.50 \
  "CE_PROCESS_QLOO_CALL_LIMIT=$CE_APPROVED_QLOO_CALLS" \
  "CE_BASELINE_TOTAL_QLOO_CALLS=$((USED + BASELINE_SHARE))" \
  CE_BASELINE_ENABLED=1 \
  CE_BASELINE_LIVE_ENABLED=1 \
  CE_ACCEPT_INVESTIGATIONS=1; do
  railway variable set "$kv" --skip-deploys > /dev/null
  echo "set ${kv%%=*}"
done
railway redeploy --yes > /dev/null
echo "Redeploy started; waiting for public admissions (about 2 minutes)..."
for _ in $(seq 1 60); do
  curl -fsS "$APP_URL/api/brands/status" 2>/dev/null | grep -q '"enabled":true' && break
  sleep 5
done
curl -fsS "$APP_URL/api/brands/status" && echo
echo "Public evaluation '$EVALUATION_ID' open until $EXPIRES. Close it with scripts/public-evaluation-close.sh."
