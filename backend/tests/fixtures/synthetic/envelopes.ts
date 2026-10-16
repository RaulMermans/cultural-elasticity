/**
 * SYNTHETIC fixtures. Hand-written to the envelope shape verified from the harness contract and
 * source (backend/src/qloo/types.ts). These are NOT Qloo data: IDs are placeholders and names are
 * deliberately fictional. Never cite them as evidence.
 */
import type { QlooTransport, TransportResult } from "../../../src/qloo/transport.js";
import type { QlooOperation, QlooStatus } from "../../../src/qloo/types.js";

let sequence = 0;

export const syntheticId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function envelope(operation: QlooOperation, status: QlooStatus, extra: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    schema_version: "1.0-preview.1",
    operation,
    status,
    execution: {
      transport: "direct",
      transport_name: "SYNTHETIC fixture",
      correlation_id: `synthetic-${operation}-${sequence}`,
      duration_ms: 1,
    },
    provenance: {
      source: "SYNTHETIC",
      endpoint: "/v2/insights",
      documentation: "https://docs.qloo.com/reference/insights-api-deep-dive",
      requests: [{ method: "GET", path: "/v2/insights", query: { "filter.type": "urn:entity:brand" } }],
    },
    ...extra,
  };
}

export function compactEntity(id: string, name: string, type = "urn:entity:brand", affinity?: number, popularity?: number) {
  return {
    entity_id: id,
    name,
    type,
    ...(affinity !== undefined ? { affinity } : {}),
    ...(popularity !== undefined ? { popularity } : {}),
  };
}

export function compactTag(id: string, name: string, affinity?: number) {
  return { id, name, type: "urn:tag:keyword:qloo", ...(affinity !== undefined ? { affinity } : {}), popularity: 0.5 };
}

export function interpreted(input: string, id: string, name: string, type = "urn:entity:brand", match = "exact") {
  return { input, entityId: id, name, type, match };
}

export function failure(code: string, retryable: boolean): TransportResult {
  return { kind: "failure", exitCode: 1, failure: { code, layer: "qloo", retryable, recovery: "synthetic recovery", correlationId: "synthetic" } };
}

type Responder = (operation: QlooOperation, input: Record<string, unknown>) => TransportResult | Record<string, unknown>;

/** Test double for QlooTransport. Records calls; returns whatever the responder builds. */
export class FixtureTransport implements QlooTransport {
  readonly name = "synthetic-fixture";
  readonly calls: { operation: QlooOperation; input: Record<string, unknown> }[] = [];

  constructor(private readonly responder: Responder) {}

  async execute(operation: QlooOperation, input: unknown): Promise<TransportResult> {
    const record = input as Record<string, unknown>;
    this.calls.push({ operation, input: record });
    const response = this.responder(operation, record);
    return "kind" in response && (response.kind === "result" || response.kind === "failure")
      ? (response as TransportResult)
      : { kind: "result", raw: response };
  }
}
