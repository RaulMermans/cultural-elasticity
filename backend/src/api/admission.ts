/** Process-wide request admission for expensive investigation routes. In memory, like the job manager. */
const buckets = new Map<string, number[]>();

export function admit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

export function resetAdmission(): void {
  buckets.clear();
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function jobCreateLimit(): number {
  if (process.env.CE_JOB_CREATE_LIMIT) return positive(process.env.CE_JOB_CREATE_LIMIT, 24);
  return process.env.NODE_ENV === "production" || process.env.CE_PUBLIC_DEPLOYMENT === "1" ? 24 : 500;
}

export function globalJobLimit(): number {
  if (process.env.CE_GLOBAL_JOB_LIMIT) return positive(process.env.CE_GLOBAL_JOB_LIMIT, 48);
  return jobCreateLimit() * 4;
}
