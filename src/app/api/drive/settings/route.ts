import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSettings, saveSettings, UserSettings } from "@/lib/google-drive";

export async function GET() {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const settings = await getSettings(session.accessToken);
    return NextResponse.json(settings || { version: 1 });
  } catch (error) {
    console.error("Error fetching settings from Drive:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const settings: UserSettings = {
      version: 1,
      anthropicApiKey: body.anthropicApiKey,
    };

    await saveSettings(session.accessToken, settings);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving settings to Drive:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
