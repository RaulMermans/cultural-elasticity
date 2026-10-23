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

export function conservativeReserveUsd(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CE_INVESTIGATION_RESERVE_USD);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return tokensToUsd(HAIKU_CONSERVATIVE, {
    uncachedInputTokens: DEFAULT_RESERVE_INPUT_TOKENS,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: DEFAULT_RESERVE_OUTPUT_TOKENS,
  });
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
