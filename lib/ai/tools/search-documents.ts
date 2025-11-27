import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import type { ChatMessage } from "@/lib/types";

const DOC_API_BASE_URL =
  process.env.DOC_API_BASE_URL || "https://api.example.com/docs";
const DOC_API_KEY = process.env.DOC_API_KEY;

// Enable mock mode when no API key is configured or explicitly set
const MOCK_MODE = process.env.DOC_SEARCH_MOCK === "true" || !DOC_API_KEY;

export type SearchResult = {
  id: string;
  title: string;
  content: string;
  url?: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type SearchResponse = {
  results: SearchResult[];
  query: string;
  totalResults: number;
  error?: string;
};

// Progress event types from the REST API SSE stream
export type SearchProgressEvent = {
  type: "progress";
  stage: "analyzing" | "filtering" | "searching" | "ranking" | "complete";
  message: string;
  progress?: number; // 0-100
};

export type SearchResultEvent = {
  type: "result";
  data: SearchResponse;
};

export type SearchErrorEvent = {
  type: "error";
  message: string;
};

export type SearchStreamEvent =
  | SearchProgressEvent
  | SearchResultEvent
  | SearchErrorEvent;

type SearchDocumentsProps = {
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

/**
 * Helper to delay execution
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock search function for testing without API
 */
async function mockSearch(
  query: string,
  limit: number,
  filter: string | undefined,
  dataStream: UIMessageStreamWriter<ChatMessage>
): Promise<SearchResponse> {
  // Simulate analyzing stage
  dataStream.write({
    type: "data-searchProgress",
    data: {
      stage: "analyzing",
      message: "Analyzing search query...",
      progress: 10,
    },
    transient: true,
  });
  await delay(800);

  // Simulate filtering stage
  dataStream.write({
    type: "data-searchProgress",
    data: {
      stage: "filtering",
      message: filter ? `Applying filter: ${filter}` : "Preparing search filters...",
      progress: 30,
    },
    transient: true,
  });
  await delay(600);

  // Simulate searching stage
  dataStream.write({
    type: "data-searchProgress",
    data: {
      stage: "searching",
      message: "Searching documentation database...",
      progress: 50,
    },
    transient: true,
  });
  await delay(1000);

  // Simulate ranking stage
  dataStream.write({
    type: "data-searchProgress",
    data: {
      stage: "ranking",
      message: "Ranking results by relevance...",
      progress: 80,
    },
    transient: true,
  });
  await delay(500);

  // Generate mock results based on query
  const mockResults: SearchResult[] = [
    {
      id: "doc-1",
      title: `Getting Started with ${query}`,
      content: `This guide covers the basics of ${query}. Learn how to set up your environment and get started quickly with step-by-step instructions.`,
      url: "https://docs.example.com/getting-started",
      score: 0.95,
    },
    {
      id: "doc-2",
      title: `${query} API Reference`,
      content: `Complete API documentation for ${query}. Includes all available methods, parameters, and response formats with examples.`,
      url: "https://docs.example.com/api-reference",
      score: 0.88,
    },
    {
      id: "doc-3",
      title: `Advanced ${query} Patterns`,
      content: `Explore advanced patterns and best practices for ${query}. Learn optimization techniques and common pitfalls to avoid.`,
      url: "https://docs.example.com/advanced",
      score: 0.82,
    },
    {
      id: "doc-4",
      title: `Troubleshooting ${query}`,
      content: `Common issues and solutions when working with ${query}. Debug errors and resolve configuration problems effectively.`,
      url: "https://docs.example.com/troubleshooting",
      score: 0.75,
    },
    {
      id: "doc-5",
      title: `${query} Examples and Tutorials`,
      content: `Hands-on tutorials and real-world examples demonstrating ${query} in action. Build practical applications step by step.`,
      url: "https://docs.example.com/tutorials",
      score: 0.70,
    },
  ].slice(0, limit);

  // Write completion event
  dataStream.write({
    type: "data-searchComplete",
    data: {
      totalResults: mockResults.length,
      query,
    },
    transient: true,
  });

  return {
    results: mockResults,
    query,
    totalResults: mockResults.length,
  };
}

/**
 * Parse SSE stream from the REST API and yield events
 */
async function* parseSSEStream(
  response: Response
): AsyncGenerator<SearchStreamEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            return;
          }
          try {
            const event = JSON.parse(data) as SearchStreamEvent;
            yield event;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Fetch with streaming SSE support, falling back to regular JSON response
 */
async function fetchWithStreaming(
  url: string,
  headers: HeadersInit,
  dataStream: UIMessageStreamWriter<ChatMessage>
): Promise<SearchResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...headers,
      Accept: "text/event-stream, application/json",
    },
  });

  if (!response.ok) {
    return {
      results: [],
      query: "",
      totalResults: 0,
      error: `API request failed with status ${response.status}: ${response.statusText}`,
    };
  }

  const contentType = response.headers.get("content-type") || "";

  // Handle SSE streaming response
  if (contentType.includes("text/event-stream")) {
    let finalResult: SearchResponse | null = null;

    for await (const event of parseSSEStream(response)) {
      switch (event.type) {
        case "progress":
          // Write progress events to the dataStream for UI visualization
          dataStream.write({
            type: "data-searchProgress",
            data: {
              stage: event.stage,
              message: event.message,
              progress: event.progress,
            },
            transient: true,
          });
          break;

        case "result":
          finalResult = event.data;
          // Write completion event
          dataStream.write({
            type: "data-searchComplete",
            data: {
              totalResults: event.data.totalResults,
              query: event.data.query,
            },
            transient: true,
          });
          break;

        case "error":
          dataStream.write({
            type: "data-searchError",
            data: { message: event.message },
            transient: true,
          });
          return {
            results: [],
            query: "",
            totalResults: 0,
            error: event.message,
          };
      }
    }

    if (finalResult) {
      return finalResult;
    }

    return {
      results: [],
      query: "",
      totalResults: 0,
      error: "No results received from stream",
    };
  }

  // Fallback: Handle regular JSON response (non-streaming API)
  const data = await response.json();

  // Normalize the response format
  const results: SearchResult[] = (
    data.results ||
    data.documents ||
    data.items ||
    []
  ).map((item: Record<string, unknown>) => ({
    id: String(item.id || item._id || ""),
    title: String(item.title || item.name || "Untitled"),
    content: String(
      item.content || item.text || item.body || item.snippet || ""
    ),
    url: item.url ? String(item.url) : undefined,
    score: typeof item.score === "number" ? item.score : undefined,
    metadata: item.metadata as Record<string, unknown> | undefined,
  }));

  return {
    results,
    query: data.query || "",
    totalResults: data.total || data.totalResults || results.length,
  };
}

export const searchDocuments = ({ dataStream }: SearchDocumentsProps) =>
  tool({
    description:
      "Search for documents and information from the external documentation API. Use this tool to find relevant documentation, articles, or knowledge base entries based on a search query.",
    inputSchema: z.object({
      query: z.string().describe("The search query to find relevant documents"),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default: 5)"),
      filter: z
        .string()
        .optional()
        .describe(
          "Optional filter to narrow down results (e.g., category, tag)"
        ),
    }),
    execute: async ({ query, limit = 5, filter }): Promise<SearchResponse> => {
      try {
        // Use mock mode for testing without API
        if (MOCK_MODE) {
          console.log("[Doc Search] Running in mock mode");
          return await mockSearch(query, limit, filter, dataStream);
        }

        // Write initial progress event
        dataStream.write({
          type: "data-searchProgress",
          data: {
            stage: "analyzing",
            message: "Analyzing search query...",
            progress: 0,
          },
          transient: true,
        });

        const params = new URLSearchParams({
          q: query,
          limit: String(limit),
          stream: "true", // Request SSE streaming from the API
        });

        if (filter) {
          params.append("filter", filter);
        }

        const headers: HeadersInit = {
          "Content-Type": "application/json",
        };

        if (DOC_API_KEY) {
          headers["Authorization"] = `Bearer ${DOC_API_KEY}`;
        }

        const result = await fetchWithStreaming(
          `${DOC_API_BASE_URL}/search?${params}`,
          headers,
          dataStream
        );

        // Ensure query is set in result
        result.query = query;

        return result;
      } catch (error) {
        dataStream.write({
          type: "data-searchError",
          data: {
            message:
              error instanceof Error ? error.message : "Unknown error occurred",
          },
          transient: true,
        });

        return {
          results: [],
          query,
          totalResults: 0,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });

