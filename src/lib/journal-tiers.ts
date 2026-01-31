/**
 * Journal tier partitioning for hierarchical summarization
 *
 * Tiers:
 * - Tier 1 (0-14 days): Full text sent to Opus
 * - Tier 2 (15-90 days): Weekly summaries via Haiku
 * - Tier 3 (90+ days): Monthly summaries via Haiku
 */

export interface ParsedEntry {
  date: Date;
  text: string;
  journal?: string;
  location?: string;
}

export interface TieredJournal {
  tier1: ParsedEntry[]; // 0-14 days - full text
  tier2Batches: ParsedEntry[][]; // 15-90 days - grouped by week
  tier3Batches: ParsedEntry[][]; // 90+ days - grouped by month
  stats: {
    totalEntries: number;
    tier1Entries: number;
    tier2Entries: number;
    tier3Entries: number;
    estimatedTokens: number;
  };
}

const TIER1_DAYS = 14;
const TIER2_DAYS = 90;

/**
 * Parse XML journal content into structured entries
 */
export function parseJournalXml(xml: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];

  // Match <entry> or <journal_entry> blocks
  const entryRegex =
    /<(?:entry|journal_entry)[^>]*>([\s\S]*?)<\/(?:entry|journal_entry)>/gi;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryContent = match[1];

    // Extract date - try multiple formats
    let date: Date | null = null;

    // Try <date> tag
    const dateTagMatch = entryContent.match(/<date>([^<]+)<\/date>/i);
    if (dateTagMatch) {
      date = parseDate(dateTagMatch[1].trim());
    }

    // Try date attribute
    if (!date) {
      const dateAttrMatch = match[0].match(/date=["']([^"']+)["']/i);
      if (dateAttrMatch) {
        date = parseDate(dateAttrMatch[1].trim());
      }
    }

    // Try created/created_at/timestamp
    if (!date) {
      const timestampMatch = entryContent.match(
        /<(?:created|created_at|timestamp)>([^<]+)<\/(?:created|created_at|timestamp)>/i
      );
      if (timestampMatch) {
        date = parseDate(timestampMatch[1].trim());
      }
    }

    // Skip entries without valid dates
    if (!date) {
      continue;
    }

    // Extract text content
    const textMatch = entryContent.match(
      /<(?:text|content|body)>([\s\S]*?)<\/(?:text|content|body)>/i
    );
    const text = textMatch ? textMatch[1].trim() : entryContent.trim();

    // Skip empty entries
    if (!text) {
      continue;
    }

    // Extract optional metadata
    const journalMatch = entryContent.match(/<journal>([^<]+)<\/journal>/i);
    const locationMatch = entryContent.match(/<location>([^<]+)<\/location>/i);

    entries.push({
      date,
      text,
      journal: journalMatch ? journalMatch[1].trim() : undefined,
      location: locationMatch ? locationMatch[1].trim() : undefined,
    });
  }

  // Sort by date ascending (oldest first)
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  return entries;
}

/**
 * Parse various date formats
 */
function parseDate(dateStr: string): Date | null {
  // Try ISO format first
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try common formats
  const formats = [
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
    /(\d{1,2})\s+(\w+)\s+(\d{4})/, // D Month YYYY
  ];

  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return null;
}

/**
 * Partition entries into tiers based on age
 */
export function partitionIntoTiers(
  entries: ParsedEntry[],
  now: Date = new Date()
): TieredJournal {
  const tier1: ParsedEntry[] = [];
  const tier2: ParsedEntry[] = [];
  const tier3: ParsedEntry[] = [];

  const tier1Cutoff = new Date(now);
  tier1Cutoff.setDate(tier1Cutoff.getDate() - TIER1_DAYS);

  const tier2Cutoff = new Date(now);
  tier2Cutoff.setDate(tier2Cutoff.getDate() - TIER2_DAYS);

  for (const entry of entries) {
    if (entry.date >= tier1Cutoff) {
      tier1.push(entry);
    } else if (entry.date >= tier2Cutoff) {
      tier2.push(entry);
    } else {
      tier3.push(entry);
    }
  }

  // Group tier 2 by week
  const tier2Batches = groupByWeek(tier2);

  // Group tier 3 by month
  const tier3Batches = groupByMonth(tier3);

  // Estimate tokens (roughly 4 chars per token)
  const estimatedTokens =
    estimateTokens(tier1) +
    tier2Batches.reduce((sum, batch) => sum + estimateTokens(batch), 0) +
    tier3Batches.reduce((sum, batch) => sum + estimateTokens(batch), 0);

  return {
    tier1,
    tier2Batches,
    tier3Batches,
    stats: {
      totalEntries: entries.length,
      tier1Entries: tier1.length,
      tier2Entries: tier2.length,
      tier3Entries: tier3.length,
      estimatedTokens,
    },
  };
}

/**
 * Group entries by week (ISO week number)
 */
function groupByWeek(entries: ParsedEntry[]): ParsedEntry[][] {
  const weeks = new Map<string, ParsedEntry[]>();

  for (const entry of entries) {
    const weekKey = getWeekKey(entry.date);
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, []);
    }
    weeks.get(weekKey)!.push(entry);
  }

  // Sort weeks chronologically and return as array
  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entries]) => entries);
}

/**
 * Group entries by month
 */
function groupByMonth(entries: ParsedEntry[]): ParsedEntry[][] {
  const months = new Map<string, ParsedEntry[]>();

  for (const entry of entries) {
    const monthKey = `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, "0")}`;
    if (!months.has(monthKey)) {
      months.set(monthKey, []);
    }
    months.get(monthKey)!.push(entry);
  }

  // Sort months chronologically and return as array
  return Array.from(months.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entries]) => entries);
}

/**
 * Get ISO week key for a date (YYYY-Www format)
 */
function getWeekKey(date: Date): string {
  const year = date.getFullYear();
  const firstDayOfYear = new Date(year, 0, 1);
  const dayOfYear =
    Math.floor(
      (date.getTime() - firstDayOfYear.getTime()) / (24 * 60 * 60 * 1000)
    ) + 1;
  const weekNumber = Math.ceil(
    (dayOfYear + firstDayOfYear.getDay()) / 7
  );
  return `${year}-W${String(weekNumber).padStart(2, "0")}`;
}

/**
 * Estimate token count for entries (roughly 4 chars per token)
 */
function estimateTokens(entries: ParsedEntry[]): number {
  const totalChars = entries.reduce((sum, entry) => sum + entry.text.length, 0);
  return Math.ceil(totalChars / 4);
}

/**
 * Convert entries back to XML format for processing
 */
export function entriesToXml(entries: ParsedEntry[]): string {
  return entries
    .map((entry) => {
      const dateStr = entry.date.toISOString().split("T")[0];
      let xml = `<entry date="${dateStr}">`;
      if (entry.journal) xml += `\n  <journal>${entry.journal}</journal>`;
      if (entry.location) xml += `\n  <location>${entry.location}</location>`;
      xml += `\n  <text>${entry.text}</text>`;
      xml += `\n</entry>`;
      return xml;
    })
    .join("\n\n");
}

/**
 * Get the date range for a batch of entries
 */
export function getBatchDateRange(entries: ParsedEntry[]): {
  start: Date;
  end: Date;
} {
  if (entries.length === 0) {
    throw new Error("Cannot get date range for empty batch");
  }

  const dates = entries.map((e) => e.date.getTime());
  return {
    start: new Date(Math.min(...dates)),
    end: new Date(Math.max(...dates)),
  };
}

/**
 * Format a batch for display (e.g., "Week of Jan 1, 2024" or "January 2024")
 */
export function formatBatchPeriod(
  entries: ParsedEntry[],
  type: "weekly" | "monthly"
): string {
  const { start } = getBatchDateRange(entries);

  if (type === "weekly") {
    return `Week of ${start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  } else {
    return start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }
}

/**
 * Get a unique identifier for a batch based on its period
 */
export function getBatchPeriodKey(
  entries: ParsedEntry[],
  type: "weekly" | "monthly"
): string {
  const { start } = getBatchDateRange(entries);

  if (type === "weekly") {
    return getWeekKey(start);
  } else {
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
  }
}
