/**
 * Reservation-based spend control for one backend process.
 *
 * Not a billing system. In-memory only: a restart resets the ledger, and a second instance
 * would not share it. Public deployment must run one backend replica and keep a provider-side
 * Anthropic workspace limit as the durable backstop.
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
  released: boolean;
  started: boolean;
  uncertainty: SpendUncertainty;
};

export type SpendSnapshot = {
  configuredUsd: number | null;
  reservedUsd: number;
  consumedUsd: number;
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

  settle(id: string, input: SettleInput): SpendReservation | null {
    const hold = this.holds.get(id);
    if (!hold || hold.released) return hold ?? null;
    if (input.cancelledBeforeStart && !input.started && !hold.started) {
      hold.consumedUsd = 0;
      hold.observedUsd = 0;
      hold.released = true;
      hold.uncertainty = "none";
      return hold;
    }
    if (input.started) hold.started = true;
    if (input.observedUsd !== null && Number.isFinite(input.observedUsd) && input.observedUsd >= 0) {
      hold.observedUsd = input.observedUsd;
      hold.consumedUsd = Math.min(hold.reservedUsd, roundUsd(input.observedUsd));
      hold.uncertainty = "none";
    } else {
      hold.observedUsd = null;
      hold.consumedUsd = hold.reservedUsd;
      hold.uncertainty = "provider_usage_missing";
    }
    hold.released = true;
    return hold;
  }

  outstandingUsd(): number {
    let total = 0;
    for (const hold of this.holds.values()) {
      total += hold.released ? hold.consumedUsd : hold.reservedUsd;
    }
    return roundUsd(total);
  }

  snapshot(): SpendSnapshot {
    const configuredUsd = this.configuredBudgetUsd();
    const reservedUsd = roundUsd(
      [...this.holds.values()].filter((hold) => !hold.released).reduce((sum, hold) => sum + hold.reservedUsd, 0),
    );
    const consumedUsd = roundUsd(
      [...this.holds.values()].filter((hold) => hold.released).reduce((sum, hold) => sum + hold.consumedUsd, 0),
    );
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
      availableUsd: configuredUsd === null ? null : roundUsd(Math.max(0, configuredUsd - this.outstandingUsd())),
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
