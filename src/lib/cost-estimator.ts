/**
 * Cost estimation for hierarchical journal summarization
 *
 * Pricing (as of 2024):
 * - Haiku 4.5: $1.00/1M input, $5.00/1M output
 * - Opus 4.5: $15/1M input, $75/1M output
 */

export interface CostEstimate {
  tier1Tokens: number;
  tier2InputTokens: number;
  tier2OutputTokens: number;
  tier3InputTokens: number;
  tier3OutputTokens: number;
  opusInputTokens: number;
  opusOutputTokens: number;
  haikuCost: number;
  opusCost: number;
  totalCost: number;
  cachedBatches: number;
  totalBatches: number;
}

// Pricing per million tokens
const HAIKU_INPUT_PRICE = 1.0; // $1.00 per 1M input tokens
const HAIKU_OUTPUT_PRICE = 5.0; // $5.00 per 1M output tokens
const OPUS_INPUT_PRICE = 15.0; // $15 per 1M input tokens
const OPUS_OUTPUT_PRICE = 75.0; // $75 per 1M output tokens

// Estimated output sizes
const WEEKLY_SUMMARY_OUTPUT_TOKENS = 500;
const MONTHLY_SUMMARY_OUTPUT_TOKENS = 800;
const OPUS_REPORT_OUTPUT_TOKENS = 4000;

// Summarization overhead (prompt + formatting)
const SUMMARIZATION_OVERHEAD_TOKENS = 500;

/**
 * Estimate tokens from character count (approximately 4 chars per token)
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Estimate tokens for a batch of journal entries
 */
export function estimateBatchTokens(entries: { text: string }[]): number {
  const totalChars = entries.reduce((sum, entry) => sum + entry.text.length, 0);
  return estimateTokensFromChars(totalChars);
}

/**
 * Calculate cost for token usage
 */
function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPrice: number,
  outputPrice: number
): number {
  return (
    (inputTokens / 1_000_000) * inputPrice +
    (outputTokens / 1_000_000) * outputPrice
  );
}

/**
 * Estimate the cost of processing a journal with tiered summarization
 */
export function estimateCost(params: {
  tier1Entries: { text: string }[];
  tier2Batches: { text: string }[][];
  tier3Batches: { text: string }[][];
  cachedWeeklyBatches?: number;
  cachedMonthlyBatches?: number;
}): CostEstimate {
  const {
    tier1Entries,
    tier2Batches,
    tier3Batches,
    cachedWeeklyBatches = 0,
    cachedMonthlyBatches = 0,
  } = params;

  // Tier 1: Full text goes to Opus
  const tier1Tokens = estimateBatchTokens(tier1Entries);

  // Tier 2: Weekly summaries via Haiku (only uncached batches)
  const uncachedTier2 = tier2Batches.length - cachedWeeklyBatches;
  const tier2InputTokens =
    uncachedTier2 > 0
      ? tier2Batches.slice(0, uncachedTier2).reduce(
          (sum, batch) => sum + estimateBatchTokens(batch) + SUMMARIZATION_OVERHEAD_TOKENS,
          0
        )
      : 0;
  const tier2OutputTokens = uncachedTier2 * WEEKLY_SUMMARY_OUTPUT_TOKENS;

  // Tier 3: Monthly summaries via Haiku (only uncached batches)
  const uncachedTier3 = tier3Batches.length - cachedMonthlyBatches;
  const tier3InputTokens =
    uncachedTier3 > 0
      ? tier3Batches.slice(0, uncachedTier3).reduce(
          (sum, batch) => sum + estimateBatchTokens(batch) + SUMMARIZATION_OVERHEAD_TOKENS,
          0
        )
      : 0;
  const tier3OutputTokens = uncachedTier3 * MONTHLY_SUMMARY_OUTPUT_TOKENS;

  // Haiku cost for all summaries
  const haikuCost = calculateCost(
    tier2InputTokens + tier3InputTokens,
    tier2OutputTokens + tier3OutputTokens,
    HAIKU_INPUT_PRICE,
    HAIKU_OUTPUT_PRICE
  );

  // Opus input: tier 1 full text + all summaries (cached and new)
  const summaryTokens =
    tier2Batches.length * WEEKLY_SUMMARY_OUTPUT_TOKENS +
    tier3Batches.length * MONTHLY_SUMMARY_OUTPUT_TOKENS;
  const opusInputTokens = tier1Tokens + summaryTokens + SUMMARIZATION_OVERHEAD_TOKENS;
  const opusOutputTokens = OPUS_REPORT_OUTPUT_TOKENS;

  // Opus cost
  const opusCost = calculateCost(
    opusInputTokens,
    opusOutputTokens,
    OPUS_INPUT_PRICE,
    OPUS_OUTPUT_PRICE
  );

  const totalBatches = tier2Batches.length + tier3Batches.length;
  const cachedBatches = cachedWeeklyBatches + cachedMonthlyBatches;

  return {
    tier1Tokens,
    tier2InputTokens,
    tier2OutputTokens,
    tier3InputTokens,
    tier3OutputTokens,
    opusInputTokens,
    opusOutputTokens,
    haikuCost,
    opusCost,
    totalCost: haikuCost + opusCost,
    cachedBatches,
    totalBatches,
  };
}

/**
 * Format cost as a dollar string
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return "<$0.01";
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Get a human-readable cost breakdown
 */
export function getCostBreakdown(estimate: CostEstimate): string {
  const lines: string[] = [];

  if (estimate.tier1Tokens > 0) {
    lines.push(`Recent entries (${estimate.tier1Tokens.toLocaleString()} tokens): sent to Opus`);
  }

  if (estimate.totalBatches > 0) {
    const uncached = estimate.totalBatches - estimate.cachedBatches;
    if (uncached > 0) {
      lines.push(
        `Summarization: ${uncached} batches via Haiku (${formatCost(estimate.haikuCost)})`
      );
    }
    if (estimate.cachedBatches > 0) {
      lines.push(`Cached summaries: ${estimate.cachedBatches} batches`);
    }
  }

  lines.push(`Report generation via Opus: ${formatCost(estimate.opusCost)}`);
  lines.push(`Total: ${formatCost(estimate.totalCost)}`);

  return lines.join("\n");
}
