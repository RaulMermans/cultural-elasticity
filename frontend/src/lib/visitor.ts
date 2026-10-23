import { randomBytes } from "node:crypto";

export const VISITOR_COOKIE = "ce_visitor";
const VISITOR_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function readVisitorId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VISITOR_COOKIE) {
      const value = rest.join("=");
      return VISITOR_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

export function newVisitorId(): string {
  return randomBytes(24).toString("base64url");
}

export function visitorCookie(id: string, secure: boolean): string {
  const parts = [`${VISITOR_COOKIE}=${id}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_SECONDS}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

const identities = new WeakMap<Request, { id: string; setCookie: string | null }>();

/**
 * One request uses one visitor identity. Admission and Set-Cookie must share it.
 * A WeakMap keeps that identity stable even if the proxy reads it more than once.
 */
export function visitorFromRequest(request: Request): { id: string; setCookie: string | null } {
  const cached = identities.get(request);
  if (cached) return cached;
  const existing = readVisitorId(request.headers.get("cookie"));
  const identity = existing
    ? { id: existing, setCookie: null }
    : (() => {
        const id = newVisitorId();
        const secure = process.env.NODE_ENV === "production";
        return { id, setCookie: visitorCookie(id, secure) };
      })();
  identities.set(request, identity);
  return identity;
}
