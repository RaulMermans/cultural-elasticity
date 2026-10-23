/**
 * Central provider price assumptions. These are not invoices.
 *
 * Source: Anthropic list prices effective 2026-10-07
 * (https://platform.claude.com/docs/en/about-claude/pricing).
 * Haiku 5.5 uses the ≤100K prompt tier for every production turn.
 * Qloo hackathon calls have no published USD rate; they are unit-capped, not dollar-capped.
 */
export const PRICING_AS_OF = "2026-10-07";
export const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** USD per million tokens. Conservative reservation uses the >100K Haiku tier. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export const HAIKU_CONSERVATIVE: ModelPrice = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 };

export const DEFAULT_RESERVE_INPUT_TOKENS = 400_000;
export const DEFAULT_RESERVE_OUTPUT_TOKENS = 80_000;
export const DEFAULT_INVESTIGATION_RESERVE_USD = 0.5;

export type TokenUsage = {
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
};

export function priceUsd(modelId: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES[modelId];
  if (!price) return null;
  return tokensToUsd(price, usage);
}

/** Decision, synthesis and interpretation ceilings used for pre-call spend checks. */
export const DECISION_MAX_OUTPUT_TOKENS = 16_000;
export const SYNTHESIS_MAX_OUTPUT_TOKENS = 16_000;
export const INTERPRET_MAX_OUTPUT_TOKENS = 4_000;
export const DEFAULT_DECISION_INPUT_TOKENS = 24_000;
export const DEFAULT_SYNTHESIS_INPUT_TOKENS = 12_000;
export const DEFAULT_INTERPRET_INPUT_TOKENS = 8_000;

/** Token-priced conservative envelope (Haiku >100K tier). */
export function computedConservativeReserveUsd(): number {
  return roundUsd(
    tokensToUsd(HAIKU_CONSERVATIVE, {
      uncachedInputTokens: DEFAULT_RESERVE_INPUT_TOKENS,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: DEFAULT_RESERVE_OUTPUT_TOKENS,
    }),
  );
}

/**
 * Lowest reserve a public process may use. A tiny configured reserve would admit jobs that can still
 * spend a full Haiku investigation; public mode therefore refuses or floors below this value.
 */
export function floorReserveUsd(): number {
  return Math.max(DEFAULT_INVESTIGATION_RESERVE_USD, computedConservativeReserveUsd());
}

export function configuredReserveUsd(env: NodeJS.ProcessEnv = process.env): number | null {
  if (env.CE_INVESTIGATION_RESERVE_USD === undefined || env.CE_INVESTIGATION_RESERVE_USD === "") return null;
  const configured = Number(env.CE_INVESTIGATION_RESERVE_USD);
  return Number.isFinite(configured) ? configured : null;
}

export function conservativeReserveUsd(env: NodeJS.ProcessEnv = process.env): number {
  const configured = configuredReserveUsd(env);
  if (configured !== null && configured > 0) {
    const publicMode = env.NODE_ENV === "production" || env.CE_PUBLIC_DEPLOYMENT === "1";
    return publicMode ? Math.max(configured, floorReserveUsd()) : configured;
  }
  const publicMode = env.NODE_ENV === "production" || env.CE_PUBLIC_DEPLOYMENT === "1";
  return publicMode ? floorReserveUsd() : computedConservativeReserveUsd();
}

/** Worst-case USD for one model call. Uses the conservative Haiku tier so a cheap list price cannot under-protect. */
export function estimateCallCeilingUsd(estimatedInputTokens: number, maxOutputTokens: number): number {
  const input = Number.isFinite(estimatedInputTokens) && estimatedInputTokens > 0 ? estimatedInputTokens : DEFAULT_DECISION_INPUT_TOKENS;
  const output = Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : DECISION_MAX_OUTPUT_TOKENS;
  return roundUsd(
    tokensToUsd(HAIKU_CONSERVATIVE, {
      uncachedInputTokens: input,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: output,
    }),
  );
}

export function interpretCeilingUsd(): number {
  return estimateCallCeilingUsd(DEFAULT_INTERPRET_INPUT_TOKENS, INTERPRET_MAX_OUTPUT_TOKENS);
}

export function decisionCeilingUsd(estimatedInputTokens = DEFAULT_DECISION_INPUT_TOKENS): number {
  return estimateCallCeilingUsd(estimatedInputTokens, DECISION_MAX_OUTPUT_TOKENS);
}

export function synthesisCeilingUsd(estimatedInputTokens = DEFAULT_SYNTHESIS_INPUT_TOKENS): number {
  return estimateCallCeilingUsd(estimatedInputTokens, SYNTHESIS_MAX_OUTPUT_TOKENS);
}

export function tokensToUsd(price: ModelPrice, usage: TokenUsage): number {
  return (
    (usage.uncachedInputTokens * price.input +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheCreationTokens * price.cacheWrite +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
