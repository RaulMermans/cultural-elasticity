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
