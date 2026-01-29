import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

function getPreferencesKey(email: string): string {
  return `preferences:${email}`;
}

interface Preferences {
  theme?: "light" | "dark";
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!redis) {
    return NextResponse.json({ error: "Redis not configured" }, { status: 503 });
  }

  try {
    const preferences = await redis.get<Preferences>(getPreferencesKey(session.user.email));
    return NextResponse.json(preferences || {});
  } catch (error) {
    console.error("Error fetching preferences:", error);
    return NextResponse.json({ error: "Failed to fetch preferences" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!redis) {
    return NextResponse.json({ error: "Redis not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const key = getPreferencesKey(session.user.email);

    // Get existing preferences and merge
    const existing = await redis.get<Preferences>(key) || {};
    const updated = { ...existing, ...body };

    await redis.set(key, updated);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving preferences:", error);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }
}
