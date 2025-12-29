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
function convertDayOneToXml(journals: JournalMap): string {
  const allEntries: DayOneEntry[] = [];

  for (const [journalName, journalData] of Object.entries(journals)) {
    const entries = journalData.entries || [];
    for (const entry of entries) {
      entry._journalName = journalName;
      allEntries.push(entry);
    }
  }

  allEntries.sort((a, b) => {
    const dateA = a.creationDate || "";
    const dateB = b.creationDate || "";
    return dateA.localeCompare(dateB);
  });

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
 * Extract journals from a ZIP file (browser)
 */
async function extractFromZip(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const files = Object.keys(zip.files);

  if (files.length > 10000) {
    throw new Error("ZIP file contains too many files");
  }

  const jsonFiles = files.filter(
    (name) => name.endsWith(".json") && !zip.files[name].dir
  );

  if (jsonFiles.length === 0) {
    throw new Error("No JSON files found in the archive");
  }

  const journals: JournalMap = {};

  for (const jsonFile of jsonFiles) {
    try {
      const content = await zip.files[jsonFile].async("string");
      const journalData = JSON.parse(content) as DayOneJournal;

      if (typeof journalData !== "object" || !Array.isArray(journalData.entries)) {
        continue;
      }

      const journalName = jsonFile.split("/").pop()?.replace(".json", "") || "Journal";
      journals[journalName] = journalData;
    } catch {
      continue;
    }
  }

  if (Object.keys(journals).length === 0) {
    throw new Error("No valid journal data found");
  }

  return convertDayOneToXml(journals);
}

/**
 * Extract journal from a JSON file (browser)
 */
async function extractFromJson(file: File): Promise<string> {
  const content = await file.text();
  const journalData = JSON.parse(content) as DayOneJournal;

  if (typeof journalData !== "object" || !Array.isArray(journalData.entries)) {
    throw new Error("Invalid Day One JSON format");
  }

  const journalName = file.name.replace(/\.json$/i, "") || "Journal";
  return convertDayOneToXml({ [journalName]: journalData });
}

/**
 * Extract journal from a plain text file (browser)
 */
async function extractFromText(file: File): Promise<string> {
  const content = await file.text();

  if (content.includes("<journal") || content.includes("<entry")) {
    return content;
  }

  return `<journal>\n${content}\n</journal>`;
}

/**
 * Extract journal content from a file (browser)
 * Returns XML string ready to send to the server
 */
export async function extractJournal(file: File): Promise<string> {
  const extension = file.name.toLowerCase().split(".").pop();

  switch (extension) {
    case "zip":
      return extractFromZip(file);
    case "json":
      return extractFromJson(file);
    case "xml":
    case "md":
    case "txt":
    default:
      return extractFromText(file);
  }
}
