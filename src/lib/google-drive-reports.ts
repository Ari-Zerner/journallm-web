import { google } from "googleapis";

export interface SavedReport {
  id: string;
  createdAt: string;
  title: string;
  content: string;
}

export interface ReportMetadata {
  id: string;
  createdAt: string;
  title: string;
  preview: string;
}

function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

/**
 * List all saved reports (metadata only, sorted by date descending)
 */
export async function listReports(
  accessToken: string
): Promise<ReportMetadata[]> {
  const drive = getDriveClient(accessToken);

  // Find all report files in appDataFolder
  const response = await drive.files.list({
    spaces: "appDataFolder",
    q: "name contains 'report-' and name contains '.json'",
    fields: "files(id, name)",
    orderBy: "name desc",
  });

  const files = response.data.files || [];
  const reports: ReportMetadata[] = [];

  // Fetch content of each file to get metadata
  for (const file of files) {
    if (!file.id) continue;

    try {
      const content = await drive.files.get({
        fileId: file.id,
        alt: "media",
      });

      const report = content.data as unknown as SavedReport;
      reports.push({
        id: report.id,
        createdAt: report.createdAt,
        title: report.title,
        preview: report.content.slice(0, 150).replace(/[#*_]/g, "").trim(),
      });
    } catch {
      // Skip files that can't be read
      continue;
    }
  }

  return reports;
}

/**
 * Get a specific report by ID
 */
export async function getReport(
  accessToken: string,
  id: string
): Promise<SavedReport | null> {
  const drive = getDriveClient(accessToken);

  // Find the report file
  const response = await drive.files.list({
    spaces: "appDataFolder",
    q: `name = 'report-${id}.json'`,
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

  return content.data as unknown as SavedReport;
}

/**
 * Save a new report
 */
export async function saveReport(
  accessToken: string,
  report: SavedReport
): Promise<void> {
  const drive = getDriveClient(accessToken);

  const fileName = `report-${report.id}.json`;

  await drive.files.create({
    requestBody: {
      name: fileName,
      parents: ["appDataFolder"],
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(report),
    },
    fields: "id",
  });
}

/**
 * Delete a report by ID
 */
export async function deleteReport(
  accessToken: string,
  id: string
): Promise<boolean> {
  const drive = getDriveClient(accessToken);

  // Find the report file
  const response = await drive.files.list({
    spaces: "appDataFolder",
    q: `name = 'report-${id}.json'`,
    fields: "files(id)",
  });

  const file = response.data.files?.[0];
  if (!file?.id) {
    return false;
  }

  await drive.files.delete({
    fileId: file.id,
  });

  return true;
}
