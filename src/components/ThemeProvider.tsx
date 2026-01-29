"use client";

import { createContext, useContext, useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    // Return default values during SSR
    return {
      theme: "dark" as Theme,
      setTheme: () => {},
    };
  }
  return context;
}

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);
  const loadedFromServer = useRef(false);

  // Load saved theme on mount
  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved && ["light", "dark"].includes(saved)) {
      setThemeState(saved);
    } else {
      setThemeState(getSystemTheme());
    }
    setMounted(true);
  }, []);

  // Fetch theme from Redis when authenticated
  useEffect(() => {
    if (status === "authenticated" && !loadedFromServer.current) {
      loadedFromServer.current = true;
      fetch("/api/preferences")
        .then((res) => (res.ok ? res.json() : null))
        .then((prefs) => {
          if (prefs?.theme && ["light", "dark"].includes(prefs.theme)) {
            setThemeState(prefs.theme);
            localStorage.setItem("theme", prefs.theme);
          }
        })
        .catch(console.error);
    }
    // Reset when signed out
    if (status === "unauthenticated") {
      loadedFromServer.current = false;
    }
  }, [status]);

  // Apply theme to document
  useEffect(() => {
    if (!mounted) return;

    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("theme", newTheme);

    // Save to Redis if authenticated
    if (status === "authenticated") {
      fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: newTheme }),
      }).catch(console.error);
    }
  };

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
