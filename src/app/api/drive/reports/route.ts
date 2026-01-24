import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listReports, saveReport, SavedReport } from "@/lib/google-drive-reports";

export async function GET() {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const reports = await listReports(session.accessToken);
    return NextResponse.json(reports);
  } catch (error) {
    console.error("Error listing reports from Drive:", error);
    return NextResponse.json(
      { error: "Failed to list reports" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const report: SavedReport = {
      id: body.id,
      createdAt: body.createdAt,
      title: body.title,
      content: body.content,
    };

    await saveReport(session.accessToken, report);
    return NextResponse.json({ success: true, id: report.id });
  } catch (error) {
    console.error("Error saving report to Drive:", error);
    return NextResponse.json(
      { error: "Failed to save report" },
      { status: 500 }
    );
  }
}
