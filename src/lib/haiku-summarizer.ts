/**
 * Haiku 4.5 summarization service for tier summaries
 *
 * Uses Claude Haiku for fast, cost-effective summarization of
 * older journal entries into weekly and monthly digests.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  JournalEntry,
  entriesToXml,
  formatPeriodKey,
} from "./journal-tiers";

const HAIKU_MODEL = "claude-haiku-4-5-20250129";

export interface TierSummary {
  periodKey: string; // e.g., "2025-W03" or "2025-01"
  periodType: "weekly" | "monthly";
  summary: string;
  entryCount: number;
  characterCount: number;
}

const WEEKLY_SUMMARY_PROMPT = `Summarize these journal entries from a single week. Focus on:
- Key events and activities
- Emotional state and mood patterns
- Goals or intentions mentioned
- Important people or relationships discussed
- Any decisions made or problems encountered

Keep the summary factual and concise (200-400 words). Preserve specific details that might be relevant for future reflection.
Do not add interpretation or advice - just summarize what was written.`;

const MONTHLY_SUMMARY_PROMPT = `Summarize these journal entries from a single month. Focus on:
- Major events and milestones
- Overall emotional themes and patterns
- Progress on goals or projects
- Key relationships and social dynamics
- Significant decisions or life changes
- Recurring topics or concerns

Keep the summary factual and comprehensive (400-600 words). Preserve specific details and dates where relevant.
Do not add interpretation or advice - just summarize what was written.`;

/**
 * Generate a summary for a single period using Haiku
 */
async function summarizePeriod(
  client: Anthropic,
  entries: JournalEntry[],
  periodKey: string,
  periodType: "weekly" | "monthly"
): Promise<TierSummary> {
  const entriesXml = entriesToXml(entries);
  const formattedPeriod = formatPeriodKey(periodKey);
  const prompt = periodType === "weekly" ? WEEKLY_SUMMARY_PROMPT : MONTHLY_SUMMARY_PROMPT;
  const maxTokens = periodType === "weekly" ? 600 : 900;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    system: `You are a journal summarizer. Summarize the provided journal entries concisely and accurately.`,
    messages: [
      {
        role: "user",
        content: `<period>${formattedPeriod}</period>\n\n<entries>\n${entriesXml}\n</entries>\n\n${prompt}`,
      },
    ],
    max_tokens: maxTokens,
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error(`Failed to generate summary for ${periodKey}`);
  }

  return {
    periodKey,
    periodType,
    summary: textContent.text,
    entryCount: entries.length,
    characterCount: entriesXml.length,
  };
}

/**
 * Generate summaries for multiple periods in parallel
 * Groups requests to avoid rate limiting
 */
export async function generateSummaries(
  apiKey: string,
  weeklyPeriods: Map<string, JournalEntry[]>,
  monthlyPeriods: Map<string, JournalEntry[]>,
  onProgress?: (completed: number, total: number) => void
): Promise<TierSummary[]> {
  const client = new Anthropic({ apiKey });
  const summaries: TierSummary[] = [];
  const total = weeklyPeriods.size + monthlyPeriods.size;
  let completed = 0;

  // Process weekly summaries (can run in parallel, but batch to avoid rate limits)
  const weeklyPromises: Promise<TierSummary>[] = [];
  for (const [periodKey, entries] of weeklyPeriods) {
    weeklyPromises.push(
      summarizePeriod(client, entries, periodKey, "weekly").then((summary) => {
        completed++;
        onProgress?.(completed, total);
        return summary;
      })
    );
  }

  // Process monthly summaries
  const monthlyPromises: Promise<TierSummary>[] = [];
  for (const [periodKey, entries] of monthlyPeriods) {
    monthlyPromises.push(
      summarizePeriod(client, entries, periodKey, "monthly").then((summary) => {
        completed++;
        onProgress?.(completed, total);
        return summary;
      })
    );
  }

  // Run all in parallel (Haiku has high rate limits)
  // For very large journals, consider batching with Promise.all chunks
  const allPromises = [...weeklyPromises, ...monthlyPromises];

  if (allPromises.length === 0) {
    return [];
  }

  // Process in batches of 10 to be safe with rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < allPromises.length; i += BATCH_SIZE) {
    const batch = allPromises.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch);
    summaries.push(...results);
  }

  return summaries;
}

/**
 * Estimate cost for generating summaries
 * Based on current Haiku 4.5 pricing: $1/MTok input, $5/MTok output
 */
export function estimateSummarizationCost(
  weeklyPeriods: Map<string, JournalEntry[]>,
  monthlyPeriods: Map<string, JournalEntry[]>
): { inputTokens: number; outputTokens: number; cost: number } {
  const CHARS_PER_TOKEN = 4;

  let inputChars = 0;
  let outputTokens = 0;

  // Weekly: ~150 chars system + entries + prompt (~300 chars)
  for (const entries of weeklyPeriods.values()) {
    const entryChars = entries.reduce((sum, e) => sum + e.content.length, 0);
    inputChars += 450 + entryChars;
    outputTokens += 500; // ~500 tokens output per weekly summary
  }

  // Monthly: ~150 chars system + entries + prompt (~400 chars)
  for (const entries of monthlyPeriods.values()) {
    const entryChars = entries.reduce((sum, e) => sum + e.content.length, 0);
    inputChars += 550 + entryChars;
    outputTokens += 800; // ~800 tokens output per monthly summary
  }

  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);

  // Haiku 4.5 pricing: $1/MTok input, $5/MTok output
  const cost = (inputTokens * 1 + outputTokens * 5) / 1_000_000;

  return { inputTokens, outputTokens, cost };
}

/**
 * Format summaries for inclusion in the main report prompt
 */
export function formatSummariesForPrompt(
  summaries: TierSummary[],
  type: "weekly" | "monthly"
): string {
  const filtered = summaries
    .filter((s) => s.periodType === type)
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey));

  if (filtered.length === 0) return "";

  const header = type === "weekly" ? "Weekly Digests" : "Monthly Digests";
  let xml = `<${type}_summaries title="${header}">\n`;

  for (const summary of filtered) {
    const formattedPeriod = formatPeriodKey(summary.periodKey);
    xml += `<summary period="${formattedPeriod}" entries="${summary.entryCount}">\n`;
    xml += summary.summary;
    xml += `\n</summary>\n`;
  }

  xml += `</${type}_summaries>`;
  return xml;
}
