import { tool } from "ai";
import { z } from "zod";
import { usePlugin } from "$lib/utils";
import cursorMap from "$lib/utils/cursor-map.ts";

export const redditGetPostsTool = tool({
  description: "Get posts from a specific subreddit using RapidAPI",
  parameters: z.object({
    sub: z.string().describe("The subreddit name (without 'r/')"),
    sort: z
      .enum(["HOT", "NEW", "TOP", "RISING"])
      .default("HOT")
      .describe("Sort method for the posts"),
    time: z
      .enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "ALL"])
      .default("ALL")
      .describe("Time range for the posts when using TOP sort"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor ID for fetching more posts"),
  }),
  execute: async ({ sub, sort, time, cursor }) => {
    try {
      const plugin = usePlugin();

      // Check if API key is available
      if (!plugin.settings.RAPIDAPI_KEY) {
        return { error: "RapidAPI key is not configured in settings" };
      }

      // Prepare request URL
      let url = `https://reddit-scraper2.p.rapidapi.com/sub_posts?sub=${encodeURIComponent(sub)}&sort=${sort}&time=${time}`;

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
      return { error: `Failed to get subreddit posts: ${error.message}` };
    }
  },
});
