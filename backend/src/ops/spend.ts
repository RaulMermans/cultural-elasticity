/**
 * Reservation-based spend control for one backend process.
 *
 * Not a billing system. In-memory only: a restart resets the ledger, and a second instance
 * would not share it. Public deployment must run one backend replica and keep a provider-side
 * Anthropic workspace limit as the durable backstop.
 *
 * Observed provider usage is never truncated to the original reservation. An overage is recorded
 * and reduces remaining budget. A reservation is a ceiling for admitting and authorizing further
 * model calls, not a cap on what is written down after the fact.
 */
import { randomUUID } from "node:crypto";
import { conservativeReserveUsd, PRICING_AS_OF, PRICING_SOURCE, roundUsd } from "./pricing.js";
import { publicRuntime } from "../config/production.js";

export type SpendUncertainty = "none" | "provider_usage_missing" | "estimate_only";

export type SpendReservation = {
  id: string;
  jobId: string | null;
  reservedUsd: number;
  observedUsd: number | null;
  consumedUsd: number;
  overageUsd: number;
  released: boolean;
  started: boolean;
  uncertainty: SpendUncertainty;
};

export type SpendSnapshot = {
  configuredUsd: number | null;
  reservedUsd: number;
  consumedUsd: number;
  observedUsd: number;
  estimatedUsd: number;
  chargedOrEstimatedUsd: number;
  overageUsd: number;
  unknownUsageReserveUsd: number;
  remainingBudgetUsd: number | null;
  availableUsd: number | null;
  reservations: number;
  uncertaintyCounts: Record<SpendUncertainty, number>;
  pricingAsOf: typeof PRICING_AS_OF;
  pricingSource: typeof PRICING_SOURCE;
  durable: false;
  multiInstanceSafe: false;
};

export type ReserveResult =
  | { ok: true; reservation: SpendReservation }
  | { ok: false; code: "budget_unavailable" | "budget_exhausted"; message: string };

export type SettleInput = {
  observedUsd: number | null;
  started: boolean;
  cancelledBeforeStart?: boolean;
};

export type SpendBound = {
  reservationId: string;
  authorizedUsd: number;
  observedUsd(): number;
  remainingUsd(): number;
  authorizeNextCall(estimateUsd: number): boolean;
  addObserved(usd: number): void;
  markUnknownCall(ceilingUsd: number): void;
};

export class SpendLedger {
  private readonly holds = new Map<string, SpendReservation>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  configuredBudgetUsd(): number | null {
    if (this.env.CE_SPEND_BUDGET_USD === undefined || this.env.CE_SPEND_BUDGET_USD === "") return null;
    const parsed = Number(this.env.CE_SPEND_BUDGET_USD);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  required(): boolean {
    return publicRuntime(this.env);
  }

  get(id: string): SpendReservation | undefined {
    return this.holds.get(id);
  }

  reserve(jobId: string | null = null): ReserveResult {
    if (this.required() && this.configuredBudgetUsd() === null) {
      return {
        ok: false,
        code: "budget_unavailable",
        message: "Investigations cannot start because a spend budget is not configured.",
      };
    }
    const budget = this.configuredBudgetUsd();
    const reservedUsd = conservativeReserveUsd(this.env);
    if (budget !== null && this.outstandingUsd() + reservedUsd > budget) {
      return {
        ok: false,
        code: "budget_exhausted",
        message: "The available investigation budget cannot cover another run.",
      };
    }
    const reservation: SpendReservation = {
      id: randomUUID(),
      jobId,
      reservedUsd,
      observedUsd: null,
      consumedUsd: 0,
      overageUsd: 0,
      released: false,
      started: false,
      uncertainty: "none",
    };
    this.holds.set(reservation.id, reservation);
    return { ok: true, reservation };
  }

  attach(id: string, jobId: string): void {
    const hold = this.holds.get(id);
    if (hold && !hold.released) hold.jobId = jobId;
  }

  markStarted(id: string): void {
    const hold = this.holds.get(id);
    if (hold && !hold.released) hold.started = true;
  }

  /**
   * In-flight observed usage. Never truncates. Concurrent admissions see max(reserved, observed)
   * for this hold, so an overage cannot be hidden from the remaining budget.
   */
  recordProgress(id: string, observedUsd: number): SpendReservation | null {
    const hold = this.holds.get(id);
    if (!hold || hold.released) return hold ?? null;
    if (!Number.isFinite(observedUsd) || observedUsd < 0) return hold;
    const next = roundUsd(Math.max(hold.observedUsd ?? 0, observedUsd));
    hold.observedUsd = next;
    hold.overageUsd = roundUsd(Math.max(0, next - hold.reservedUsd));
    return hold;
  }

  settle(id: string, input: SettleInput): SpendReservation | null {
    const hold = this.holds.get(id);
    if (!hold || hold.released) return hold ?? null;
    if (input.cancelledBeforeStart && !input.started && !hold.started) {
      hold.consumedUsd = 0;
      hold.observedUsd = 0;
      hold.overageUsd = 0;
      hold.released = true;
      hold.uncertainty = "none";
      return hold;
    }
    if (input.started) hold.started = true;
    const known = [input.observedUsd, hold.observedUsd].filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    if (known.length > 0) {
      const observed = roundUsd(Math.max(...known));
      hold.observedUsd = observed;
      hold.consumedUsd = observed;
      hold.overageUsd = roundUsd(Math.max(0, observed - hold.reservedUsd));
      hold.uncertainty = "none";
    } else {
      hold.observedUsd = null;
      hold.consumedUsd = hold.reservedUsd;
      hold.overageUsd = 0;
      hold.uncertainty = "provider_usage_missing";
    }
    hold.released = true;
    return hold;
  }

  bound(id: string): SpendBound | null {
    const hold = this.holds.get(id);
    if (!hold) return null;
    return {
      reservationId: id,
      authorizedUsd: hold.reservedUsd,
      observedUsd: () => this.holds.get(id)?.observedUsd ?? 0,
      remainingUsd: () => {
        const current = this.holds.get(id);
        if (!current || current.released) return 0;
        return roundUsd(Math.max(0, current.reservedUsd - (current.observedUsd ?? 0)));
      },
      authorizeNextCall: (estimateUsd: number) => {
        const current = this.holds.get(id);
        if (!current || current.released) return false;
        if (!Number.isFinite(estimateUsd) || estimateUsd < 0) return false;
        const remaining = Math.max(0, current.reservedUsd - (current.observedUsd ?? 0));
        return estimateUsd <= remaining;
      },
      addObserved: (usd: number) => {
        const current = this.holds.get(id);
        if (!current || current.released) return;
        const next = roundUsd((current.observedUsd ?? 0) + Math.max(0, usd));
        this.recordProgress(id, next);
      },
      markUnknownCall: (ceilingUsd: number) => {
        const current = this.holds.get(id);
        if (!current || current.released) return;
        current.uncertainty = current.uncertainty === "none" ? "estimate_only" : current.uncertainty;
        const next = roundUsd((current.observedUsd ?? 0) + Math.max(0, ceilingUsd));
        this.recordProgress(id, next);
      },
    };
  }

  outstandingUsd(): number {
    let total = 0;
    for (const hold of this.holds.values()) {
      if (hold.released) total += hold.consumedUsd;
      else total += Math.max(hold.reservedUsd, hold.observedUsd ?? 0);
    }
    return roundUsd(total);
  }

  snapshot(): SpendSnapshot {
    const configuredUsd = this.configuredBudgetUsd();
    const reservedUsd = roundUsd(
      [...this.holds.values()].filter((hold) => !hold.released).reduce((sum, hold) => sum + hold.reservedUsd, 0),
    );
    const released = [...this.holds.values()].filter((hold) => hold.released);
    const consumedUsd = roundUsd(released.reduce((sum, hold) => sum + hold.consumedUsd, 0));
    const observedUsd = roundUsd(
      [...this.holds.values()].reduce((sum, hold) => sum + (hold.observedUsd ?? 0), 0),
    );
    const estimatedUsd = roundUsd(
      released.filter((hold) => hold.uncertainty === "provider_usage_missing" || hold.uncertainty === "estimate_only").reduce((sum, hold) => sum + hold.consumedUsd, 0),
    );
    const overageUsd = roundUsd([...this.holds.values()].reduce((sum, hold) => sum + hold.overageUsd, 0));
    const unknownUsageReserveUsd = roundUsd(
      released.filter((hold) => hold.uncertainty === "provider_usage_missing").reduce((sum, hold) => sum + hold.consumedUsd, 0),
    );
    const remainingBudgetUsd = configuredUsd === null ? null : roundUsd(Math.max(0, configuredUsd - this.outstandingUsd()));
    const uncertaintyCounts: Record<SpendUncertainty, number> = {
      none: 0,
      provider_usage_missing: 0,
      estimate_only: 0,
    };
    for (const hold of this.holds.values()) uncertaintyCounts[hold.uncertainty] += 1;
    return {
      configuredUsd,
      reservedUsd,
      consumedUsd,
      observedUsd,
      estimatedUsd,
      chargedOrEstimatedUsd: consumedUsd,
      overageUsd,
      unknownUsageReserveUsd,
      remainingBudgetUsd,
      availableUsd: remainingBudgetUsd,
      reservations: this.holds.size,
      uncertaintyCounts,
      pricingAsOf: PRICING_AS_OF,
      pricingSource: PRICING_SOURCE,
      durable: false,
      multiInstanceSafe: false,
    };
  }
}

let ledger = new SpendLedger();

export function spendLedger(): SpendLedger {
  return ledger;
}

export function resetSpend(env: NodeJS.ProcessEnv = process.env): SpendLedger {
  ledger = new SpendLedger(env);
  return ledger;
}

/**
 * Sprint 10C: the envelope of a recovered durable job. Its model reservation was taken (and durably held) when the job
 * was admitted by an earlier process, so no new reservation is made: the replay re-adds the usage the journal recorded
 * and new calls are bounded by what remains of the original authorization.
 */
export function fixedSpendBound(authorizedUsd: number): SpendBound {
  let observed = 0;
  return {
    reservationId: "recovered",
    authorizedUsd,
    observedUsd: () => observed,
    remainingUsd: () => roundUsd(Math.max(0, authorizedUsd - observed)),
    authorizeNextCall: (estimateUsd: number) => Number.isFinite(estimateUsd) && estimateUsd >= 0 && estimateUsd <= Math.max(0, authorizedUsd - observed),
    addObserved: (usd: number) => {
      observed = roundUsd(observed + Math.max(0, usd));
    },
    markUnknownCall: (ceilingUsd: number) => {
      observed = roundUsd(observed + Math.max(0, ceilingUsd));
    },
  };
}
