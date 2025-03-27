import { tool } from "ai";
import { z } from "zod";
import { usePlugin } from "$lib/utils";
import cursorMap from "$lib/utils/cursor-map.ts";

export const redditGetPostCommentsTool = tool({
  description: "Get comments for a specific Reddit post using RapidAPI",
  parameters: z.object({
    post_id: z.string().describe("The Reddit post ID (e.g., 't3_1furwc7')"),
    sort: z
      .enum([
        "CONFIDENCE",
        "TOP",
        "NEW",
        "CONTROVERSIAL",
        "OLD",
        "RANDOM",
        "QA",
      ])
      .optional()
      .describe("Sort method for the comments"),
    cursor_id: z
      .string()
      .optional()
      .describe("Pagination cursor ID for fetching more comments"),
  }),
  execute: async ({ post_id, sort, cursor_id }) => {
    try {
      const plugin = usePlugin();

      // Check if API key is available
      if (!plugin.settings.RAPIDAPI_KEY) {
        return { error: "RapidAPI key is not configured in settings" };
      }

      // Prepare request URL and options
      const url = "https://reddit-scraper2.p.rapidapi.com/post_comments_v3";

      // Resolve cursor from map if provided
      let cursor = "";
      if (cursor_id) {
        try {
          cursor = cursorMap.get(cursor_id);
        } catch (error) {
          return { error: `Invalid cursor ID: ${cursor_id}` };
        }
      }

      // Set up request options
      const options = {
        method: "POST",
        headers: {
          "x-rapidapi-key": plugin.settings.RAPIDAPI_KEY,
          "x-rapidapi-host": "reddit-scraper2.p.rapidapi.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_id,
          sort,
          cursor,
        }),
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
      return { error: `Failed to get Reddit comments: ${error.message}` };
    }
  },
});
