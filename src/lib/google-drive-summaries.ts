/**
 * Cache journal summaries in Google Drive appDataFolder
 *
 * Key format: summary-{weekly|monthly}-{periodKey}-{contentHash}.json
 * Content hash enables automatic invalidation when entries change
 */

import { google } from "googleapis";
import { createHash } from "crypto";
import { ParsedEntry } from "./journal-tiers";

export interface CachedSummary {
  periodKey: string;
  periodLabel: string;
  type: "weekly" | "monthly";
  summary: string;
  entryCount: number;
  contentHash: string;
  createdAt: string;
}

function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

/**
 * Generate a content hash for a batch of entries
 * This allows automatic cache invalidation when entries change
 */
export function generateContentHash(entries: ParsedEntry[]): string {
  const content = entries
    .map((e) => `${e.date.toISOString()}|${e.text}`)
    .join("\n");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Generate the filename for a cached summary
 */
function getSummaryFileName(
  type: "weekly" | "monthly",
  periodKey: string,
  contentHash: string
): string {
  // Sanitize periodKey for filename (replace special chars)
  const safePeriodKey = periodKey.replace(/[^a-zA-Z0-9-]/g, "_");
  return `summary-${type}-${safePeriodKey}-${contentHash}.json`;
}

/**
 * Get a cached summary if it exists and matches the content hash
 */
export async function getCachedSummary(
  accessToken: string,
  type: "weekly" | "monthly",
  periodKey: string,
  contentHash: string
): Promise<CachedSummary | null> {
  try {
    const drive = getDriveClient(accessToken);
    const fileName = getSummaryFileName(type, periodKey, contentHash);

    // Find the file
    const response = await drive.files.list({
      spaces: "appDataFolder",
      q: `name = '${fileName}'`,
      fields: "files(id)",
    });

    const file = response.data.files?.[0];
    if (!file?.id) {
      return null;
    }

    // Download content
    const content = await drive.files.get({
      fileId: file.id,
      alt: "media",
    });

    return content.data as unknown as CachedSummary;
  } catch (error) {
    console.error("Error fetching cached summary:", error);
    return null;
  }
}

/**
 * Get all cached summaries for a given type
 */
export async function getCachedSummaries(
  accessToken: string,
  type: "weekly" | "monthly"
): Promise<CachedSummary[]> {
  try {
    const drive = getDriveClient(accessToken);

    // Find all summary files of this type
    const response = await drive.files.list({
      spaces: "appDataFolder",
      q: `name contains 'summary-${type}-' and name contains '.json'`,
      fields: "files(id, name)",
    });

    const files = response.data.files || [];
    const summaries: CachedSummary[] = [];

    for (const file of files) {
      if (!file.id) continue;

      try {
        const content = await drive.files.get({
          fileId: file.id,
          alt: "media",
        });

        summaries.push(content.data as unknown as CachedSummary);
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return summaries;
  } catch (error) {
    console.error("Error listing cached summaries:", error);
    return [];
  }
}

/**
 * Save a summary to the cache
 */
export async function saveCachedSummary(
  accessToken: string,
  summary: CachedSummary
): Promise<void> {
  try {
    const drive = getDriveClient(accessToken);
    const fileName = getSummaryFileName(
      summary.type,
      summary.periodKey,
      summary.contentHash
    );

    // Check if file already exists
    const existing = await drive.files.list({
      spaces: "appDataFolder",
      q: `name = '${fileName}'`,
      fields: "files(id)",
    });

    const media = {
      mimeType: "application/json",
      body: JSON.stringify(summary),
    };

    if (existing.data.files?.[0]?.id) {
      // Update existing file
      await drive.files.update({
        fileId: existing.data.files[0].id,
        media,
      });
    } else {
      // Create new file
      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: ["appDataFolder"],
        },
        media,
        fields: "id",
      });
    }
  } catch (error) {
    console.error("Error saving cached summary:", error);
    // Don't throw - caching is optional
  }
}

/**
 * Save multiple summaries to the cache
 */
export async function saveCachedSummaries(
  accessToken: string,
  summaries: CachedSummary[]
): Promise<void> {
  // Save in parallel with a concurrency limit
  const CONCURRENCY = 5;

  for (let i = 0; i < summaries.length; i += CONCURRENCY) {
    const batch = summaries.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((s) => saveCachedSummary(accessToken, s)));
  }
}

/**
 * Clean up old cached summaries that are no longer needed
 * (Summaries with different content hashes for the same period)
 */
export async function cleanupOldSummaries(
  accessToken: string,
  type: "weekly" | "monthly",
  currentPeriodKeys: Map<string, string> // periodKey -> contentHash
): Promise<number> {
  try {
    const drive = getDriveClient(accessToken);
    let deletedCount = 0;

    // Find all summary files of this type
    const response = await drive.files.list({
      spaces: "appDataFolder",
      q: `name contains 'summary-${type}-' and name contains '.json'`,
      fields: "files(id, name)",
    });

    const files = response.data.files || [];

    for (const file of files) {
      if (!file.id || !file.name) continue;

      // Parse filename to extract periodKey and hash
      // Format: summary-{type}-{periodKey}-{hash}.json
      const match = file.name.match(
        /^summary-(?:weekly|monthly)-(.+)-([a-f0-9]{16})\.json$/
      );
      if (!match) continue;

      const [, periodKey, hash] = match;
      const currentHash = currentPeriodKeys.get(periodKey);

      // Delete if this period exists but with a different hash
      if (currentHash && currentHash !== hash) {
        try {
          await drive.files.delete({ fileId: file.id });
          deletedCount++;
        } catch {
          // Ignore deletion errors
        }
      }
    }

    return deletedCount;
  } catch (error) {
    console.error("Error cleaning up old summaries:", error);
    return 0;
  }
}

/**
 * Check which batches need summarization (not in cache)
 */
export async function findUncachedBatches(
  accessToken: string | null,
  batches: ParsedEntry[][],
  type: "weekly" | "monthly",
  getBatchPeriodKey: (entries: ParsedEntry[]) => string
): Promise<{
  cached: Map<string, CachedSummary>;
  uncachedIndices: number[];
}> {
  const cached = new Map<string, CachedSummary>();
  const uncachedIndices: number[] = [];

  // If not authenticated, everything is uncached
  if (!accessToken) {
    return {
      cached,
      uncachedIndices: batches.map((_, i) => i),
    };
  }

  // Get all cached summaries of this type
  const cachedSummaries = await getCachedSummaries(accessToken, type);
  const cacheMap = new Map<string, CachedSummary>();

  for (const summary of cachedSummaries) {
    // Key by periodKey + contentHash for exact matching
    cacheMap.set(`${summary.periodKey}:${summary.contentHash}`, summary);
  }

  // Check each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const periodKey = getBatchPeriodKey(batch);
    const contentHash = generateContentHash(batch);
    const cacheKey = `${periodKey}:${contentHash}`;

    const cachedSummary = cacheMap.get(cacheKey);
    if (cachedSummary) {
      cached.set(periodKey, cachedSummary);
    } else {
      uncachedIndices.push(i);
    }
  }

  return { cached, uncachedIndices };
}
