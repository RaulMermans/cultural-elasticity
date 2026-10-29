#!/usr/bin/env bash
# Sprint 9O live competence evaluation, run by the owner on this machine (pre-registered: evals/competence/cases.json).
# Uses the production provider keys from Railway in a LOCAL process. It never touches the production database or the
# public evaluation's durable ledger: the overrides below mark the process local, and the evaluation enforces its own
# caps (300 live Qloo dispatches, $1.50 model) plus an in-memory process cap of 300.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$PWD/docs/sprint-9o/competence/live-1}"
mkdir -p "$OUT"
caffeinate -i railway run -- env \
  NODE_ENV=development \
  CE_PUBLIC_DEPLOYMENT=0 \
  CE_PUBLIC_EVALUATION= \
  DATABASE_URL= \
  CE_PROCESS_QLOO_CALL_LIMIT=300 \
  CE_ENGINE_REVISION="$(git rev-parse --short HEAD)" \
  pnpm --filter backend eval:competence -- --live --out "$OUT" 2>&1 | tee "$OUT/run.log"
