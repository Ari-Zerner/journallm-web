import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReportWithTiers } from "@/lib/claude-prompter";
import {
  parseJournalXml,
  partitionIntoTiers,
  getBatchPeriodKey,
} from "@/lib/journal-tiers";
import {
  summarizeBatches,
  createCachedSummary,
  BatchSummary,
} from "@/lib/haiku-summarizer";
import {
  findUncachedBatches,
  saveCachedSummaries,
  generateContentHash,
  CachedSummary,
} from "@/lib/google-drive-summaries";

export const maxDuration = 300; // 5 minutes for Vercel Pro

export interface GenerateStats {
  totalEntries: number;
  tier1Entries: number;
  tier2Entries: number;
  tier3Entries: number;
  tier2Batches: number;
  tier3Batches: number;
  cachedBatches: number;
  newSummaries: number;
  haikuInputTokens: number;
  haikuOutputTokens: number;
  opusInputTokens: number;
  opusOutputTokens: number;
}

export async function POST(request: NextRequest) {
  try {
    const {
      journal,
      apiKey: providedApiKey,
      formattedDate,
      customTopics,
      customTopicsOnly,
    } = await request.json();

    // Get session for Drive caching (optional)
    const session = await auth();
    const accessToken = session?.accessToken || null;

    // Use provided API key or fall back to environment variable
    const apiKey = providedApiKey || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    if (!journal || typeof journal !== "string") {
      return NextResponse.json(
        { error: "Journal content is required" },
        { status: 400 }
      );
    }

    if (!formattedDate || typeof formattedDate !== "string") {
      return NextResponse.json(
        { error: "Formatted date is required" },
        { status: 400 }
      );
    }

    // Parse and partition journal entries
    const entries = parseJournalXml(journal);
    const tiered = partitionIntoTiers(entries);

    const stats: GenerateStats = {
      totalEntries: tiered.stats.totalEntries,
      tier1Entries: tiered.stats.tier1Entries,
      tier2Entries: tiered.stats.tier2Entries,
      tier3Entries: tiered.stats.tier3Entries,
      tier2Batches: tiered.tier2Batches.length,
      tier3Batches: tiered.tier3Batches.length,
      cachedBatches: 0,
      newSummaries: 0,
      haikuInputTokens: 0,
      haikuOutputTokens: 0,
      opusInputTokens: 0,
      opusOutputTokens: 0,
    };

    // Process tier 2 (weekly summaries)
    const weeklySummaries: BatchSummary[] = [];
    if (tiered.tier2Batches.length > 0) {
      const { cached: cachedWeekly, uncachedIndices: uncachedWeeklyIndices } =
        await findUncachedBatches(
          accessToken,
          tiered.tier2Batches,
          "weekly",
          (entries) => getBatchPeriodKey(entries, "weekly")
        );

      // Add cached summaries
      for (const [, cached] of cachedWeekly) {
        weeklySummaries.push(createCachedSummary(cached));
      }
      stats.cachedBatches += cachedWeekly.size;

      // Generate new summaries for uncached batches
      if (uncachedWeeklyIndices.length > 0) {
        const uncachedBatches = uncachedWeeklyIndices.map(
          (i) => tiered.tier2Batches[i]
        );
        try {
          const newSummaries = await summarizeBatches(
            apiKey,
            uncachedBatches,
            "weekly"
          );

          for (const summary of newSummaries) {
            weeklySummaries.push(summary);
            stats.haikuInputTokens += summary.inputTokens;
            stats.haikuOutputTokens += summary.outputTokens;
          }
          stats.newSummaries += newSummaries.length;

          // Cache new summaries if authenticated
          if (accessToken) {
            const toCache: CachedSummary[] = newSummaries
              .filter((s) => !s.fallback)
              .map((s) => {
                const batch = uncachedBatches.find(
                  (b) => getBatchPeriodKey(b, "weekly") === s.periodKey
                )!;
                return {
                  periodKey: s.periodKey,
                  periodLabel: s.periodLabel,
                  type: s.type,
                  summary: s.summary,
                  entryCount: s.entryCount,
                  contentHash: generateContentHash(batch),
                  createdAt: new Date().toISOString(),
                };
              });

            // Save in background (don't await)
            saveCachedSummaries(accessToken, toCache).catch(console.error);
          }
        } catch (error) {
          console.error("Error generating weekly summaries:", error);
          // Continue without weekly summaries - graceful degradation
        }
      }
    }

    // Process tier 3 (monthly summaries)
    const monthlySummaries: BatchSummary[] = [];
    if (tiered.tier3Batches.length > 0) {
      const { cached: cachedMonthly, uncachedIndices: uncachedMonthlyIndices } =
        await findUncachedBatches(
          accessToken,
          tiered.tier3Batches,
          "monthly",
          (entries) => getBatchPeriodKey(entries, "monthly")
        );

      // Add cached summaries
      for (const [, cached] of cachedMonthly) {
        monthlySummaries.push(createCachedSummary(cached));
      }
      stats.cachedBatches += cachedMonthly.size;

      // Generate new summaries for uncached batches
      if (uncachedMonthlyIndices.length > 0) {
        const uncachedBatches = uncachedMonthlyIndices.map(
          (i) => tiered.tier3Batches[i]
        );
        try {
          const newSummaries = await summarizeBatches(
            apiKey,
            uncachedBatches,
            "monthly"
          );

          for (const summary of newSummaries) {
            monthlySummaries.push(summary);
            stats.haikuInputTokens += summary.inputTokens;
            stats.haikuOutputTokens += summary.outputTokens;
          }
          stats.newSummaries += newSummaries.length;

          // Cache new summaries if authenticated
          if (accessToken) {
            const toCache: CachedSummary[] = newSummaries
              .filter((s) => !s.fallback)
              .map((s) => {
                const batch = uncachedBatches.find(
                  (b) => getBatchPeriodKey(b, "monthly") === s.periodKey
                )!;
                return {
                  periodKey: s.periodKey,
                  periodLabel: s.periodLabel,
                  type: s.type,
                  summary: s.summary,
                  entryCount: s.entryCount,
                  contentHash: generateContentHash(batch),
                  createdAt: new Date().toISOString(),
                };
              });

            // Save in background (don't await)
            saveCachedSummaries(accessToken, toCache).catch(console.error);
          }
        } catch (error) {
          console.error("Error generating monthly summaries:", error);
          // Continue without monthly summaries - graceful degradation
        }
      }
    }

    // Sort summaries chronologically
    weeklySummaries.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    monthlySummaries.sort((a, b) => a.periodKey.localeCompare(b.periodKey));

    // Generate final report with Opus
    const topics = Array.isArray(customTopics) ? customTopics : [];
    const result = await getReportWithTiers(
      {
        recentEntries: tiered.tier1,
        weeklySummaries,
        monthlySummaries,
      },
      apiKey,
      formattedDate,
      topics,
      !!customTopicsOnly
    );

    stats.opusInputTokens = result.inputTokens;
    stats.opusOutputTokens = result.outputTokens;

    return NextResponse.json({
      report: result.report,
      stats,
    });
  } catch (error) {
    console.error("Error generating report:", error);

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
