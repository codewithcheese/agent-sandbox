import { tool } from "ai";
import { z } from "zod";
import { usePlugin } from "$lib/utils";
import cursorMap from "$lib/utils/cursor-map.ts";

export const redditSearchTool = tool({
  description: "Search Reddit posts on a specific topic using RapidAPI",
  parameters: z.object({
    query: z.string().describe("The search query for Reddit posts"),
    sort: z
      .enum(["RELEVANCE", "HOT", "TOP", "NEW", "COMMENTS"])
      .default("RELEVANCE")
      .describe("Sort method for the results"),
    time: z
      .enum(["hour", "day", "week", "month", "year", "all"])
      .default("all")
      .describe("Time range for the results"),
    nsfw: z
      .enum(["0", "1"])
      .default("0")
      .describe("Whether to include NSFW content (0 for no, 1 for yes)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of results to return"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor for fetching the next page of results"),
  }),
  execute: async ({ query, sort, time, nsfw, limit, cursor }) => {
    try {
      const plugin = usePlugin();

      // Check if API key is available
      if (!plugin.settings.RAPIDAPI_KEY) {
        return { error: "RapidAPI key is not configured in settings" };
      }

      // Construct the URL with query parameters
      let url = `https://reddit-scraper2.p.rapidapi.com/search_posts_v3?query=${encodeURIComponent(query)}&sort=${sort}&time=${time}&nsfw=${nsfw}&limit=${limit}`;

      // Add cursor parameter if provided for pagination
      if (cursor) {
        try {
          // Get the full cursor value from the ID
          const fullCursor = cursorMap.get(cursor);
          url += `&cursor=${encodeURIComponent(fullCursor)}`;
        } catch (error) {
          return { error: `Invalid cursor ID: ${cursor}` };
        }
      }

      // Set up request options
      const options = {
        method: "GET",
        headers: {
          "x-rapidapi-key": plugin.settings.RAPIDAPI_KEY,
          "x-rapidapi-host": "reddit-scraper2.p.rapidapi.com",
        },
      };

      // Make the request
      const response = await fetch(url, options);

      // Check if response is successful
      if (!response.ok) {
        const errorText = await response.text();
        return {
          error: `API request failed with status ${response.status}: ${errorText}`,
        };
      }

      // Parse the results
      const result = await response.json();

      // Add pagination cursor to the result
      if (result.pageInfo?.hasNextPage) {
        result.pageInfo.endCursor = cursorMap.store(result.pageInfo.endCursor);
      }

      // Return the API response directly
      return result;
    } catch (error) {
      return { error: `Failed to search Reddit: ${error.message}` };
    }
  },
});
