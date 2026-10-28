import type { AdmissionView } from "./admissions";

/**
 * Sprint 9J operator authorization for paid research. The browser holds the credential only in an
 * HttpOnly cookie scoped to /api; the Next.js server forwards it on paid routes and Railway verifies it.
 * The Next.js server never decides whether it is valid.
 */
export const OPERATOR_COOKIE = "ce_paid_operator";
export const PAID_OPERATOR_HEADER = "x-ce-paid-operator";
const OPERATOR_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const MAX_AGE_SECONDS = 4 * 60 * 60;

export function operatorCredentialLooksValid(value: string): boolean {
  return OPERATOR_PATTERN.test(value);
}

export function readOperatorCredential(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === OPERATOR_COOKIE) {
      const value = rest.join("=");
      return operatorCredentialLooksValid(value) ? value : null;
    }
  }
  return null;
}

export function operatorCookie(value: string, secure: boolean): string {
  const parts = [`${OPERATOR_COOKIE}=${value}`, "Path=/api", "HttpOnly", "SameSite=Strict", `Max-Age=${MAX_AGE_SECONDS}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedOperatorCookie(secure: boolean): string {
  const parts = [`${OPERATOR_COOKIE}=`, "Path=/api", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * A visitor without the operator credential cannot start paid work on a backend that requires it, so
 * they see the service as paused rather than an enabled button that is then refused.
 */
export function admissionForVisitor(view: AdmissionView, options: { operatorRequired: boolean; operatorPresent: boolean }): AdmissionView {
  if (view.status === "accepting" && options.operatorRequired && !options.operatorPresent) return { status: "paused" };
  return view;
}

/**
 * Railway's verdict on the presented credential (`/api/brands/status` `operator`). Only "authorized" keeps an
 * accepting view; an expired or rejected credential reads as paused. An older backend without the field (or an
 * unreachable one) leaves the presence-based view unchanged, since Railway still refuses every unauthorized start.
 */
export function admissionForOperatorCheck(view: AdmissionView, operator: unknown): AdmissionView {
  if (view.status !== "accepting" || operator === undefined) return view;
  return operator === "authorized" ? view : { status: "paused" };
}
