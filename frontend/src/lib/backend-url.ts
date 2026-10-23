const DEFAULT_BACKEND_URL = "http://127.0.0.1:4000";

/** Server-side only. The browser never receives this value as public config. */
export function backendBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.BACKEND_URL?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") return null;
  return DEFAULT_BACKEND_URL;
}
