import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { ParsedEntry, entriesToXml } from "./journal-tiers";
import { BatchSummary, formatSummariesForPrompt } from "./haiku-summarizer";

const MODEL = "claude-opus-4-5-20250101";
const MAX_OUTPUT_TOKENS = 16000;

// Load prompts at module level
let systemPrompt: string;
let reportPrompt: string;

function loadPrompts() {
  if (!systemPrompt || !reportPrompt) {
    const promptsDir = join(process.cwd(), "src", "prompts");
    systemPrompt = readFileSync(join(promptsDir, "role.txt"), "utf-8");
    reportPrompt = readFileSync(join(promptsDir, "create-report.txt"), "utf-8");
  }
}


/**
 * Build custom topics section if any topics are provided
 */
function buildCustomTopicsPrompt(topics: string[], customTopicsOnly: boolean): string {
  if (topics.length === 0) return "";

  const topicSections = topics
    .map(
      (topic, i) =>
        `<section heading="Custom Topic ${i + 1}: ${topic}">\nAddress this specific question or topic based on my journal entries. Provide thoughtful analysis and actionable advice.\n</section>`
    )
    .join("\n\n");

  if (customTopicsOnly) {
    return `\n\n<custom_topics_only>
IMPORTANT: The user has requested ONLY the following ${topics.length} custom topic(s). Do NOT include the standard report sections (Executive Summary, General Insights, etc.). ONLY address the custom topics below.

${topicSections}

Remember: ONLY output sections for the custom topics above. Do not include any standard report sections.
</custom_topics_only>`;
  }

  return `\n\n<custom_topics>
IMPORTANT: The user has requested ${topics.length} custom topic(s) below. You MUST address ALL of them - do not skip any.

Add these as separate sections BEFORE the "Context for JournaLens" section:

${topicSections}

Remember: Every custom topic above MUST have its own dedicated section in your response. These are specifically requested by the user and are a priority.
</custom_topics>`;
}

/**
 * Generate a report from journal entries using Claude (legacy, without tiers)
 * @deprecated Use getReportWithTiers for better handling of large journals
 */
export async function getReport(
  journalXml: string,
  apiKey: string,
  formattedDate: string,
  customTopics: string[] = [],
  customTopicsOnly: boolean = false
): Promise<string> {
  loadPrompts();

  const client = new Anthropic({ apiKey });

  const assistantPrefill = `# JournaLens Advice for ${formattedDate}`;
  const customTopicsPrompt = buildCustomTopicsPrompt(customTopics, customTopicsOnly);
  const basePrompt = customTopicsOnly && customTopics.length > 0 ? "" : reportPrompt;
  const fullPrompt = basePrompt + customTopicsPrompt;

  const response = await client.messages.create({
    model: MODEL,
    system: systemPrompt,
    messages: [
      { role: "user", content: `<journal>\n${journalXml}\n</journal>` },
      { role: "user", content: fullPrompt },
      { role: "assistant", content: assistantPrefill },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
  });

  // Extract text content from response
  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in response");
  }

  return assistantPrefill + textContent.text;
}

export interface TieredReportInput {
  recentEntries: ParsedEntry[]; // Tier 1: full text (0-14 days)
  weeklySummaries: BatchSummary[]; // Tier 2: summaries (15-90 days)
  monthlySummaries: BatchSummary[]; // Tier 3: summaries (90+ days)
}

export interface TieredReportResult {
  report: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Generate a report using tiered journal content
 *
 * This function accepts:
 * - Full text of recent entries (tier 1)
 * - Pre-generated weekly summaries (tier 2)
 * - Pre-generated monthly summaries (tier 3)
 *
 * The content is assembled with markers indicating what's summarized vs full.
 */
export async function getReportWithTiers(
  input: TieredReportInput,
  apiKey: string,
  formattedDate: string,
  customTopics: string[] = [],
  customTopicsOnly: boolean = false
): Promise<TieredReportResult> {
  loadPrompts();

  const client = new Anthropic({ apiKey });

  // Build the journal content with tiered sections
  let journalContent = "";

  // Add monthly summaries (oldest content)
  if (input.monthlySummaries.length > 0) {
    journalContent += formatSummariesForPrompt(input.monthlySummaries);
  }

  // Add weekly summaries
  if (input.weeklySummaries.length > 0) {
    journalContent += formatSummariesForPrompt(input.weeklySummaries);
  }

  // Add recent entries (full text)
  if (input.recentEntries.length > 0) {
    journalContent += "<recent_entries>\n";
    journalContent +=
      "The following are complete journal entries from the past 14 days.\n\n";
    journalContent += entriesToXml(input.recentEntries);
    journalContent += "\n</recent_entries>";
  }

  const assistantPrefill = `# JournaLens Advice for ${formattedDate}`;
  const customTopicsPrompt = buildCustomTopicsPrompt(customTopics, customTopicsOnly);
  const basePrompt = customTopicsOnly && customTopics.length > 0 ? "" : reportPrompt;
  const fullPrompt = basePrompt + customTopicsPrompt;

  // Add context about the tiered structure to the system prompt
  const tieredSystemPrompt =
    systemPrompt +
    `

Note: The journal content you receive is structured in tiers:
1. Monthly summaries (90+ days old) - AI-generated summaries of older entries
2. Weekly summaries (15-90 days old) - AI-generated summaries of recent entries
3. Recent entries (0-14 days old) - Complete, unmodified journal text

Give appropriate weight to each tier: recent entries are most detailed and relevant for immediate advice, while summaries provide important historical context for patterns and long-term trends.`;

  const response = await client.messages.create({
    model: MODEL,
    system: tieredSystemPrompt,
    messages: [
      { role: "user", content: `<journal>\n${journalContent}\n</journal>` },
      { role: "user", content: fullPrompt },
      { role: "assistant", content: assistantPrefill },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
  });

  // Extract text content from response
  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in response");
  }

  return {
    report: assistantPrefill + textContent.text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
