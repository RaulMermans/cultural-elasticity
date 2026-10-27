import { readOperatorCredential } from "./operator";
import { visitorFromRequest } from "./visitor";

export function withVisitor(request: Request, response: Response): Response {
  const visitor = visitorFromRequest(request);
  if (!visitor.setCookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", visitor.setCookie);
  return new Response(response.body, { status: response.status, headers });
}

export function visitorIdOf(request: Request): string {
  return visitorFromRequest(request).id;
}

/** The paid-research operator credential from the HttpOnly cookie, or null. Forwarded only on paid starts. */
export function operatorOf(request: Request): string | null {
  return readOperatorCredential(request.headers.get("cookie"));
}
