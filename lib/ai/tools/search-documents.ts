import { tool } from "ai";
import { z } from "zod";

const DOC_API_BASE_URL = process.env.DOC_API_BASE_URL || "https://api.example.com/docs";
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

export const searchDocuments = tool({
  description:
    "Search for documents and information from the external documentation API. Use this tool to find relevant documentation, articles, or knowledge base entries based on a search query.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The search query to find relevant documents"),
    limit: z
      .number()
      .optional()
      .default(5)
      .describe("Maximum number of results to return (default: 5)"),
    filter: z
      .string()
      .optional()
      .describe("Optional filter to narrow down results (e.g., category, tag)"),
  }),
  execute: async ({ query, limit = 5, filter }): Promise<SearchResponse> => {
    try {
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
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

      const response = await fetch(`${DOC_API_BASE_URL}/search?${params}`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        return {
          results: [],
          query,
          totalResults: 0,
          error: `API request failed with status ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();

      // Normalize the response format
      const results: SearchResult[] = (data.results || data.documents || data.items || []).map(
        (item: Record<string, unknown>) => ({
          id: String(item.id || item._id || ""),
          title: String(item.title || item.name || "Untitled"),
          content: String(item.content || item.text || item.body || item.snippet || ""),
          url: item.url ? String(item.url) : undefined,
          score: typeof item.score === "number" ? item.score : undefined,
          metadata: item.metadata as Record<string, unknown> | undefined,
        })
      );

      return {
        results,
        query,
        totalResults: data.total || data.totalResults || results.length,
      };
    } catch (error) {
      return {
        results: [],
        query,
        totalResults: 0,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});

export const getDocument = tool({
  description:
    "Retrieve a specific document by its ID from the documentation API. Use this after searching to get the full content of a document.",
  inputSchema: z.object({
    documentId: z.string().describe("The unique identifier of the document to retrieve"),
  }),
  execute: async ({ documentId }): Promise<SearchResult & { error?: string }> => {
    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };

      if (DOC_API_KEY) {
        headers["Authorization"] = `Bearer ${DOC_API_KEY}`;
      }

      const response = await fetch(`${DOC_API_BASE_URL}/documents/${documentId}`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        return {
          id: documentId,
          title: "",
          content: "",
          error: `Failed to retrieve document: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();

      return {
        id: String(data.id || data._id || documentId),
        title: String(data.title || data.name || "Untitled"),
        content: String(data.content || data.text || data.body || ""),
        url: data.url ? String(data.url) : undefined,
        metadata: data.metadata as Record<string, unknown> | undefined,
      };
    } catch (error) {
      return {
        id: documentId,
        title: "",
        content: "",
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});
