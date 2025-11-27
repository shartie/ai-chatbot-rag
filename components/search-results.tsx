"use client";

import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import type { SearchResponse, SearchResult } from "@/lib/ai/tools/search-documents";
import { cn } from "@/lib/utils";

type SearchResultsProps = {
  results: SearchResponse;
};

function SearchResultItem({ result }: { result: SearchResult }) {
  return (
    <div className="rounded-md border bg-background p-3 transition-colors hover:bg-muted/50">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <h4 className="line-clamp-1 font-medium text-sm">{result.title}</h4>
        </div>
        {result.score !== undefined && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
            {Math.round(result.score * 100)}%
          </span>
        )}
      </div>
      <p className="mb-2 line-clamp-2 text-muted-foreground text-xs">
        {result.content}
      </p>
      {result.url && (
        <a
          className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
          href={result.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          View document
          <ExternalLinkIcon className="size-3" />
        </a>
      )}
    </div>
  );
}

export function SearchResults({ results }: SearchResultsProps) {
  if (results.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/50">
        <p className="text-red-600 text-sm dark:text-red-400">
          Search error: {results.error}
        </p>
      </div>
    );
  }

  if (results.results.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-muted-foreground text-sm">
          No documents found for &quot;{results.query}&quot;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          Found {results.totalResults} result{results.totalResults !== 1 ? "s" : ""} for &quot;{results.query}&quot;
        </span>
      </div>
      <div className="grid gap-2">
        {results.results.map((result) => (
          <SearchResultItem key={result.id} result={result} />
        ))}
      </div>
    </div>
  );
}
