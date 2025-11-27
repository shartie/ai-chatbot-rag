import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import type { ChatMessage } from "@/lib/types";

const DOC_API_BASE_URL =
  process.env.DOC_API_BASE_URL || "https://api.example.com/docs";
const DOC_API_KEY = process.env.DOC_API_KEY;

// Enable mock mode when no API key is configured or explicitly set
const MOCK_MODE = process.env.DOC_SEARCH_MOCK === "true" || !DOC_API_KEY;

// Configuration constants
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer for SSE
const MIN_QUERY_LENGTH = 1;
const MAX_QUERY_LENGTH = 500;
const MAX_LIMIT = 50;

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
 * Custom error class for search-specific errors
 */
class SearchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "SearchError";
  }
}

/**
 * Helper to delay execution
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validate search input parameters
 */
function validateInput(query: string, limit: number): void {
  if (!query || typeof query !== "string") {
    throw new SearchError("Query is required", "INVALID_QUERY");
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery.length < MIN_QUERY_LENGTH) {
    throw new SearchError(
      `Query must be at least ${MIN_QUERY_LENGTH} character(s)`,
      "QUERY_TOO_SHORT"
    );
  }

  if (trimmedQuery.length > MAX_QUERY_LENGTH) {
    throw new SearchError(
      `Query must not exceed ${MAX_QUERY_LENGTH} characters`,
      "QUERY_TOO_LONG"
    );
  }

  if (typeof limit !== "number" || limit < 1) {
    throw new SearchError("Limit must be a positive number", "INVALID_LIMIT");
  }

  if (limit > MAX_LIMIT) {
    throw new SearchError(
      `Limit must not exceed ${MAX_LIMIT}`,
      "LIMIT_TOO_HIGH"
    );
  }
}

/**
 * Create an AbortController with timeout
 */
function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  timeoutId: NodeJS.Timeout;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new SearchError("Request timed out", "TIMEOUT", true));
  }, timeoutMs);

  return { controller, timeoutId };
}

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
      message: filter
        ? `Applying filter: ${filter}`
        : "Preparing search filters...",
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
      score: 0.7,
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
    throw new SearchError("No response body", "NO_RESPONSE_BODY");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Prevent unbounded buffer growth
      if (buffer.length > MAX_BUFFER_SIZE) {
        throw new SearchError(
          "Response too large",
          "RESPONSE_TOO_LARGE"
        );
      }

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("data: ")) {
          const data = trimmedLine.slice(6).trim();
          if (data === "[DONE]") {
            return;
          }
          try {
            const event = JSON.parse(data) as SearchStreamEvent;
            yield event;
          } catch {
            // Skip malformed JSON but log in development
            if (process.env.NODE_ENV === "development") {
              console.warn("[Doc Search] Skipping malformed SSE data:", data);
            }
          }
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim().startsWith("data: ")) {
      const data = buffer.trim().slice(6).trim();
      if (data && data !== "[DONE]") {
        try {
          const event = JSON.parse(data) as SearchStreamEvent;
          yield event;
        } catch {
          // Ignore malformed final chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error: unknown, statusCode?: number): boolean {
  // Network errors are retryable
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  // Specific status codes that are retryable
  if (statusCode) {
    return [408, 429, 500, 502, 503, 504].includes(statusCode);
  }

  // SearchError with retryable flag
  if (error instanceof SearchError) {
    return error.retryable;
  }

  return false;
}

/**
 * Fetch with streaming SSE support, falling back to regular JSON response
 */
async function fetchWithStreaming(
  url: string,
  headers: HeadersInit,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  signal: AbortSignal
): Promise<SearchResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...headers,
      Accept: "text/event-stream, application/json",
    },
    signal,
  });

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
    throw new SearchError(
      `Rate limited. Retry after ${Math.ceil(waitTime / 1000)} seconds`,
      "RATE_LIMITED",
      true
    );
  }

  if (!response.ok) {
    const isRetryable = isRetryableError(null, response.status);
    throw new SearchError(
      `API request failed: ${response.status} ${response.statusText}`,
      `HTTP_${response.status}`,
      isRetryable
    );
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
          throw new SearchError(event.message, "API_ERROR");
      }
    }

    if (finalResult) {
      return finalResult;
    }

    throw new SearchError("No results received from stream", "EMPTY_STREAM");
  }

  // Fallback: Handle regular JSON response (non-streaming API)
  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new SearchError(
      "Failed to parse API response",
      "PARSE_ERROR"
    );
  }

  // Normalize the response format
  const rawResults = data.results || data.documents || data.items || [];

  if (!Array.isArray(rawResults)) {
    throw new SearchError(
      "Invalid API response format",
      "INVALID_RESPONSE"
    );
  }

  const results: SearchResult[] = rawResults.map(
    (item: Record<string, unknown>) => ({
      id: String(item.id || item._id || ""),
      title: String(item.title || item.name || "Untitled"),
      content: String(
        item.content || item.text || item.body || item.snippet || ""
      ),
      url: item.url ? String(item.url) : undefined,
      score: typeof item.score === "number" ? item.score : undefined,
      metadata: item.metadata as Record<string, unknown> | undefined,
    })
  );

  const query = String(data.query || "");
  const totalResults =
    typeof data.total === "number"
      ? data.total
      : typeof data.totalResults === "number"
        ? data.totalResults
        : results.length;

  // Write completion event for JSON response (was missing!)
  dataStream.write({
    type: "data-searchComplete",
    data: {
      totalResults,
      query,
    },
    transient: true,
  });

  return {
    results,
    query,
    totalResults,
  };
}

/**
 * Execute fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  headers: HeadersInit,
  dataStream: UIMessageStreamWriter<ChatMessage>,
  maxRetries: number = MAX_RETRIES
): Promise<SearchResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { controller, timeoutId } = createTimeoutController(REQUEST_TIMEOUT_MS);

    try {
      const result = await fetchWithStreaming(url, headers, dataStream, controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));

      const isRetryable =
        error instanceof SearchError
          ? error.retryable
          : isRetryableError(error);

      // Don't retry if not retryable or on last attempt
      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }

      // Log retry attempt in development
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[Doc Search] Retry attempt ${attempt + 1}/${maxRetries} after error:`,
          lastError.message
        );
      }

      // Wait before retrying with exponential backoff
      const backoffDelay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await delay(backoffDelay);

      // Update progress to show retry
      dataStream.write({
        type: "data-searchProgress",
        data: {
          stage: "analyzing",
          message: `Retrying search (attempt ${attempt + 2}/${maxRetries + 1})...`,
          progress: 5,
        },
        transient: true,
      });
    }
  }

  throw lastError || new SearchError("Search failed after retries", "MAX_RETRIES");
}

export const searchDocuments = ({ dataStream }: SearchDocumentsProps) =>
  tool({
    description:
      "Search for documents and information from the external documentation API. Use this tool to find relevant documentation, articles, or knowledge base entries based on a search query.",
    inputSchema: z.object({
      query: z
        .string()
        .min(MIN_QUERY_LENGTH, `Query must be at least ${MIN_QUERY_LENGTH} character(s)`)
        .max(MAX_QUERY_LENGTH, `Query must not exceed ${MAX_QUERY_LENGTH} characters`)
        .describe("The search query to find relevant documents"),
      limit: z
        .number()
        .int()
        .min(1, "Limit must be at least 1")
        .max(MAX_LIMIT, `Limit must not exceed ${MAX_LIMIT}`)
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default: 5)"),
      filter: z
        .string()
        .max(200, "Filter must not exceed 200 characters")
        .optional()
        .describe(
          "Optional filter to narrow down results (e.g., category, tag)"
        ),
    }),
    execute: async ({ query, limit = 5, filter }): Promise<SearchResponse> => {
      const trimmedQuery = query.trim();

      try {
        // Validate input
        validateInput(trimmedQuery, limit);

        // Use mock mode for testing without API
        if (MOCK_MODE) {
          if (process.env.NODE_ENV === "development") {
            console.log("[Doc Search] Running in mock mode");
          }
          return await mockSearch(trimmedQuery, limit, filter, dataStream);
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
          q: trimmedQuery,
          limit: String(limit),
          stream: "true", // Request SSE streaming from the API
        });

        if (filter) {
          params.append("filter", filter.trim());
        }

        const headers: HeadersInit = {
          "Content-Type": "application/json",
        };

        if (DOC_API_KEY) {
          headers["Authorization"] = `Bearer ${DOC_API_KEY}`;
        }

        const result = await fetchWithRetry(
          `${DOC_API_BASE_URL}/search?${params}`,
          headers,
          dataStream
        );

        // Ensure query is set in result
        result.query = trimmedQuery;

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof SearchError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown error occurred";

        const errorCode =
          error instanceof SearchError ? error.code : "UNKNOWN_ERROR";

        // Write error event to stream
        dataStream.write({
          type: "data-searchError",
          data: {
            message: errorMessage,
          },
          transient: true,
        });

        // Log error in development
        if (process.env.NODE_ENV === "development") {
          console.error(`[Doc Search] Error (${errorCode}):`, errorMessage);
        }

        return {
          results: [],
          query: trimmedQuery,
          totalResults: 0,
          error: errorMessage,
        };
      }
    },
  });
