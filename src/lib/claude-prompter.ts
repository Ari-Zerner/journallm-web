import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseEntriesFromXml,
  partitionEntries,
  entriesToXml,
  getMissingPeriods,
  getTierStats,
  TieredEntries,
} from "./journal-tiers";
import {
  generateSummaries,
  formatSummariesForPrompt,
  TierSummary,
} from "./haiku-summarizer";
import {
  loadTierSummaries,
  saveTierSummaries,
  loadRollingSummary,
  saveRollingSummary,
  formatRollingSummaryForPrompt,
  RollingSummary,
  StoredTierSummary,
} from "./google-drive-summaries";

const OPUS_MODEL = "claude-opus-4-5-20250514";
const MAX_CONTEXT_TOKENS = 200000;
const RESPONSE_BUFFER_TOKENS = 30000;
const MAX_JOURNAL_TOKENS = MAX_CONTEXT_TOKENS - RESPONSE_BUFFER_TOKENS;
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
 * Build custom topics prompt
 */
function buildCustomTopicsPrompt(
  topics: string[],
  includeStandardReport: boolean
): string {
  if (topics.length === 0) return "";

  const topicSections = topics
    .map(
      (topic, i) =>
        `<section heading="Custom Topic ${i + 1}: ${topic}">\nAddress this specific question or topic based on my journal entries. Provide thoughtful analysis and actionable advice.\n</section>`
    )
    .join("\n\n");

  const placement = includeStandardReport
    ? 'Add these as separate sections BEFORE the "Context for JournaLens" section.'
    : "These are the ONLY sections to include in the report (do not include the standard report sections).";

  return `\n\n<custom_topics>\nIMPORTANT: The user has requested ${topics.length} custom topic(s). You MUST address ALL of them - do not skip any.\n\n${placement}\n\n${topicSections}\n</custom_topics>`;
}

/**
 * Build the hierarchical journal context for the prompt
 */
function buildHierarchicalContext(
  tier1Xml: string,
  allSummaries: TierSummary[],
  rollingSummary: RollingSummary | null
): string {
  const parts: string[] = [];

  // Rolling summary (longitudinal context) - only for authenticated users
  const rollingSummaryXml = formatRollingSummaryForPrompt(rollingSummary);
  if (rollingSummaryXml) {
    parts.push(rollingSummaryXml);
  }

  // Monthly summaries (oldest context)
  const monthlySummariesXml = formatSummariesForPrompt(allSummaries, "monthly");
  if (monthlySummariesXml) {
    parts.push(monthlySummariesXml);
  }

  // Weekly summaries (medium-term context)
  const weeklySummariesXml = formatSummariesForPrompt(allSummaries, "weekly");
  if (weeklySummariesXml) {
    parts.push(weeklySummariesXml);
  }

  // Recent entries (full text)
  if (tier1Xml) {
    parts.push(`<recent_entries title="Recent Journal Entries (Full Text)">\n${tier1Xml}\n</recent_entries>`);
  }

  return parts.join("\n\n");
}

/**
 * Update rolling summary based on new report insights
 */
async function updateRollingSummaryWithOpus(
  client: Anthropic,
  previousSummary: RollingSummary | null,
  tier1Xml: string,
  reportContent: string
): Promise<RollingSummary> {
  const prompt = `Based on the recent journal entries and the report generated from them, update the rolling summary that tracks longitudinal patterns.

${previousSummary ? `<previous_summary>
Themes: ${previousSummary.themes.join(", ")}
Active Goals: ${previousSummary.activeGoals.join(", ")}
Key Relationships: ${previousSummary.relationships.join(", ")}
Open Threads: ${previousSummary.openThreads.join(", ")}
Historical Context: ${previousSummary.historicalHighlights}
</previous_summary>` : "<previous_summary>None - this is the first report.</previous_summary>"}

<recent_entries>
${tier1Xml}
</recent_entries>

<report_insights>
${reportContent.slice(0, 3000)}...
</report_insights>

Respond with a JSON object (no markdown code blocks) containing:
{
  "themes": ["theme1", "theme2", ...],  // Recurring patterns and topics (max 5)
  "activeGoals": ["goal1", "goal2", ...],  // Goals still in progress (max 5)
  "relationships": ["person/project1", ...],  // Key people/projects mentioned (max 5)
  "openThreads": ["thread1", ...],  // Unresolved situations to track (max 5)
  "historicalHighlights": "Brief narrative summary of key historical context (2-3 sentences)"
}

Update based on new developments. Remove resolved threads/completed goals. Add new patterns discovered.`;

  const response = await client.messages.create({
    model: OPUS_MODEL,
    system:
      "You are updating a rolling summary of journal patterns. Respond only with valid JSON.",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1000,
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("Failed to update rolling summary");
  }

  try {
    const parsed = JSON.parse(textContent.text);
    return {
      lastUpdated: new Date().toISOString(),
      themes: parsed.themes || [],
      activeGoals: parsed.activeGoals || [],
      relationships: parsed.relationships || [],
      openThreads: parsed.openThreads || [],
      historicalHighlights: parsed.historicalHighlights || "",
    };
  } catch {
    // Return empty summary if parsing fails
    return {
      lastUpdated: new Date().toISOString(),
      themes: [],
      activeGoals: [],
      relationships: [],
      openThreads: [],
      historicalHighlights: "",
    };
  }
}

export interface ReportOptions {
  journalXml: string;
  apiKey: string;
  formattedDate: string;
  customTopics?: string[];
  includeStandardReport?: boolean;
  accessToken?: string | null; // Google Drive access token for authenticated users
  onProgress?: (stage: string, detail?: string) => void;
}

export interface ReportResult {
  report: string;
  tierStats: {
    tier1Count: number;
    tier2WeekCount: number;
    tier3MonthCount: number;
    summariesGenerated: number;
    summariesCached: number;
  };
}

/**
 * Generate a report from journal entries using hierarchical summarization
 *
 * Flow:
 * 1. Parse entries and partition into tiers
 * 2. Load existing summaries from Google Drive (if authenticated)
 * 3. Generate missing summaries with Haiku
 * 4. Build hierarchical context
 * 5. Generate report with Opus
 * 6. Update rolling summary (if authenticated)
 * 7. Save new summaries to Google Drive (if authenticated)
 */
export async function getReport(
  journalXml: string,
  apiKey: string,
  formattedDate: string,
  customTopics?: string[],
  includeStandardReport?: boolean
): Promise<string>;

export async function getReport(options: ReportOptions): Promise<ReportResult>;

export async function getReport(
  journalXmlOrOptions: string | ReportOptions,
  apiKeyArg?: string,
  formattedDateArg?: string,
  customTopicsArg: string[] = [],
  includeStandardReportArg: boolean = true
): Promise<string | ReportResult> {
  // Handle both old and new signatures
  let options: ReportOptions;
  let returnLegacy = false;

  if (typeof journalXmlOrOptions === "string") {
    returnLegacy = true;
    options = {
      journalXml: journalXmlOrOptions,
      apiKey: apiKeyArg!,
      formattedDate: formattedDateArg!,
      customTopics: customTopicsArg,
      includeStandardReport: includeStandardReportArg,
      accessToken: null,
    };
  } else {
    options = journalXmlOrOptions;
  }

  const {
    journalXml,
    apiKey,
    formattedDate,
    customTopics = [],
    includeStandardReport = true,
    accessToken = null,
    onProgress,
  } = options;

  loadPrompts();

  const client = new Anthropic({ apiKey });
  const isAuthenticated = !!accessToken;

  // 1. Parse and partition entries
  onProgress?.("Analyzing journal structure");
  const entries = parseEntriesFromXml(journalXml);
  const tiered = partitionEntries(entries);
  const stats = getTierStats(tiered);

  console.log(
    `Tier stats: ${stats.tier1Count} recent, ${stats.tier2WeekCount} weeks, ${stats.tier3MonthCount} months`
  );

  // 2. Load existing summaries (authenticated only)
  let existingSummaries = new Map<string, StoredTierSummary>();
  let rollingSummary: RollingSummary | null = null;

  if (isAuthenticated) {
    onProgress?.("Loading cached summaries");
    existingSummaries = await loadTierSummaries(accessToken);
    rollingSummary = await loadRollingSummary(accessToken);
    console.log(`Loaded ${existingSummaries.size} cached summaries`);
  }

  // 3. Determine which summaries need generation
  const { missingWeeks, missingMonths } = getMissingPeriods(
    tiered,
    existingSummaries
  );

  console.log(
    `Missing summaries: ${missingWeeks.length} weeks, ${missingMonths.length} months`
  );

  // 4. Generate missing summaries with Haiku
  let newSummaries: TierSummary[] = [];
  if (missingWeeks.length > 0 || missingMonths.length > 0) {
    onProgress?.(
      "Generating summaries",
      `${missingWeeks.length + missingMonths.length} periods`
    );

    const weeklyToSummarize = new Map<string, typeof tiered.tier2Weeks extends Map<string, infer V> ? V : never>();
    for (const week of missingWeeks) {
      const entries = tiered.tier2Weeks.get(week);
      if (entries) weeklyToSummarize.set(week, entries);
    }

    const monthlyToSummarize = new Map<string, typeof tiered.tier3Months extends Map<string, infer V> ? V : never>();
    for (const month of missingMonths) {
      const entries = tiered.tier3Months.get(month);
      if (entries) monthlyToSummarize.set(month, entries);
    }

    newSummaries = await generateSummaries(
      apiKey,
      weeklyToSummarize,
      monthlyToSummarize,
      (completed, total) => {
        onProgress?.("Generating summaries", `${completed}/${total} periods`);
      }
    );
  }

  // 5. Combine all summaries
  const allSummaries: TierSummary[] = [
    ...Array.from(existingSummaries.values()),
    ...newSummaries,
  ];

  // 6. Build hierarchical context
  onProgress?.("Building context");
  const tier1Xml = entriesToXml(tiered.tier1);
  const hierarchicalContext = buildHierarchicalContext(
    tier1Xml,
    allSummaries,
    rollingSummary
  );

  // 7. Check token count and truncate tier1 if needed
  const tokenCount = await client.messages.countTokens({
    model: OPUS_MODEL,
    messages: [{ role: "user", content: hierarchicalContext }],
  });

  let processedContext = hierarchicalContext;
  if (tokenCount.input_tokens > MAX_JOURNAL_TOKENS) {
    console.log(
      `Context too long (${tokenCount.input_tokens} tokens), truncating recent entries`
    );
    // Truncate only the recent entries portion
    const truncationRatio = MAX_JOURNAL_TOKENS / tokenCount.input_tokens;
    const tier1Truncated = tier1Xml.slice(
      Math.floor(tier1Xml.length * (1 - truncationRatio))
    );
    processedContext = buildHierarchicalContext(
      "...older recent entries truncated...\n" + tier1Truncated,
      allSummaries,
      rollingSummary
    );
  }

  // 8. Generate report with Opus
  onProgress?.("Generating insights");

  const assistantPrefill = `# JournaLens Advice for ${formattedDate}`;
  const customTopicsPrompt = buildCustomTopicsPrompt(
    customTopics,
    includeStandardReport
  );

  const basePrompt = includeStandardReport
    ? reportPrompt
    : `<response_format>
Format your entire response in Markdown, using header level 2 (##) for each section.
Include a blank line after each section heading and before each bulleted/numbered list.
</response_format>

<instructions>
Based on my journal entries above, please address ONLY the custom topics specified below.
Be thoughtful, thorough, and honest in your analysis.
</instructions>`;

  const fullPrompt = basePrompt + customTopicsPrompt;

  // Add context explanation for the model
  const contextExplanation = `<context_structure>
This journal content is organized hierarchically:
- Rolling Summary: Longitudinal patterns tracked across previous reports (if present)
- Monthly Summaries: AI-generated digests of entries from 90+ days ago
- Weekly Summaries: AI-generated digests of entries from 15-90 days ago
- Recent Entries: Full text of entries from the last 14 days

Please use all available context to provide comprehensive insights, but weight recent entries more heavily for actionable advice.
</context_structure>

`;

  const response = await client.messages.create({
    model: OPUS_MODEL,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `${contextExplanation}<journal>\n${processedContext}\n</journal>`,
      },
      { role: "user", content: fullPrompt },
      { role: "assistant", content: assistantPrefill },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in response");
  }

  const reportContent = assistantPrefill + textContent.text;

  // 9. Update rolling summary and save (authenticated only)
  if (isAuthenticated) {
    onProgress?.("Saving summaries");

    // Update rolling summary
    const updatedRollingSummary = await updateRollingSummaryWithOpus(
      client,
      rollingSummary,
      tier1Xml,
      reportContent
    );

    // Save in parallel
    await Promise.all([
      saveTierSummaries(accessToken, newSummaries),
      saveRollingSummary(accessToken, updatedRollingSummary),
    ]);
  }

  const result: ReportResult = {
    report: reportContent,
    tierStats: {
      tier1Count: stats.tier1Count,
      tier2WeekCount: stats.tier2WeekCount,
      tier3MonthCount: stats.tier3MonthCount,
      summariesGenerated: newSummaries.length,
      summariesCached: existingSummaries.size,
    },
  };

  return returnLegacy ? result.report : result;
}

/**
 * Estimate cost for generating a report
 * Returns cost breakdown for display in UI
 */
export function estimateReportCost(
  characterCount: number,
  isAuthenticated: boolean,
  cachedSummaryCount: number = 0
): {
  haikuCost: number;
  opusCost: number;
  totalCost: number;
  breakdown: string;
} {
  const CHARS_PER_TOKEN = 4;
  const tokens = characterCount / CHARS_PER_TOKEN;

  // Rough tier distribution estimate
  const tier1Tokens = Math.min(tokens, 50000);
  const tier2Tokens = Math.min(tokens - tier1Tokens, 150000);
  const tier3Tokens = Math.max(0, tokens - tier1Tokens - tier2Tokens);

  // Estimate periods (rough: 1 week = ~15k tokens, 1 month = ~60k tokens)
  const estimatedWeeks = Math.ceil(tier2Tokens / 15000);
  const estimatedMonths = Math.ceil(tier3Tokens / 60000);
  const totalPeriods = estimatedWeeks + estimatedMonths;
  const periodsToGenerate = Math.max(0, totalPeriods - cachedSummaryCount);

  // Haiku costs (input + output)
  const haikuInputTokens = (tier2Tokens + tier3Tokens) * (periodsToGenerate / Math.max(totalPeriods, 1));
  const haikuOutputTokens = periodsToGenerate * 600; // ~600 tokens average per summary
  const haikuCost = (haikuInputTokens * 1 + haikuOutputTokens * 5) / 1_000_000;

  // Opus costs
  const opusInputTokens = 70000 + tier1Tokens; // Base context + recent entries
  const opusOutputTokens = 4000;
  let opusCost = (opusInputTokens * 5 + opusOutputTokens * 25) / 1_000_000;

  // Add rolling summary update cost for authenticated
  if (isAuthenticated) {
    opusCost += (15000 * 5 + 1000 * 25) / 1_000_000; // ~$0.10
  }

  const totalCost = haikuCost + opusCost;

  let breakdown: string;
  if (cachedSummaryCount > 0) {
    breakdown = `Using ${cachedSummaryCount} cached summaries`;
  } else if (isAuthenticated) {
    breakdown = "Summaries will be cached for future reports";
  } else {
    breakdown = "Sign in to cache summaries and reduce future costs";
  }

  return { haikuCost, opusCost, totalCost, breakdown };
}
