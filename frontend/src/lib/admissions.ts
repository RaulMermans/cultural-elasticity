export type AdmissionStatus = "unknown" | "accepting" | "paused" | "unavailable";

/** The configured per-network allowance of an open public evaluation (backend `/ready`). Config only, never usage. */
export type PublicAllowance = { endsAt: string; searches: number; scans: number; investigations: number };

export type AdmissionView = { status: Exclude<AdmissionStatus, "unknown">; allowance?: PublicAllowance };

export type AdmissionCopy = {
  status: AdmissionStatus;
  shortLabel: string;
  sentence: string;
  liveEnabled: boolean;
};

export function parseAdmission(value: unknown): AdmissionView {
  if (value && typeof value === "object" && "status" in value) {
    const status = (value as { status: unknown }).status;
    if (status === "accepting" || status === "paused" || status === "unavailable") {
      const allowance = status === "accepting" ? parseAllowance((value as { allowance?: unknown }).allowance) : null;
      return allowance ? { status, allowance } : { status };
    }
  }
  return { status: "unavailable" };
}

export function parseAllowance(value: unknown): PublicAllowance | null {
  if (!isRecord(value) || typeof value.endsAt !== "string" || !Number.isFinite(Date.parse(value.endsAt))) return null;
  const counts = [value.searches, value.scans, value.investigations];
  if (!counts.every((n) => Number.isInteger(n) && (n as number) >= 0)) return null;
  return { endsAt: value.endsAt, searches: value.searches as number, scans: value.scans as number, investigations: value.investigations as number };
}

/** One sentence naming the configured numbers, so a changed variable changes the copy. Fixed to UTC. */
export function allowanceCopy(allowance: PublicAllowance): string {
  const count = (n: number, one: string, many: string) => `${n === 0 ? "no" : n} ${n === 1 ? one : many}`;
  return `Public evaluation: each network can start ${count(allowance.scans, "brand research run", "brand research runs")} and ${count(allowance.investigations, "investigation", "investigations")} until ${formatUtc(allowance.endsAt)}. Opening saved research and the recorded examples doesn't count.`;
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function liveQuestionsEnabled(status: AdmissionStatus): boolean {
  return status === "accepting";
}

export function admissionCopy(status: AdmissionStatus): AdmissionCopy {
  switch (status) {
    case "accepting":
      return {
        status,
        shortLabel: "Live research available.",
        sentence: "Live investigations are being accepted.",
        liveEnabled: true,
      };
    case "paused":
      return {
        status,
        shortLabel: "Live research temporarily unavailable.",
        sentence: "The research service is connected, and new investigations are paused.",
        liveEnabled: false,
      };
    case "unavailable":
      return {
        status,
        shortLabel: "Service connection unavailable.",
        sentence: "The research service could not be reached. You can still explore the recorded example.",
        liveEnabled: false,
      };
    default:
      return {
        status: "unknown",
        shortLabel: "Checking the research service.",
        sentence: "Checking whether live research is available.",
        liveEnabled: false,
      };
  }
}

/** Pure mapping from /ready and /health probes. Never enables Ask unless /ready said accepting. */
export function interpretAdmissionProbe(input: {
  ready: { status: number; body: unknown } | null;
  health: { status: number; body: unknown } | null;
}): AdmissionView {
  const readyBody = isRecord(input.ready?.body) ? input.ready.body : null;
  const reasons = Array.isArray(readyBody?.reasons) ? readyBody.reasons : [];
  if (readyBody?.acceptingInvestigations === true) return { status: "accepting" };
  if (readyBody?.acceptingInvestigations === false) return { status: "paused" };
  if (reasons.includes("ADMISSIONS_PAUSED")) return { status: "paused" };
  if (input.ready && (input.ready.status === 503 || input.ready.status === 429)) return { status: "paused" };
  if (input.health && input.health.status >= 200 && input.health.status < 300) return { status: "paused" };
  return { status: "unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
