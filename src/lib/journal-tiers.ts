/**
 * Journal tier partitioning for hierarchical summarization
 *
 * Tiers:
 * - Tier 1 (Recent): Last 14 days - full text
 * - Tier 2 (Medium): 15-90 days ago - weekly summaries
 * - Tier 3 (Older): 90+ days ago - monthly summaries
 *
 * Important: Only COMPLETED calendar periods are summarized.
 * Incomplete periods (current week/month) are promoted to the next tier up.
 */

export interface JournalEntry {
  created: string; // ISO date string
  content: string; // Full XML entry content
}

export interface TieredEntries {
  tier1: JournalEntry[]; // Full text (recent + incomplete periods)
  tier2Weeks: Map<string, JournalEntry[]>; // Weekly groups (completed weeks only)
  tier3Months: Map<string, JournalEntry[]>; // Monthly groups (completed months only)
}

// Tier boundaries in days
const TIER_1_DAYS = 14;
const TIER_2_DAYS = 90;

/**
 * Get ISO week key (e.g., "2025-W03")
 */
function getWeekKey(date: Date): string {
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const days = Math.floor(
    (date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)
  );
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${year}-W${weekNumber.toString().padStart(2, "0")}`;
}

/**
 * Get month key (e.g., "2025-01")
 */
function getMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Check if a week is complete (all 7 days have passed)
 */
function isWeekComplete(weekKey: string, now: Date): boolean {
  // Parse week key
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // Calculate end of week (Sunday 23:59:59)
  const startOfYear = new Date(year, 0, 1);
  const daysOffset = (week - 1) * 7 - startOfYear.getDay() + 7; // End of week (Sunday)
  const endOfWeek = new Date(year, 0, 1 + daysOffset, 23, 59, 59);

  return now > endOfWeek;
}

/**
 * Check if a month is complete
 */
function isMonthComplete(monthKey: string, now: Date): boolean {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  // First day of next month
  const startOfNextMonth = new Date(year, month, 1);

  return now >= startOfNextMonth;
}

/**
 * Parse entries from XML and extract dates
 */
export function parseEntriesFromXml(xml: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  const createdRegex = /<created>(.*?)<\/created>/;

  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryContent = match[0];
    const createdMatch = entryContent.match(createdRegex);

    if (createdMatch && createdMatch[1]) {
      entries.push({
        created: createdMatch[1],
        content: entryContent,
      });
    }
  }

  // Sort by date ascending
  entries.sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  );

  return entries;
}

/**
 * Partition entries into tiers based on age
 *
 * Key behavior for incomplete periods:
 * - If current week is incomplete → those entries go to Tier 1
 * - If current month is incomplete → those entries stay in Tier 2 (as full text)
 */
export function partitionEntries(
  entries: JournalEntry[],
  now: Date = new Date()
): TieredEntries {
  const tier1: JournalEntry[] = [];
  const tier2Entries: JournalEntry[] = [];
  const tier3Entries: JournalEntry[] = [];

  const tier1Cutoff = new Date(now.getTime() - TIER_1_DAYS * 24 * 60 * 60 * 1000);
  const tier2Cutoff = new Date(now.getTime() - TIER_2_DAYS * 24 * 60 * 60 * 1000);

  // First pass: partition by age
  for (const entry of entries) {
    const entryDate = new Date(entry.created);

    if (entryDate >= tier1Cutoff) {
      tier1.push(entry);
    } else if (entryDate >= tier2Cutoff) {
      tier2Entries.push(entry);
    } else {
      tier3Entries.push(entry);
    }
  }

  // Second pass: group Tier 2 by week, handling incomplete weeks
  const tier2Weeks = new Map<string, JournalEntry[]>();
  for (const entry of tier2Entries) {
    const entryDate = new Date(entry.created);
    const weekKey = getWeekKey(entryDate);

    if (!isWeekComplete(weekKey, now)) {
      // Incomplete week → promote to Tier 1
      tier1.push(entry);
    } else {
      if (!tier2Weeks.has(weekKey)) {
        tier2Weeks.set(weekKey, []);
      }
      tier2Weeks.get(weekKey)!.push(entry);
    }
  }

  // Third pass: group Tier 3 by month, handling incomplete months
  const tier3Months = new Map<string, JournalEntry[]>();
  for (const entry of tier3Entries) {
    const entryDate = new Date(entry.created);
    const monthKey = getMonthKey(entryDate);

    if (!isMonthComplete(monthKey, now)) {
      // Incomplete month → promote to Tier 2 as weekly
      const weekKey = getWeekKey(entryDate);
      if (isWeekComplete(weekKey, now)) {
        if (!tier2Weeks.has(weekKey)) {
          tier2Weeks.set(weekKey, []);
        }
        tier2Weeks.get(weekKey)!.push(entry);
      } else {
        // Really shouldn't happen, but handle gracefully
        tier1.push(entry);
      }
    } else {
      if (!tier3Months.has(monthKey)) {
        tier3Months.set(monthKey, []);
      }
      tier3Months.get(monthKey)!.push(entry);
    }
  }

  // Sort tier1 by date
  tier1.sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  );

  return { tier1, tier2Weeks, tier3Months };
}

/**
 * Reconstruct XML from entries
 */
export function entriesToXml(entries: JournalEntry[]): string {
  if (entries.length === 0) return "";
  return entries.map((e) => e.content).join("\n");
}

/**
 * Get period keys that need summarization (not already cached)
 */
export function getMissingPeriods(
  tiered: TieredEntries,
  existingSummaries: Map<string, unknown>
): { missingWeeks: string[]; missingMonths: string[] } {
  const missingWeeks = [...tiered.tier2Weeks.keys()].filter(
    (week) => !existingSummaries.has(`weekly:${week}`)
  );
  const missingMonths = [...tiered.tier3Months.keys()].filter(
    (month) => !existingSummaries.has(`monthly:${month}`)
  );

  return { missingWeeks, missingMonths };
}

/**
 * Format period key for display
 */
export function formatPeriodKey(key: string): string {
  if (key.includes("-W")) {
    // Week key: 2025-W03 → "Week 3, 2025"
    const match = key.match(/^(\d{4})-W(\d{2})$/);
    if (match) {
      return `Week ${parseInt(match[2], 10)}, ${match[1]}`;
    }
  } else {
    // Month key: 2025-01 → "January 2025"
    const match = key.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const date = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1);
      return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  }
  return key;
}

/**
 * Estimate character count for cost display
 * Accounts for XML overhead per entry
 */
export function estimateCharacterCount(
  entries: JournalEntry[],
  xmlOverheadPerEntry: number = 150
): number {
  let total = 0;
  for (const entry of entries) {
    total += entry.content.length + xmlOverheadPerEntry;
  }
  return total;
}

/**
 * Get tier statistics for debugging/display
 */
export function getTierStats(tiered: TieredEntries): {
  tier1Count: number;
  tier2WeekCount: number;
  tier2EntryCount: number;
  tier3MonthCount: number;
  tier3EntryCount: number;
} {
  let tier2EntryCount = 0;
  for (const entries of tiered.tier2Weeks.values()) {
    tier2EntryCount += entries.length;
  }

  let tier3EntryCount = 0;
  for (const entries of tiered.tier3Months.values()) {
    tier3EntryCount += entries.length;
  }

  return {
    tier1Count: tiered.tier1.length,
    tier2WeekCount: tiered.tier2Weeks.size,
    tier2EntryCount,
    tier3MonthCount: tiered.tier3Months.size,
    tier3EntryCount,
  };
}
