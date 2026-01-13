"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { extractJournal } from "@/lib/journal-extractor.client";

type Status = "idle" | "extracting" | "processing" | "done" | "error";

const ACCEPTED_TYPES = ".zip,.json,.xml,.md,.txt";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(async () => {
    if (!file) {
      setError("Please select a file");
      return;
    }

    if (!apiKey.trim()) {
      setError("Please enter your API key");
      return;
    }

    setError(null);

    try {
      // Extract journal content client-side
      setStatus("extracting");
      const journalContent = await extractJournal(file);

      // Send extracted text to server
      setStatus("processing");
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journal: journalContent, apiKey }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setReport(data.report);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }, [file, apiKey]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setError(null);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        setFile(e.target.files[0]);
        setError(null);
      }
    },
    []
  );

  const handleDownload = useCallback(() => {
    if (!report) return;
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-insights-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [report]);

  // Auto-download report when ready
  useEffect(() => {
    if (status === "done" && report) {
      handleDownload();
    }
  }, [status, report, handleDownload]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setReport(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Report view
  if (status === "done" && report) {
    return (
      <div className="min-h-screen">
        <div className="max-w-2xl mx-auto px-6 py-16 md:py-24">
          <article className="prose-report">
            <ReactMarkdown>{report}</ReactMarkdown>
          </article>

          <footer className="mt-16 pt-8 border-t border-neutral-200 flex items-center justify-between font-sans text-sm text-neutral-500">
            <button
              onClick={handleReset}
              className="hover:text-neutral-800 transition-colors"
            >
              Start over
            </button>
            <button
              onClick={handleDownload}
              className="hover:text-neutral-800 transition-colors"
            >
              Save as file
            </button>
          </footer>
        </div>
      </div>
    );
  }

  const isReady = file && apiKey.trim();
  const isWorking = status === "extracting" || status === "processing";

  // Upload view
  return (
    <div
      className={`min-h-screen flex items-center justify-center px-6 transition-colors ${
        dragOver ? "bg-neutral-50" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-md w-full py-16">
        <header className="mb-16 text-center">
          <h1 className="text-3xl mb-4">JournalLM</h1>
          <p className="text-neutral-500">
            Upload your journal and receive thoughtful insights.
          </p>
        </header>

        <div className="space-y-8">
          {/* API Key */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-sans text-sm text-neutral-500">
                Anthropic API key
              </label>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="font-sans text-sm text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                Get one
              </a>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              disabled={isWorking}
              className="w-full px-0 py-2 bg-transparent border-0 border-b border-neutral-200 focus:border-neutral-400 focus:ring-0 outline-none transition-colors placeholder:text-neutral-300"
            />
          </div>

          {/* File selection */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileSelect}
              className="hidden"
              disabled={isWorking}
            />

            {isWorking ? (
              <div className="py-8 text-center">
                <p className="text-neutral-500 mb-2">
                  {status === "extracting"
                    ? "Reading journal..."
                    : "Generating insights..."}
                </p>
                <p className="text-sm text-neutral-400">
                  {status === "extracting"
                    ? "Extracting entries from your export"
                    : "This takes a minute or two"}
                </p>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`
                  w-full py-4 border border-dashed rounded transition-colors text-center
                  border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50
                  ${dragOver ? "border-neutral-400 bg-neutral-50" : ""}
                `}
              >
                {dragOver
                  ? "Drop file"
                  : file
                    ? file.name
                    : "Select or drop journal file"}
              </button>
            )}
          </div>

          {/* Submit button */}
          {!isWorking && (
            <button
              onClick={handleSubmit}
              disabled={!isReady}
              className={`
                w-full py-3 rounded font-sans text-sm transition-colors
                ${
                  isReady
                    ? "bg-neutral-800 text-white hover:bg-neutral-700"
                    : "bg-neutral-100 text-neutral-400 cursor-not-allowed"
                }
              `}
            >
              Generate insights
            </button>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}
        </div>

        <footer className="mt-16 text-center">
          <p className="text-sm text-neutral-400">
            Accepts Day One exports (.zip, .json) or plain text (.xml, .md,
            .txt)
          </p>
        </footer>
      </div>
    </div>
  );
}
