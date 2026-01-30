/**
 * Batch summarization using Claude Haiku 4.5
 *
 * Processes journal entry batches in parallel with concurrency limit.
 * Includes graceful fallback on failure (uses truncated original).
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ParsedEntry,
  entriesToXml,
  formatBatchPeriod,
  getBatchPeriodKey,
} from "./journal-tiers";

const HAIKU_MODEL = "claude-haiku-4-5-20250301";
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

export interface BatchSummary {
  periodKey: string;
  periodLabel: string;
  type: "weekly" | "monthly";
  summary: string;
  entryCount: number;
  inputTokens: number;
  outputTokens: number;
  fromCache: boolean;
  fallback: boolean;
}

// Load summarization prompt at module level
let summarizePrompt: string | null = null;

function loadSummarizePrompt(): string {
  if (!summarizePrompt) {
    const promptPath = join(
      process.cwd(),
      "src",
      "prompts",
      "summarize-batch.txt"
    );
    summarizePrompt = readFileSync(promptPath, "utf-8");
  }
  return summarizePrompt;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Summarize a single batch of entries with retries
 */
async function summarizeBatch(
  client: Anthropic,
  entries: ParsedEntry[],
  type: "weekly" | "monthly"
): Promise<{
  summary: string;
  inputTokens: number;
  outputTokens: number;
  fallback: boolean;
}> {
  const prompt = loadSummarizePrompt();
  const periodLabel = formatBatchPeriod(entries, type);
  const entriesXml = entriesToXml(entries);

  const userMessage = `<period>${periodLabel}</period>
<type>${type === "weekly" ? "weekly summary" : "monthly summary"}</type>
<entries>
${entriesXml}
</entries>`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: HAIKU_MODEL,
        system: prompt,
        messages: [{ role: "user", content: userMessage }],
        max_tokens: type === "weekly" ? 600 : 1000,
      });

      const textContent = response.content.find(
        (block) => block.type === "text"
      );
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text content in response");
      }

      return {
        summary: textContent.text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        fallback: false,
      };
    } catch (error) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("rate") ||
          error.message.includes("429") ||
          error.message.includes("overloaded"));

      if (attempt < MAX_RETRIES && isRateLimit) {
        console.warn(
          `Rate limited on ${periodLabel}, retrying in ${RETRY_DELAYS[attempt]}ms...`
        );
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }

      // Final attempt failed - use fallback
      console.error(`Failed to summarize ${periodLabel}:`, error);
      break;
    }
  }

  // Fallback: return truncated original entries
  const truncatedEntries = entries
    .slice(-3) // Keep only the last 3 entries
    .map(
      (e) =>
        `[${e.date.toISOString().split("T")[0]}] ${e.text.slice(0, 200)}${e.text.length > 200 ? "..." : ""}`
    )
    .join("\n\n");

  return {
    summary: `[Summary unavailable - showing recent entries from this period]\n\n${truncatedEntries}`,
    inputTokens: 0,
    outputTokens: 0,
    fallback: true,
  };
}

/**
 * Process batches with concurrency limit
 */
async function processBatchesWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await processor(items[index], index);
    }
  }

  // Start workers up to concurrency limit
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Summarize multiple batches of entries
 */
export async function summarizeBatches(
  apiKey: string,
  batches: ParsedEntry[][],
  type: "weekly" | "monthly",
  onProgress?: (completed: number, total: number) => void
): Promise<BatchSummary[]> {
  if (batches.length === 0) {
    return [];
  }

  const client = new Anthropic({ apiKey });
  let completed = 0;

  const results = await processBatchesWithConcurrency(
    batches,
    async (batch, _index) => {
      const periodKey = getBatchPeriodKey(batch, type);
      const periodLabel = formatBatchPeriod(batch, type);

      const result = await summarizeBatch(client, batch, type);

      completed++;
      onProgress?.(completed, batches.length);

      return {
        periodKey,
        periodLabel,
        type,
        summary: result.summary,
        entryCount: batch.length,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        fromCache: false,
        fallback: result.fallback,
      } as BatchSummary;
    },
    MAX_CONCURRENCY
  );

  return results;
}

/**
 * Create a summary result from cached data
 */
export function createCachedSummary(
  cached: {
    periodKey: string;
    periodLabel: string;
    type: "weekly" | "monthly";
    summary: string;
    entryCount: number;
  }
): BatchSummary {
  return {
    ...cached,
    inputTokens: 0,
    outputTokens: 0,
    fromCache: true,
    fallback: false,
  };
}

/**
 * Format summaries for inclusion in the Opus prompt
 */
export function formatSummariesForPrompt(summaries: BatchSummary[]): string {
  if (summaries.length === 0) {
    return "";
  }

  // Group by type
  const monthly = summaries.filter((s) => s.type === "monthly");
  const weekly = summaries.filter((s) => s.type === "weekly");

  let output = "";

  if (monthly.length > 0) {
    output += "<monthly_summaries>\n";
    output += "The following are AI-generated summaries of older journal entries (90+ days old), organized by month.\n\n";
    for (const s of monthly) {
      output += `<summary period="${s.periodLabel}" entries="${s.entryCount}">\n`;
      output += s.summary;
      output += "\n</summary>\n\n";
    }
    output += "</monthly_summaries>\n\n";
  }

  if (weekly.length > 0) {
    output += "<weekly_summaries>\n";
    output += "The following are AI-generated summaries of recent journal entries (15-90 days old), organized by week.\n\n";
    for (const s of weekly) {
      output += `<summary period="${s.periodLabel}" entries="${s.entryCount}">\n`;
      output += s.summary;
      output += "\n</summary>\n\n";
    }
    output += "</weekly_summaries>\n\n";
  }

  return output;
}
