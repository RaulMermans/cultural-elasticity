const DEFAULT_BACKEND_URL = "http://127.0.0.1:4000";

/** Server-side only. The browser never receives this value as public config. */
export function backendBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.BACKEND_URL?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") return null;
  return DEFAULT_BACKEND_URL;
}

export type BackendConfigIssue = "BACKEND_URL_MISSING" | "BACKEND_URL_INVALID" | "INTERNAL_SECRET_MISSING";

/**
 * Sprint 9J: a production server with only one of the two settings looks connected (/ready needs no
 * internal auth) while every proxied action is refused. Report the half-configured state instead.
 */
export function backendConfigIssues(env: NodeJS.ProcessEnv = process.env): BackendConfigIssue[] {
  if (env.NODE_ENV !== "production") return [];
  const issues: BackendConfigIssue[] = [];
  const url = env.BACKEND_URL?.trim();
  if (!url) issues.push("BACKEND_URL_MISSING");
  else {
    try {
      if (new URL(url).protocol !== "https:") issues.push("BACKEND_URL_INVALID");
    } catch {
      issues.push("BACKEND_URL_INVALID");
    }
  }
  if (!env.CE_INTERNAL_API_SECRET?.trim()) issues.push("INTERNAL_SECRET_MISSING");
  return issues;
}
