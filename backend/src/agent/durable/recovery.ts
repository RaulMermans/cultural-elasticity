/**
 * Sprint 10C: deterministic recovery rules for an interrupted durable job. Code decides; no model is asked how to
 * recover. The order matters and is part of the contract (tests/durable-recovery-rules.test.ts):
 *
 *   1. cancellation requested            → CANCELLED (user intent wins; nothing resumes)
 *   2. a provider call may have been sent → QUARANTINE (INTERRUPTED_UNCERTAIN), unless an operator accepted the
 *      but its answer was not committed     unknown outcomes (they then stay charged, UNKNOWN_ACCEPTED)
 *   3. run deadline passed                → FAILED, INVESTIGATION_TIMEOUT (the deadline is never reset by a restart)
 *   4. attempts exhausted                 → FAILED, RECOVERY_LIMIT_REACHED
 *   5. otherwise                          → RESUME by deterministic replay of the committed journal
 *
 * Committed evidence is never discarded by any of these outcomes: the journal and checkpoints stay for the retention
 * window, and an interrupted job's partial evidence is not presented as a finding.
 */
import type { CallRow, JobRow } from "./store.js";

export type RecoveryAction = "cancel" | "quarantine" | "timeout" | "attempts_exhausted" | "resume";

export type RecoveryDecision = {
  action: RecoveryAction;
  reason: string;
  /** Calls whose outcome is unknown (DISPATCHING or OUTCOME_UNKNOWN). */
  unknown: string[];
  /** Calls with a committed answer that a replay will reuse. */
  committed: string[];
};

export const DEFAULT_MAX_ATTEMPTS = 3;

export function decideRecovery(job: Pick<JobRow, "cancelRequested" | "deadlineAt" | "attempt">, calls: Pick<CallRow, "opKey" | "status">[], now: Date, maxAttempts = DEFAULT_MAX_ATTEMPTS): RecoveryDecision {
  const unknown = calls.filter((c) => c.status === "DISPATCHING" || c.status === "OUTCOME_UNKNOWN").map((c) => c.opKey);
  const committed = calls.filter((c) => c.status === "COMPLETED" || c.status === "FAILED").map((c) => c.opKey);
  const base = { unknown, committed };
  if (job.cancelRequested) return { action: "cancel", reason: "the user cancelled this investigation", ...base };
  if (unknown.length > 0) return { action: "quarantine", reason: `${unknown.length} provider call(s) may have been sent without a committed answer; they are not repeated automatically`, ...base };
  if (job.deadlineAt.getTime() <= now.getTime()) return { action: "timeout", reason: "the run deadline passed while the investigation was interrupted", ...base };
  // `attempt` already counts the claim made for this recovery.
  if (job.attempt > maxAttempts) return { action: "attempts_exhausted", reason: `the investigation was interrupted ${job.attempt - 1} times`, ...base };
  return { action: "resume", reason: committed.length ? `replaying ${committed.length} committed provider call(s)` : "no provider call was committed; starting the job again", ...base };
}
