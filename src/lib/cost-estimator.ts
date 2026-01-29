/**
 * Client-side cost estimation for journal reports
 *
 * Displays estimates in characters (not tokens) since users
 * understand character counts better.
 */

export interface CostEstimate {
  characterCount: number;
  formattedCount: string;
  estimatedCost: number;
  formattedCost: string;
  breakdown: string;
  hasCachedSummaries: boolean;
}

// Pricing constants (as of January 2026)
const HAIKU_INPUT_PER_MTOK = 1;
const HAIKU_OUTPUT_PER_MTOK = 5;
const OPUS_INPUT_PER_MTOK = 5;
const OPUS_OUTPUT_PER_MTOK = 25;

// Conversion
const CHARS_PER_TOKEN = 4;

// Tier boundaries in characters (approximate)
const TIER_1_CHAR_LIMIT = 200_000; // ~50k tokens (14 days of entries)
const TIER_2_CHAR_LIMIT = 600_000; // ~150k tokens (15-90 days)

/**
 * Format character count for display
 */
function formatCharacterCount(chars: number): string {
  if (chars >= 1_000_000) {
    return `${(chars / 1_000_000).toFixed(1)}M characters`;
  } else if (chars >= 1_000) {
    return `${(chars / 1_000).toFixed(0)}K characters`;
  }
  return `${chars} characters`;
}

/**
 * Estimate report generation cost based on journal size
 *
 * @param journalContent - The full journal XML content
 * @param isAuthenticated - Whether the user is signed in
 * @param cachedSummaryCount - Number of already-cached summaries (0 for new users)
 */
export function estimateCost(
  journalContent: string,
  isAuthenticated: boolean,
  cachedSummaryCount: number = 0
): CostEstimate {
  const characterCount = journalContent.length;
  const tokens = characterCount / CHARS_PER_TOKEN;

  // Estimate tier distribution
  const tier1Chars = Math.min(characterCount, TIER_1_CHAR_LIMIT);
  const tier2Chars = Math.min(
    Math.max(0, characterCount - TIER_1_CHAR_LIMIT),
    TIER_2_CHAR_LIMIT
  );
  const tier3Chars = Math.max(
    0,
    characterCount - TIER_1_CHAR_LIMIT - TIER_2_CHAR_LIMIT
  );

  const tier1Tokens = tier1Chars / CHARS_PER_TOKEN;
  const tier2Tokens = tier2Chars / CHARS_PER_TOKEN;
  const tier3Tokens = tier3Chars / CHARS_PER_TOKEN;

  // Estimate number of periods to summarize
  // Rough: 1 week ≈ 60k chars, 1 month ≈ 240k chars
  const estimatedWeeks = Math.ceil(tier2Chars / 60_000);
  const estimatedMonths = Math.ceil(tier3Chars / 240_000);
  const totalPeriods = estimatedWeeks + estimatedMonths;
  const periodsToGenerate = Math.max(0, totalPeriods - cachedSummaryCount);

  // Haiku costs (summarization)
  let haikuCost = 0;
  if (periodsToGenerate > 0 && totalPeriods > 0) {
    const haikuInputTokens =
      ((tier2Tokens + tier3Tokens) * periodsToGenerate) / totalPeriods;
    const haikuOutputTokens = periodsToGenerate * 600; // ~600 tokens per summary
    haikuCost =
      (haikuInputTokens * HAIKU_INPUT_PER_MTOK +
        haikuOutputTokens * HAIKU_OUTPUT_PER_MTOK) /
      1_000_000;
  }

  // Opus costs (report generation)
  // Base context (~70k tokens for summaries + prompts) + recent entries
  const opusInputTokens = 70_000 + tier1Tokens;
  const opusOutputTokens = 4_000;
  let opusCost =
    (opusInputTokens * OPUS_INPUT_PER_MTOK +
      opusOutputTokens * OPUS_OUTPUT_PER_MTOK) /
    1_000_000;

  // Add rolling summary update cost for authenticated users
  if (isAuthenticated) {
    // ~15k input + 1k output for rolling summary update
    opusCost +=
      (15_000 * OPUS_INPUT_PER_MTOK + 1_000 * OPUS_OUTPUT_PER_MTOK) / 1_000_000;
  }

  const totalCost = haikuCost + opusCost;

  // Determine breakdown message
  let breakdown: string;
  const hasCachedSummaries = cachedSummaryCount > 0;

  if (hasCachedSummaries) {
    breakdown = `Using ${cachedSummaryCount} cached ${cachedSummaryCount === 1 ? "summary" : "summaries"}`;
  } else if (isAuthenticated) {
    breakdown = "Summaries will be cached for future reports";
  } else {
    breakdown = "Sign in to cache summaries";
  }

  return {
    characterCount,
    formattedCount: formatCharacterCount(characterCount),
    estimatedCost: totalCost,
    formattedCost: `~$${totalCost.toFixed(2)}`,
    breakdown,
    hasCachedSummaries,
  };
}

/**
 * Check if journal is long enough to benefit from hierarchical summarization
 */
export function needsHierarchicalProcessing(characterCount: number): boolean {
  // If journal has content beyond Tier 1, it benefits from summarization
  return characterCount > TIER_1_CHAR_LIMIT;
}

/**
 * Get a description of what tiers will be used
 */
export function getTierDescription(characterCount: number): string {
  if (characterCount <= TIER_1_CHAR_LIMIT) {
    return "Full text analysis";
  }

  const parts: string[] = ["Recent entries (full text)"];

  if (characterCount > TIER_1_CHAR_LIMIT) {
    parts.push("Weekly summaries (15-90 days)");
  }

  if (characterCount > TIER_1_CHAR_LIMIT + TIER_2_CHAR_LIMIT) {
    parts.push("Monthly summaries (90+ days)");
  }

  return parts.join(" + ");
}
