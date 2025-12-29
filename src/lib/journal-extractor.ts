import JSZip from "jszip";

interface DayOneEntry {
  creationDate?: string;
  modifiedDate?: string;
  text?: string;
  location?: {
    address?: string;
  };
  _journalName?: string;
}

interface DayOneJournal {
  entries?: DayOneEntry[];
}

type JournalMap = Record<string, DayOneJournal>;

/**
 * Extract journal entries from a Day One backup ZIP file
 */
export async function extractDayOneJournalsFromZip(
  buffer: Buffer
): Promise<JournalMap> {
  const journals: JournalMap = {};

  try {
    const zip = await JSZip.loadAsync(buffer);

    // Safety check: limit total files
    const files = Object.keys(zip.files);
    if (files.length > 10000) {
      throw new Error(`ZIP file contains too many files (${files.length})`);
    }

    // Find all JSON files
    const jsonFiles = files.filter(
      (name) => name.endsWith(".json") && !zip.files[name].dir
    );

    if (jsonFiles.length === 0) {
      throw new Error("No JSON files found in the backup");
    }

    // Parse each JSON file
    for (const jsonFile of jsonFiles) {
      try {
        const content = await zip.files[jsonFile].async("string");
        const journalData = JSON.parse(content) as DayOneJournal;

        // Validate journal data structure
        if (
          typeof journalData !== "object" ||
          !Array.isArray(journalData.entries)
        ) {
          console.warn(`Invalid journal format in ${jsonFile}, skipping`);
          continue;
        }

        // Get journal name from filename (without extension and path)
        const journalName = jsonFile.split("/").pop()?.replace(".json", "") || "Journal";
        journals[journalName] = journalData;
      } catch (e) {
        console.warn(`Error parsing ${jsonFile}:`, e);
        continue;
      }
    }

    return journals;
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(`Error extracting journals from ZIP: ${e}`);
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convert Day One journal data to XML format
 */
export function convertDayOneToXml(journals: JournalMap): string {
  // Collect all entries from all journals
  const allEntries: DayOneEntry[] = [];

  for (const [journalName, journalData] of Object.entries(journals)) {
    const entries = journalData.entries || [];
    for (const entry of entries) {
      entry._journalName = journalName;
      allEntries.push(entry);
    }
  }

  // Sort all entries by creation date
  allEntries.sort((a, b) => {
    const dateA = a.creationDate || "";
    const dateB = b.creationDate || "";
    return dateA.localeCompare(dateB);
  });

  // Build XML
  const hasMultipleJournals = Object.keys(journals).length > 1;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<journal_entries>\n';

  for (const entry of allEntries) {
    xml += "  <entry>\n";
    xml += `    <created>${escapeXml(entry.creationDate || "")}</created>\n`;
    xml += `    <modified>${escapeXml(entry.modifiedDate || "")}</modified>\n`;

    if (hasMultipleJournals && entry._journalName) {
      xml += `    <journal>${escapeXml(entry._journalName)}</journal>\n`;
    }

    if (entry.location?.address) {
      xml += `    <loc>${escapeXml(entry.location.address)}</loc>\n`;
    }

    xml += `    <text>${escapeXml(entry.text || "")}</text>\n`;
    xml += "  </entry>\n";
  }

  xml += "</journal_entries>";

  return xml;
}

/**
 * Extract journal from a ZIP buffer and convert to XML
 */
export async function extractJournalFromZip(buffer: Buffer): Promise<string> {
  const journals = await extractDayOneJournalsFromZip(buffer);

  if (Object.keys(journals).length === 0) {
    throw new Error("No journal data extracted from file");
  }

  return convertDayOneToXml(journals);
}

/**
 * Parse a Day One JSON file directly
 */
export function extractJournalFromJson(content: string, filename: string): string {
  const journalData = JSON.parse(content) as DayOneJournal;

  if (typeof journalData !== "object" || !Array.isArray(journalData.entries)) {
    throw new Error("Invalid Day One JSON format: missing entries array");
  }

  const journalName = filename.replace(/\.json$/i, "") || "Journal";
  const journals: JournalMap = { [journalName]: journalData };

  return convertDayOneToXml(journals);
}

/**
 * Wrap plain text content for Claude
 */
export function wrapPlainTextJournal(content: string): string {
  return `<journal>\n${content}\n</journal>`;
}

/**
 * Extract journal from a file based on its type
 */
export async function extractJournal(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const extension = filename.toLowerCase().split(".").pop();

  switch (extension) {
    case "zip":
      return extractJournalFromZip(buffer);

    case "json": {
      const content = buffer.toString("utf-8");
      return extractJournalFromJson(content, filename);
    }

    case "xml":
    case "md":
    case "txt":
    default: {
      const content = buffer.toString("utf-8");
      // If it looks like XML with journal entries, use as-is
      if (content.includes("<journal") || content.includes("<entry")) {
        return content;
      }
      return wrapPlainTextJournal(content);
    }
  }
}
