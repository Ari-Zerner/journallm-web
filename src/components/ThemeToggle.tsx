"use client";

import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const cycleTheme = () => {
    if (theme === "system") {
      setTheme("light");
    } else if (theme === "light") {
      setTheme("dark");
    } else {
      setTheme("system");
    }
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <span className="text-sm text-neutral-500 dark:text-neutral-400">
        Auto
      </span>
    );
  }

  return (
    <button
      onClick={cycleTheme}
      className="text-sm text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
      title={`Theme: ${theme}`}
    >
      {theme === "system" && "Auto"}
      {theme === "light" && "Light"}
      {theme === "dark" && "Dark"}
    </button>
  );
}
