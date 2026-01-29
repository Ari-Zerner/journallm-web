import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import { Redis } from "@upstash/redis";

// Initialize Redis client (only if credentials are available)
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

function getRefreshTokenKey(email: string): string {
  return `refresh_token:${email}`;
}

async function storeRefreshToken(
  email: string,
  refreshToken: string
): Promise<void> {
  if (!redis) return;
  try {
    // Store with no expiration - refresh tokens are long-lived
    await redis.set(getRefreshTokenKey(email), refreshToken);
  } catch (error) {
    console.error("Failed to store refresh token:", error);
  }
}

async function getStoredRefreshToken(email: string): Promise<string | null> {
  if (!redis) return null;
  try {
    return await redis.get<string>(getRefreshTokenKey(email));
  } catch (error) {
    console.error("Failed to retrieve refresh token:", error);
    return null;
  }
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshed = await response.json();

    if (!response.ok) {
      throw refreshed;
    }

    // If Google returns a new refresh token, store it
    if (refreshed.refresh_token && token.email) {
      await storeRefreshToken(token.email as string, refreshed.refresh_token);
    }

    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: Math.floor(Date.now() / 1000 + refreshed.expires_in),
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("Error refreshing access token", error);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/drive.appdata",
          access_type: "offline",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Initial sign in
      if (account) {
        token.accessToken = account.access_token;
        token.expiresAt = account.expires_at;
        token.email = profile?.email;

        // If Google returned a refresh token, store it
        if (account.refresh_token && profile?.email) {
          token.refreshToken = account.refresh_token;
          await storeRefreshToken(profile.email, account.refresh_token);
        } else if (profile?.email) {
          // No refresh token from Google - try to retrieve stored one
          const storedToken = await getStoredRefreshToken(profile.email);
          if (storedToken) {
            token.refreshToken = storedToken;
          }
        }
      }

      // Return token if not expired
      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token;
      }

      // Token expired, refresh it
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error as string | undefined;
      return session;
    },
  },
});
