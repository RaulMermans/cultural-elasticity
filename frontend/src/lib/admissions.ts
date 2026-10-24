export type AdmissionStatus = "unknown" | "accepting" | "paused" | "unavailable";

export type AdmissionView = { status: Exclude<AdmissionStatus, "unknown"> };

export type AdmissionCopy = {
  status: AdmissionStatus;
  shortLabel: string;
  sentence: string;
  liveEnabled: boolean;
};

export function parseAdmission(value: unknown): AdmissionView {
  if (value && typeof value === "object" && "status" in value) {
    const status = (value as { status: unknown }).status;
    if (status === "accepting" || status === "paused" || status === "unavailable") return { status };
  }
  return { status: "unavailable" };
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
        sentence: "The research service could not be reached.",
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
