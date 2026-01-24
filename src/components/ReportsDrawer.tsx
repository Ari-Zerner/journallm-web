"use client";

import { useState, useEffect, useCallback } from "react";

interface ReportMetadata {
  id: string;
  createdAt: string;
  title: string;
  preview: string;
}

interface ReportsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onViewReport: (reportId: string) => void;
}

export function ReportsDrawer({
  isOpen,
  onClose,
  onViewReport,
}: ReportsDrawerProps) {
  const [reports, setReports] = useState<ReportMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/drive/reports");
      if (!res.ok) throw new Error("Failed to fetch reports");
      const data = await res.json();
      setReports(data);
    } catch {
      setError("Failed to load reports");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchReports();
    }
  }, [isOpen, fetchReports]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this report?")) {
      return;
    }

    setDeletingId(id);
    try {
      const res = await fetch(`/api/drive/reports/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete report");
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      alert("Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (id: string, title: string) => {
    try {
      const res = await fetch(`/api/drive/reports/${id}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      const report = await res.json();

      const blob = new Blob([report.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download report");
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-neutral-900 shadow-xl">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700 px-6 py-4">
            <h2 className="text-lg font-medium">My Reports</h2>
            <button
              onClick={onClose}
              className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Privacy notice */}
          <div className="px-6 py-3 bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
            These reports are stored in your Google account and only accessible
            by you.
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="text-center text-neutral-500 py-8">
                Loading reports...
              </div>
            ) : error ? (
              <div className="text-center text-red-500 py-8">{error}</div>
            ) : reports.length === 0 ? (
              <div className="text-center text-neutral-500 py-8">
                No saved reports yet
              </div>
            ) : (
              <div className="space-y-4">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4"
                  >
                    <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {formatDate(report.createdAt)}
                    </div>
                    <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">
                      {report.preview}...
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={() => {
                          onViewReport(report.id);
                          onClose();
                        }}
                        className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDownload(report.id, report.title)}
                        className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => handleDelete(report.id)}
                        disabled={deletingId === report.id}
                        className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingId === report.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
