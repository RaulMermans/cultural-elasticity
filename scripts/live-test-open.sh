#!/usr/bin/env bash
# Opens the bounded, operator-only hosted live test on Railway (75 Qloo calls, $2.00 Haiku, 3-hour expiry).
# Requires the owner's approval for this window. The operator token is written to a mode-600 file and never printed.
#   scripts/live-test-open.sh [token-file] [--no-open]
# CE_BASELINE_ALLOCATION (default 21) is the share of the 75 calls baseline scans may use. The baseline budget is
# cumulative in PostgreSQL, so the absolute limit is computed from the calls already used, never a fixed number.
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN_FILE="$HOME/.ce-operator-token"
OPEN_BROWSER=1
for a in "$@"; do case "$a" in --no-open) OPEN_BROWSER=0 ;; *) TOKEN_FILE="$a" ;; esac; done
API="${CE_API_URL:-https://cultural-elasticity-api-production.up.railway.app}"
APP_URL="${CE_APP_URL:-https://cultural-elasticity-raulmermans-projects.vercel.app}"
ALLOCATION="${CE_BASELINE_ALLOCATION:-21}"

# Refuse unless the CLI is linked to the expected project, environment and service.
railway status --json | node -e '
  const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const env = s.environments?.edges?.map((e) => e.node).find((e) => e.name === "production");
  if (s.name !== "cultural-elasticity" || !env) { console.error("REFUSED: Railway CLI is not linked to cultural-elasticity/production"); process.exit(1); }'

# Current cumulative baseline usage, read with the diagnostics token (piped, never printed). Fail closed.
USED=$(railway variables --json | node -e '
  const v = JSON.parse(require("fs").readFileSync(0, "utf8"));
  fetch(process.argv[1] + "/ops/baselines", { headers: { "x-ce-operator": v.CE_OPERATOR_TOKEN ?? "" } })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .then((b) => { if (typeof b.qlooCallBudget?.usedCalls !== "number") throw new Error("no budget"); console.log(b.qlooCallBudget.usedCalls); })
    .catch(() => { console.error("REFUSED: cannot read cumulative baseline usage"); process.exit(1); });' "$API")
BASELINE_TOTAL=$((USED + ALLOCATION))
echo "baseline calls already used: $USED; absolute limit for this window: $BASELINE_TOTAL"

umask 077
openssl rand -hex 32 > "$TOKEN_FILE"
EXPIRES=$(date -u -v+3H +%Y-%m-%dT%H:%M:%SZ)
railway variable set CE_PAID_OPERATOR_TOKEN --stdin --skip-deploys < "$TOKEN_FILE" > /dev/null
for kv in \
  "CE_PAID_OPERATOR_EXPIRES_AT=$EXPIRES" \
  CE_SPEND_BUDGET_USD=2.00 \
  CE_INVESTIGATION_RESERVE_USD=0.50 \
  CE_PROCESS_QLOO_CALL_LIMIT=75 \
  "CE_BASELINE_TOTAL_QLOO_CALLS=$BASELINE_TOTAL" \
  CE_BASELINE_ENABLED=1 \
  CE_BASELINE_LIVE_ENABLED=1 \
  CE_ACCEPT_INVESTIGATIONS=1; do
  railway variable set "$kv" --skip-deploys > /dev/null
  echo "set ${kv%%=*}"
done
# Redeploys the current deployment with the new variables (same commit; not a rebuild of local files).
railway redeploy --yes > /dev/null
echo "Redeploy started; waiting for admissions to open (about 2 minutes)..."
for _ in $(seq 1 60); do
  curl -fsS "$APP_URL/api/brands/status" 2>/dev/null | grep -q '"admissionsOpen":true' && break
  sleep 5
done
node scripts/release/verify-production.mjs --public-mode --expect-admissions open || echo "Window opened, but verification did not pass: read the codes above before any paid use."
if [ "$OPEN_BROWSER" = 1 ]; then
  # The fragment stays in this browser: it is never sent to Vercel or Railway, and the page removes it at once.
  open "$APP_URL/operator#token=$(cat "$TOKEN_FILE")"
  echo "Browser authorized and opened (expires $EXPIRES). Token kept in $TOKEN_FILE."
else
  echo "Window open until $EXPIRES. Token kept in $TOKEN_FILE (not opened in a browser)."
fi
