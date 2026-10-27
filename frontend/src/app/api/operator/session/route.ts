import { clearedOperatorCookie, operatorCookie, operatorCredentialLooksValid } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * Sprint 9J: stores the operator's paid-research credential in an HttpOnly cookie. This route does not
 * check the credential (Railway does, on every paid start) and never echoes it back.
 */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  let token: unknown;
  try {
    token = ((await request.json()) as { token?: unknown }).token;
  } catch {
    return Response.json({ error: "invalid_operator_request" }, { status: 400 });
  }
  if (typeof token !== "string" || !operatorCredentialLooksValid(token)) return Response.json({ error: "invalid_operator_request" }, { status: 400 });
  const secure = process.env.NODE_ENV === "production";
  return new Response(null, { status: 204, headers: { "set-cookie": operatorCookie(token, secure), "cache-control": "no-store" } });
}

export async function DELETE(): Promise<Response> {
  const secure = process.env.NODE_ENV === "production";
  return new Response(null, { status: 204, headers: { "set-cookie": clearedOperatorCookie(secure), "cache-control": "no-store" } });
}
