import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

const MODEL = "claude-sonnet-4-5";
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
function buildCustomTopicsPrompt(topics: string[], includeStandardReport: boolean): string {
  if (topics.length === 0) return "";

  const topicSections = topics
    .map(
      (topic, i) =>
        `<section heading="Custom Topic ${i + 1}: ${topic}">\nAddress this specific question or topic based on my journal entries. Provide thoughtful analysis and actionable advice.\n</section>`
    )
    .join("\n\n");

  const placement = includeStandardReport
    ? "Add these as separate sections BEFORE the \"Context for JournaLens\" section."
    : "These are the ONLY sections to include in the report (do not include the standard report sections).";

  return `\n\n<custom_topics>\nIMPORTANT: The user has requested ${topics.length} custom topic(s). You MUST address ALL of them - do not skip any.\n\n${placement}\n\n${topicSections}\n</custom_topics>`;
}

/**
 * Generate a report from journal entries using Claude
 */
export async function getReport(
  journalXml: string,
  apiKey: string,
  formattedDate: string,
  customTopics: string[] = [],
  includeStandardReport: boolean = true
): Promise<string> {
  loadPrompts();

  const client = new Anthropic({ apiKey });

  // Count tokens to check if truncation is needed
  const tokenCount = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: "user", content: journalXml }],
  });

  let processedJournal = journalXml;

  // Truncate if journal exceeds token limit
  if (tokenCount.input_tokens > MAX_JOURNAL_TOKENS) {
    console.log(
      `Journal is too long (${tokenCount.input_tokens} tokens), truncating oldest entries`
    );
    const truncationRatio = 1 - MAX_JOURNAL_TOKENS / tokenCount.input_tokens;
    const truncationIndex = Math.floor(journalXml.length * truncationRatio);
    processedJournal =
      "...older entries truncated...\n\n" + journalXml.slice(truncationIndex);
  }

  const assistantPrefill = `# JournaLens Advice for ${formattedDate}`;
  const customTopicsPrompt = buildCustomTopicsPrompt(customTopics, includeStandardReport);

  // If not including standard report, use a minimal prompt
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

  const response = await client.messages.create({
    model: MODEL,
    system: systemPrompt,
    messages: [
      { role: "user", content: `<journal>\n${processedJournal}\n</journal>` },
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
