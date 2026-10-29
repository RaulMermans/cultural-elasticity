import { readOperatorCredential } from "./operator";
import { networkKeyOf } from "./network-key";
import { visitorFromRequest } from "./visitor";

/** Who is asking: the visitor cookie, plus the network key Railway uses for public-evaluation quotas. */
export type Caller = { id: string; network: string | null };

export function withVisitor(request: Request, response: Response): Response {
  const visitor = visitorFromRequest(request);
  if (!visitor.setCookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", visitor.setCookie);
  return new Response(response.body, { status: response.status, headers });
}

export function callerOf(request: Request): Caller {
  return { id: visitorFromRequest(request).id, network: networkKeyOf(request) };
}

/** The paid-research operator credential from the HttpOnly cookie, or null. Forwarded only on paid starts. */
export function operatorOf(request: Request): string | null {
  return readOperatorCredential(request.headers.get("cookie"));
}
