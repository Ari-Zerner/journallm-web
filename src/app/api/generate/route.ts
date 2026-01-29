import { NextRequest, NextResponse } from "next/server";
import { getReport, ReportResult } from "@/lib/claude-prompter";
import { auth } from "@/lib/auth";

export const maxDuration = 300; // 5 minutes for Vercel Pro

export async function POST(request: NextRequest) {
  try {
    const { journal, apiKey: providedApiKey, formattedDate, customTopics, includeStandardReport } = await request.json();

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

    // Get access token for authenticated users (for summary caching)
    const session = await auth();
    const accessToken = session?.accessToken || null;

    // Generate report with hierarchical summarization
    const topics = Array.isArray(customTopics) ? customTopics : [];
    const includeStandard = includeStandardReport !== false;

    const result = await getReport({
      journalXml: journal,
      apiKey,
      formattedDate,
      customTopics: topics,
      includeStandardReport: includeStandard,
      accessToken,
    }) as ReportResult;

    return NextResponse.json({
      report: result.report,
      tierStats: result.tierStats,
    });
  } catch (error) {
    console.error("Error generating report:", error);

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
