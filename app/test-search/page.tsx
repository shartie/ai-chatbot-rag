"use client";

import { useState } from "react";
import { SearchProgress } from "@/components/search-progress";
import type { SearchProgressData } from "@/lib/types";

export default function TestSearchPage() {
  const [query, setQuery] = useState("React hooks");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<SearchProgressData | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [response, setResponse] = useState("");

  const runTest = async () => {
    setIsRunning(true);
    setProgress(null);
    setIsComplete(false);
    setResponse("");

    try {
      const res = await fetch("/api/test-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);

              if (event.type === "data-searchProgress") {
                setProgress(event.data);
              } else if (event.type === "data-searchComplete") {
                setIsComplete(true);
                setProgress(null);
              } else if (event.type === "text-delta") {
                setResponse((prev) => prev + event.delta);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (error) {
      console.error("Test failed:", error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 font-bold text-2xl">Doc Chat Search Progress Test</h1>

      <div className="mb-6 flex gap-4">
        <input
          className="flex-1 rounded-lg border bg-background px-4 py-2"
          disabled={isRunning}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter search query..."
          type="text"
          value={query}
        />
        <button
          className="rounded-lg bg-primary px-6 py-2 text-primary-foreground disabled:opacity-50"
          disabled={isRunning}
          onClick={runTest}
          type="button"
        >
          {isRunning ? "Running..." : "Test Search"}
        </button>
      </div>

      {/* Search Progress Visualization */}
      {(progress || isComplete) && (
        <div className="mb-6">
          <SearchProgress isComplete={isComplete} progress={progress} />
        </div>
      )}

      {/* Response Text */}
      {response && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <h3 className="mb-2 font-medium text-sm text-muted-foreground">
            Agent Response:
          </h3>
          <div className="whitespace-pre-wrap text-sm">{response}</div>
        </div>
      )}

      {/* Instructions */}
      {!isRunning && !progress && !isComplete && !response && (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          <p>Click &quot;Test Search&quot; to see the search progress visualization</p>
          <p className="mt-2 text-sm">No OpenAI key required for this test</p>
        </div>
      )}
    </div>
  );
}
