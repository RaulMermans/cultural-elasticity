# Invalid attempt (harness environment error), kept for the record

2026-10-29. The first live competence launch was started with production variables injected by `railway run` and the database URL blanked.

- **What went wrong.** The process kept `NODE_ENV=production`, so the Qloo dispatch limiter required the durable run ledger. With no database, it refused every call before dispatch (`RUN_LEDGER_UNAVAILABLE … nothing was sent`).
- **What ran.** Case c1 ran both arms on no Qloo evidence (brand resolution failed 4 times), and the run was stopped by hand.
- **Spend.** 0 Qloo dispatches; about $0.008 Haiku.
- **What it says about the agent.** Nothing. These results are not agent outcomes and are excluded from the competence evaluation.
- **Fix.** `scripts/competence-live.sh` marks the process local, so it never uses the production ledger. The evaluation's own caps apply.
