import { google } from "googleapis";

const SETTINGS_FILE_NAME = "settings.json";

export interface UserSettings {
  version: 1;
  anthropicApiKey?: string;
}

function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export async function getSettings(
  accessToken: string
): Promise<UserSettings | null> {
  const drive = getDriveClient(accessToken);

  // Find settings file in appDataFolder
  const response = await drive.files.list({
    spaces: "appDataFolder",
    q: `name='${SETTINGS_FILE_NAME}'`,
    fields: "files(id)",
  });

  const file = response.data.files?.[0];
  if (!file?.id) {
    return null;
  }

  // Download file content
  const content = await drive.files.get({
    fileId: file.id,
    alt: "media",
  });

  return content.data as unknown as UserSettings;
}

export async function saveSettings(
  accessToken: string,
  settings: UserSettings
): Promise<void> {
  const drive = getDriveClient(accessToken);

  // Check if file exists
  const existing = await drive.files.list({
    spaces: "appDataFolder",
    q: `name='${SETTINGS_FILE_NAME}'`,
    fields: "files(id)",
  });

  const media = {
    mimeType: "application/json",
    body: JSON.stringify(settings),
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
        name: SETTINGS_FILE_NAME,
        parents: ["appDataFolder"],
      },
      media,
      fields: "id",
    });
  }
}
