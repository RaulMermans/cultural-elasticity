/**
 * Sprint 9L: brand-research availability is reported per caller. SYNTHETIC credentials; no Qloo, no database.
 */
import { describe, expect, it } from "vitest";
import { brandStatusForCaller } from "../src/brand-baseline/api.js";

const SECRET = "ce-synthetic-internal-auth-secret-9l-0000";
const PAID = "ce-synthetic-paid-operator-token-9l-xxxx";
const publicEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "production", CE_PUBLIC_DEPLOYMENT: "1", CE_INTERNAL_API_SECRET: SECRET, ...extra });
const viaNext = (operator?: string) => ({ "x-ce-internal-auth": SECRET, ...(operator ? { "x-ce-paid-operator": operator } : {}) });

describe("brand status for the caller", () => {
  it("an anonymous visitor never sees brand search enabled while admissions are open", () => {
    const status = brandStatusForCaller(true, viaNext(), publicEnv({ CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: "2999-01-01T00:00:00Z" }));
    expect(status).toMatchObject({ enabled: false, admissionsOpen: true, operator: "operator_required" });
  });

  it("an authorized operator sees it enabled only while admissions are open", () => {
    const env = publicEnv({ CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: "2999-01-01T00:00:00Z" });
    expect(brandStatusForCaller(true, viaNext(PAID), env)).toMatchObject({ enabled: true, operator: "authorized" });
    expect(brandStatusForCaller(false, viaNext(PAID), env)).toMatchObject({ enabled: false, admissionsOpen: false, operator: "authorized" });
  });

  it("an expired authorization reads as expired, not available", () => {
    const env = publicEnv({ CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: "2001-01-01T00:00:00Z" });
    expect(brandStatusForCaller(true, viaNext(PAID), env)).toMatchObject({ enabled: false, operator: "operator_expired" });
  });

  it("a token with no expiry, or no token at all, never authorizes on a public runtime", () => {
    expect(brandStatusForCaller(true, viaNext(PAID), publicEnv({ CE_PAID_OPERATOR_TOKEN: PAID })).enabled).toBe(false);
    expect(brandStatusForCaller(true, viaNext(PAID), publicEnv()).enabled).toBe(false);
  });

  it("the credential is not evaluated for a request that skipped internal auth", () => {
    const env = publicEnv({ CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: "2999-01-01T00:00:00Z" });
    expect(brandStatusForCaller(true, { "x-ce-paid-operator": PAID }, env)).toMatchObject({ enabled: false, operator: "operator_required" });
  });

  it("a private process without a configured token keeps local research usable", () => {
    expect(brandStatusForCaller(true, {}, { NODE_ENV: "development" })).toMatchObject({ enabled: true, operator: "authorized" });
  });
});
