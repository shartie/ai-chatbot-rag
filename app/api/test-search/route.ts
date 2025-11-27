/**
 * Test endpoint for Doc Chat Agent search progress visualization
 * This endpoint simulates the agent stream with search progress events
 * No OpenAI key required - useful for testing the frontend
 *
 * Usage: POST /api/test-search with { query: "your search term" }
 */

import { createUIMessageStream, JsonToSseTransformStream } from "ai";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const { query = "documentation" } = await request.json();

  const stream = createUIMessageStream({
    execute: async ({ writer: dataStream }) => {
      // Simulate initial thinking
      await delay(500);

      // Step 1: Analyzing
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

      // Step 2: Filtering
      dataStream.write({
        type: "data-searchProgress",
        data: {
          stage: "filtering",
          message: "Preparing search filters...",
          progress: 30,
        },
        transient: true,
      });
      await delay(600);

      // Step 3: Searching
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

      // Step 4: Ranking
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

      // Complete
      dataStream.write({
        type: "data-searchComplete",
        data: {
          totalResults: 5,
          query,
        },
        transient: true,
      });

      // Simulate assistant message with results
      await delay(300);

      const messageId = `msg-${Date.now()}`;

      // Write a simulated assistant message using text-delta
      dataStream.write({
        type: "text-delta",
        delta: `I found 5 documents related to "${query}":\n\n`,
        id: messageId,
      });

      await delay(200);

      dataStream.write({
        type: "text-delta",
        delta: `1. **Getting Started with ${query}** (95% match)\n   A comprehensive guide to help you begin.\n\n`,
        id: messageId,
      });

      await delay(150);

      dataStream.write({
        type: "text-delta",
        delta: `2. **${query} API Reference** (88% match)\n   Complete API documentation with examples.\n\n`,
        id: messageId,
      });

      await delay(150);

      dataStream.write({
        type: "text-delta",
        delta: `3. **Advanced ${query} Patterns** (82% match)\n   Best practices and optimization techniques.\n\n`,
        id: messageId,
      });

      await delay(150);

      dataStream.write({
        type: "text-delta",
        delta: `4. **Troubleshooting ${query}** (75% match)\n   Common issues and their solutions.\n\n`,
        id: messageId,
      });

      await delay(150);

      dataStream.write({
        type: "text-delta",
        delta: `5. **${query} Examples** (70% match)\n   Real-world examples and tutorials.\n`,
        id: messageId,
      });
    },
  });

  return new Response(stream.pipeThrough(new JsonToSseTransformStream()), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
