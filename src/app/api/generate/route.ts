import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/claude-prompter";

export const maxDuration = 300; // 5 minutes for Vercel Pro

export async function POST(request: NextRequest) {
  try {
    const { journal, apiKey: providedApiKey, formattedDate, customTopics } = await request.json();

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

    // Generate report
    const topics = Array.isArray(customTopics) ? customTopics : [];
    const report = await getReport(journal, apiKey, formattedDate, topics);

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Error generating report:", error);

    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
