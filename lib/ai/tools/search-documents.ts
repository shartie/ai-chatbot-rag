import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import type { ChatMessage } from "@/lib/types";

const DOC_API_BASE_URL =
  process.env.DOC_API_BASE_URL || "https://api.example.com/docs";
const DOC_API_KEY = process.env.DOC_API_KEY;

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

type GetDocumentProps = {
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const getDocument = ({ dataStream }: GetDocumentProps) =>
  tool({
    description:
      "Retrieve a specific document by its ID from the documentation API. Use this after searching to get the full content of a document.",
    inputSchema: z.object({
      documentId: z
        .string()
        .describe("The unique identifier of the document to retrieve"),
    }),
    execute: async ({
      documentId,
    }): Promise<SearchResult & { error?: string }> => {
      try {
        // Write progress event
        dataStream.write({
          type: "data-documentLoading",
          data: {
            documentId,
            message: "Retrieving document...",
          },
          transient: true,
        });

        const headers: HeadersInit = {
          "Content-Type": "application/json",
        };

        if (DOC_API_KEY) {
          headers["Authorization"] = `Bearer ${DOC_API_KEY}`;
        }

        const response = await fetch(
          `${DOC_API_BASE_URL}/documents/${documentId}`,
          {
            method: "GET",
            headers,
          }
        );

        if (!response.ok) {
          dataStream.write({
            type: "data-documentError",
            data: {
              documentId,
              message: `Failed to retrieve document: ${response.status}`,
            },
            transient: true,
          });

          return {
            id: documentId,
            title: "",
            content: "",
            error: `Failed to retrieve document: ${response.status} ${response.statusText}`,
          };
        }

        const data = await response.json();

        // Write completion event
        dataStream.write({
          type: "data-documentLoaded",
          data: {
            documentId,
            title: String(data.title || data.name || "Untitled"),
          },
          transient: true,
        });

        return {
          id: String(data.id || data._id || documentId),
          title: String(data.title || data.name || "Untitled"),
          content: String(data.content || data.text || data.body || ""),
          url: data.url ? String(data.url) : undefined,
          metadata: data.metadata as Record<string, unknown> | undefined,
        };
      } catch (error) {
        dataStream.write({
          type: "data-documentError",
          data: {
            documentId,
            message:
              error instanceof Error ? error.message : "Unknown error occurred",
          },
          transient: true,
        });

        return {
          id: documentId,
          title: "",
          content: "",
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
