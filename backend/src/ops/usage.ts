import type { QueryResponse } from "@cultural-elasticity/shared";

export type ObservedUsage = {
  observedUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  qlooCalls: number;
  interpretationLatencyMs: number | null;
};

export function observedUsage(response: QueryResponse | null): ObservedUsage {
  const telemetry = response?.telemetry;
  const result = response?.investigation?.result;
  const metrics = result && result.status !== "NEEDS_INPUT" ? result.metrics : null;
  const interpretationUsd = typeof telemetry?.interpretationCostUsd === "number" ? telemetry.interpretationCostUsd : null;
  const modelUsd = typeof metrics?.model_cost_usd === "number" ? metrics.model_cost_usd : null;
  const observedUsd =
    interpretationUsd === null && modelUsd === null ? null : Math.round(((interpretationUsd ?? 0) + (modelUsd ?? 0)) * 1_000_000) / 1_000_000;
  return {
    observedUsd,
    inputTokens: (telemetry?.interpretationTokens.input ?? 0) + (metrics?.model_input_tokens ?? 0),
    outputTokens: (telemetry?.interpretationTokens.output ?? 0) + (metrics?.model_output_tokens ?? 0),
    qlooCalls: metrics?.qloo_calls ?? 0,
    interpretationLatencyMs: telemetry?.interpretationLatencyMs ?? null,
  };
}
