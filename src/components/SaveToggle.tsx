"use client";

interface SaveToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function SaveToggle({ enabled, onChange }: SaveToggleProps) {
  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <label className="font-sans text-sm text-neutral-700 dark:text-neutral-300">
          Save to Drive
        </label>
        <button
          onClick={() => onChange(!enabled)}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors
            ${enabled ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"}
          `}
          role="switch"
          aria-checked={enabled}
        >
          <span
            className={`
              inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200
              ${enabled ? "translate-x-6" : "translate-x-1"}
            `}
          />
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        Stored privately in your Google Drive
      </p>
    </div>
  );
}
