export type AdmissionStatus = "unknown" | "accepting" | "paused" | "unavailable";

export type AdmissionView = { status: Exclude<AdmissionStatus, "unknown"> };

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
