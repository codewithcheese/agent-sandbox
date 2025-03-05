import { tool } from "ai";
import { z } from "zod";
import { usePlugin } from "$lib/utils";
import cursorMap from "$lib/utils/cursorMap";

export const redditSearchSubredditsTool = tool({
  description: "Search for subreddits on a specific topic using RapidAPI",
  parameters: z.object({
    query: z.string().describe("The search query for subreddits"),
    nsfw: z
      .enum(["0", "1"])
      .default("0")
      .describe("Whether to include NSFW subreddits (0 for no, 1 for yes)"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor ID for fetching more results"),
  }),
  execute: async ({ query, nsfw, cursor }) => {
    try {
      const plugin = usePlugin();

      // Check if API key is available
      if (!plugin.settings.RAPIDAPI_KEY) {
        return { error: "RapidAPI key is not configured in settings" };
      }

      // Prepare request URL
      let url = `https://reddit-scraper2.p.rapidapi.com/search_subs?query=${encodeURIComponent(query)}&nsfw=${nsfw}`;

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

      // Return the subreddits with pagination info
      // Add pagination cursor to the result
      if (result.pageInfo?.hasNextPage) {
        result.pageInfo.endCursor = cursorMap.store(result.pageInfo.endCursor);
      }

      // Return the API response directly
      return result;
    } catch (error) {
      return { error: `Failed to search subreddits: ${error.message}` };
    }
  },
});
