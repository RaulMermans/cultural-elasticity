import { parseQueryResponse } from "@cultural-elasticity/shared";
import artifact from "@/demo/recorded-example.json";

export const dynamic = "force-static";

/** Serves the recorded example. The module is a built artifact. It does not call Qloo. */
export function GET(): Response {
  const responses = artifact.responses;
  if (!Array.isArray(responses) || responses.length === 0 || responses.some((item) => !parseQueryResponse(item).ok)) {
    return Response.json({ error: "invalid_demo", message: "The recorded example could not be shown." }, { status: 500 });
  }
  return Response.json({
    kind: "RECORDED_EXAMPLE",
    recordedAt: artifact.recordedAt,
    note: artifact.note,
    responses,
  });
}
