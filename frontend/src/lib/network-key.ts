import { createHmac } from "node:crypto";

/**
 * Sprint 9M: a keyed hash of the client address, so clearing cookies does not reset a visitor's public research
 * allowance and Railway never sees the address itself. Vercel's edge sets `x-real-ip` and overwrites any value a
 * client sends; without a secret or an address there is no key, and Railway then refuses public paid starts.
 */
export function networkKeyOf(request: Request, secret = process.env.CE_INTERNAL_API_SECRET?.trim()): string | null {
  const address = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!secret || !address) return null;
  return createHmac("sha256", secret).update(`network:${address}`).digest("hex").slice(0, 32);
}
