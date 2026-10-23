/**
 * Cached, operator-triggered provider connectivity. Not a health check.
 *
 * /health is liveness. /ready is admission. This cache is the only place that may claim a real
 * Qloo or Haiku connection test, and only after an operator probe. A harness binary that starts
 * is not connectivity. Agent competence is a separate evaluation gate.
 */
export type ProviderName = "qloo" | "haiku";
export type ProbeStatus = "not_probed" | "ok" | "failed" | "expired";

export type ProbeRecord = {
  provider: ProviderName;
  status: ProbeStatus;
  at: string | null;
  expiresAt: string | null;
  detail: string;
  liveCall: boolean;
};

export type ProviderConnectivity = {
  qloo: ProbeRecord;
  haiku: ProbeRecord;
  semantics: "provider_connectivity";
};

export type ProbeFn = () => Promise<{ ok: boolean; detail: string }>;

export const PROVIDER_PROBE_TTL_MS = 10 * 60 * 1000;

function blank(provider: ProviderName): ProbeRecord {
  return {
    provider,
    status: "not_probed",
    at: null,
    expiresAt: null,
    detail: "No operator connectivity probe has been run in this process. Credential presence is not a connection test.",
    liveCall: false,
  };
}

function expire(record: ProbeRecord, now: number): ProbeRecord {
  if (record.status === "not_probed" || !record.expiresAt) return record;
  if (Date.parse(record.expiresAt) > now) return record;
  return { ...record, status: "expired", detail: "The last operator probe has expired. Run POST /ops/providers/probe to re-test." };
}

let cache: ProviderConnectivity = { qloo: blank("qloo"), haiku: blank("haiku"), semantics: "provider_connectivity" };
let qlooProbe: ProbeFn | undefined;
let haikuProbe: ProbeFn | undefined;

export function resetProviderConnectivity(): ProviderConnectivity {
  cache = { qloo: blank("qloo"), haiku: blank("haiku"), semantics: "provider_connectivity" };
  qlooProbe = undefined;
  haikuProbe = undefined;
  return cache;
}

export function setProviderProbes(probes: { qloo?: ProbeFn; haiku?: ProbeFn }): void {
  if (probes.qloo) qlooProbe = probes.qloo;
  if (probes.haiku) haikuProbe = probes.haiku;
}

export function providerConnectivity(now = Date.now()): ProviderConnectivity {
  return {
    semantics: "provider_connectivity",
    qloo: expire(cache.qloo, now),
    haiku: expire(cache.haiku, now),
  };
}

export function cachedProviderStatus(now = Date.now()): "not_probed" | "ok" | "failed" | "expired" | "mixed" {
  const current = providerConnectivity(now);
  const statuses = [current.qloo.status, current.haiku.status];
  if (statuses.every((status) => status === "ok")) return "ok";
  if (statuses.every((status) => status === "not_probed")) return "not_probed";
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "expired")) return "expired";
  if (statuses.some((status) => status === "ok")) return "mixed";
  return "not_probed";
}

async function runOne(provider: ProviderName, probe: ProbeFn | undefined, now: number): Promise<ProbeRecord> {
  if (!probe) {
    return {
      provider,
      status: "failed",
      at: new Date(now).toISOString(),
      expiresAt: new Date(now + PROVIDER_PROBE_TTL_MS).toISOString(),
      detail: "No live probe is registered for this process. Admission readiness does not verify providers.",
      liveCall: false,
    };
  }
  try {
    const result = await probe();
    return {
      provider,
      status: result.ok ? "ok" : "failed",
      at: new Date(now).toISOString(),
      expiresAt: new Date(now + PROVIDER_PROBE_TTL_MS).toISOString(),
      detail: result.detail.slice(0, 240),
      liveCall: true,
    };
  } catch (error) {
    return {
      provider,
      status: "failed",
      at: new Date(now).toISOString(),
      expiresAt: new Date(now + PROVIDER_PROBE_TTL_MS).toISOString(),
      detail: (error instanceof Error ? error.message : String(error)).slice(0, 240),
      liveCall: true,
    };
  }
}

export async function probeProviders(which: ProviderName[] = ["qloo", "haiku"], now = Date.now()): Promise<ProviderConnectivity> {
  const names = which.length > 0 ? which : (["qloo", "haiku"] as ProviderName[]);
  if (names.includes("qloo")) cache.qloo = await runOne("qloo", qlooProbe, now);
  if (names.includes("haiku")) cache.haiku = await runOne("haiku", haikuProbe, now);
  return providerConnectivity(now);
}
