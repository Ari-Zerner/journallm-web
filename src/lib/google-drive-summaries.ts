/**
 * Google Drive storage for tier summaries and rolling summary
 *
 * Storage structure in appDataFolder:
 * - summaries/weekly/2025-W03.json
 * - summaries/monthly/2025-01.json
 * - rolling-summary.json
 */

import { google } from "googleapis";
import { TierSummary } from "./haiku-summarizer";

const ROLLING_SUMMARY_FILE = "rolling-summary.json";
const SUMMARIES_FOLDER = "summaries";

export interface RollingSummary {
  lastUpdated: string;
  themes: string[];
  activeGoals: string[];
  relationships: string[];
  openThreads: string[];
  historicalHighlights: string;
}

export interface StoredTierSummary extends TierSummary {
  createdAt: string;
}

function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

/**
 * Get or create a folder in appDataFolder
 */
async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  folderName: string,
  parentId: string = "appDataFolder"
): Promise<string> {
  // Check if folder exists
  const response = await drive.files.list({
    spaces: "appDataFolder",
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: "files(id)",
  });

  if (response.data.files?.[0]?.id) {
    return response.data.files[0].id;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return folder.data.id!;
}

/**
 * Load all existing tier summaries from Google Drive
 */
export async function loadTierSummaries(
  accessToken: string
): Promise<Map<string, StoredTierSummary>> {
  const drive = getDriveClient(accessToken);
  const summaries = new Map<string, StoredTierSummary>();

  try {
    // Find summaries folder
    const folderResponse = await drive.files.list({
      spaces: "appDataFolder",
      q: `name='${SUMMARIES_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)",
    });

    const summariesFolderId = folderResponse.data.files?.[0]?.id;
    if (!summariesFolderId) {
      return summaries; // No summaries yet
    }

    // Find weekly and monthly subfolders
    const subfolders = await drive.files.list({
      spaces: "appDataFolder",
      q: `'${summariesFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
    });

    for (const subfolder of subfolders.data.files || []) {
      if (!subfolder.id || !subfolder.name) continue;

      const periodType = subfolder.name as "weekly" | "monthly";

      // List all summary files in this subfolder
      const files = await drive.files.list({
        spaces: "appDataFolder",
        q: `'${subfolder.id}' in parents and name contains '.json' and trashed=false`,
        fields: "files(id, name)",
      });

      for (const file of files.data.files || []) {
        if (!file.id || !file.name) continue;

        try {
          const content = await drive.files.get({
            fileId: file.id,
            alt: "media",
          });

          const summary = content.data as unknown as StoredTierSummary;
          const key = `${periodType}:${summary.periodKey}`;
          summaries.set(key, summary);
        } catch {
          // Skip files that can't be read
          continue;
        }
      }
    }
  } catch (error) {
    console.error("Error loading tier summaries:", error);
  }

  return summaries;
}

/**
 * Save tier summaries to Google Drive
 */
export async function saveTierSummaries(
  accessToken: string,
  summaries: TierSummary[]
): Promise<void> {
  if (summaries.length === 0) return;

  const drive = getDriveClient(accessToken);

  // Get or create folder structure
  const summariesFolderId = await getOrCreateFolder(drive, SUMMARIES_FOLDER);
  const weeklyFolderId = await getOrCreateFolder(drive, "weekly", summariesFolderId);
  const monthlyFolderId = await getOrCreateFolder(drive, "monthly", summariesFolderId);

  // Save each summary
  for (const summary of summaries) {
    const parentId = summary.periodType === "weekly" ? weeklyFolderId : monthlyFolderId;
    const fileName = `${summary.periodKey}.json`;

    const storedSummary: StoredTierSummary = {
      ...summary,
      createdAt: new Date().toISOString(),
    };

    // Check if file already exists
    const existing = await drive.files.list({
      spaces: "appDataFolder",
      q: `name='${fileName}' and '${parentId}' in parents and trashed=false`,
      fields: "files(id)",
    });

    if (existing.data.files?.[0]?.id) {
      // Update existing
      await drive.files.update({
        fileId: existing.data.files[0].id,
        media: {
          mimeType: "application/json",
          body: JSON.stringify(storedSummary),
        },
      });
    } else {
      // Create new
      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [parentId],
        },
        media: {
          mimeType: "application/json",
          body: JSON.stringify(storedSummary),
        },
        fields: "id",
      });
    }
  }
}

/**
 * Load rolling summary from Google Drive
 */
export async function loadRollingSummary(
  accessToken: string
): Promise<RollingSummary | null> {
  const drive = getDriveClient(accessToken);

  try {
    const response = await drive.files.list({
      spaces: "appDataFolder",
      q: `name='${ROLLING_SUMMARY_FILE}' and trashed=false`,
      fields: "files(id)",
    });

    const file = response.data.files?.[0];
    if (!file?.id) {
      return null;
    }

    const content = await drive.files.get({
      fileId: file.id,
      alt: "media",
    });

    return content.data as unknown as RollingSummary;
  } catch {
    return null;
  }
}

/**
 * Save rolling summary to Google Drive
 */
export async function saveRollingSummary(
  accessToken: string,
  summary: RollingSummary
): Promise<void> {
  const drive = getDriveClient(accessToken);

  // Check if file exists
  const existing = await drive.files.list({
    spaces: "appDataFolder",
    q: `name='${ROLLING_SUMMARY_FILE}' and trashed=false`,
    fields: "files(id)",
  });

  const media = {
    mimeType: "application/json",
    body: JSON.stringify(summary),
  };

  if (existing.data.files?.[0]?.id) {
    await drive.files.update({
      fileId: existing.data.files[0].id,
      media,
    });
  } else {
    await drive.files.create({
      requestBody: {
        name: ROLLING_SUMMARY_FILE,
        parents: ["appDataFolder"],
      },
      media,
      fields: "id",
    });
  }
}

/**
 * Format rolling summary for inclusion in prompt
 */
export function formatRollingSummaryForPrompt(
  summary: RollingSummary | null
): string {
  if (!summary) return "";

  let xml = `<rolling_summary title="Longitudinal Context" last_updated="${summary.lastUpdated}">\n`;

  if (summary.themes.length > 0) {
    xml += `<themes>\n${summary.themes.map((t) => `- ${t}`).join("\n")}\n</themes>\n`;
  }

  if (summary.activeGoals.length > 0) {
    xml += `<active_goals>\n${summary.activeGoals.map((g) => `- ${g}`).join("\n")}\n</active_goals>\n`;
  }

  if (summary.relationships.length > 0) {
    xml += `<key_relationships>\n${summary.relationships.map((r) => `- ${r}`).join("\n")}\n</key_relationships>\n`;
  }

  if (summary.openThreads.length > 0) {
    xml += `<open_threads>\n${summary.openThreads.map((t) => `- ${t}`).join("\n")}\n</open_threads>\n`;
  }

  if (summary.historicalHighlights) {
    xml += `<historical_context>\n${summary.historicalHighlights}\n</historical_context>\n`;
  }

  xml += `</rolling_summary>`;
  return xml;
}

/**
 * Delete all summaries (for testing/reset)
 */
export async function clearAllSummaries(accessToken: string): Promise<void> {
  const drive = getDriveClient(accessToken);

  // Find and delete summaries folder
  const folderResponse = await drive.files.list({
    spaces: "appDataFolder",
    q: `name='${SUMMARIES_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });

  if (folderResponse.data.files?.[0]?.id) {
    await drive.files.delete({ fileId: folderResponse.data.files[0].id });
  }

  // Find and delete rolling summary
  const rollingSummaryResponse = await drive.files.list({
    spaces: "appDataFolder",
    q: `name='${ROLLING_SUMMARY_FILE}' and trashed=false`,
    fields: "files(id)",
  });

  if (rollingSummaryResponse.data.files?.[0]?.id) {
    await drive.files.delete({ fileId: rollingSummaryResponse.data.files[0].id });
  }
}
