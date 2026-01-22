"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="w-8 h-8 rounded-full bg-neutral-100 animate-pulse" />
    );
  }

  if (session?.user) {
    return (
      <button
        onClick={() => signOut()}
        className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
      >
        {session.user.image && (
          <img
            src={session.user.image}
            alt=""
            className="w-6 h-6 rounded-full"
          />
        )}
        <span>Sign out</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => signIn("google")}
      className="text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
    >
      Sign in with Google
    </button>
  );
}
