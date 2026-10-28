#!/usr/bin/env bash
# Runs the full product on this Mac with live Qloo and Claude Haiku, for the owner only (localhost, no operator
# gate). Provider keys come from the linked Railway service at run time through `railway run`; nothing is
# written to disk. Spend is still capped by the in-app limits below; raise them deliberately.
set -euo pipefail
cd "$(dirname "$0")/.."
DATABASE_URL_LOCAL="${CE_LOCAL_DATABASE_URL:-postgresql://$(whoami)@127.0.0.1:55432/ce_local}"
exec railway run -- env \
  NODE_ENV=development \
  CE_PUBLIC_DEPLOYMENT=0 \
  HOST=127.0.0.1 \
  PORT=4000 \
  DATABASE_URL="$DATABASE_URL_LOCAL" \
  CE_BASELINE_ENABLED=1 \
  CE_BASELINE_LIVE_ENABLED=1 \
  CE_BASELINE_TOTAL_QLOO_CALLS="${CE_BASELINE_TOTAL_QLOO_CALLS:-49}" \
  CE_PROCESS_QLOO_CALL_LIMIT="${CE_PROCESS_QLOO_CALL_LIMIT:-100}" \
  CE_ACCEPT_INVESTIGATIONS=1 \
  CE_SPEND_BUDGET_USD="${CE_SPEND_BUDGET_USD:-2.50}" \
  CE_INVESTIGATION_RESERVE_USD=0.50 \
  CE_PAID_OPERATOR_TOKEN= \
  pnpm dev
