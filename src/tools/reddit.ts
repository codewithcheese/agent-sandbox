import { usePlugin } from "$lib/utils";
import cursorMap from "$lib/utils/cursor-map";

/**
 * Search Reddit posts on a specific topic
 */
export async function redditSearch({ query, sort, time, nsfw, limit, cursor }) {
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
        return { error: `Invalid cursor: ${error.message}` };
      }
    }

    // Make the API request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": plugin.settings.RAPIDAPI_KEY,
        "X-RapidAPI-Host": "reddit-scraper2.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      return { error: `API request failed with status ${response.status}` };
    }

    const data = await response.json();

    // Store the next cursor in the map and return a short ID
    let nextCursorId = null;
    if (data.next_cursor) {
      nextCursorId = cursorMap.store(data.next_cursor);
    }

    return {
      posts: data.posts,
      next_cursor: nextCursorId,
    };
  } catch (error) {
    return { error: `Failed to search Reddit: ${error.message}` };
  }
}

/**
 * Get comments for a specific Reddit post
 */
export async function redditGetPostComments({ postId, sort, limit }) {
  try {
    const plugin = usePlugin();

    // Check if API key is available
    if (!plugin.settings.RAPIDAPI_KEY) {
      return { error: "RapidAPI key is not configured in settings" };
    }

    // Construct the URL with query parameters
    const url = `https://reddit-scraper2.p.rapidapi.com/get_post_comments?post_id=${postId}&sort=${sort}&limit=${limit}`;

    // Make the API request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": plugin.settings.RAPIDAPI_KEY,
        "X-RapidAPI-Host": "reddit-scraper2.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      return { error: `API request failed with status ${response.status}` };
    }

    const data = await response.json();

    return {
      comments: data.comments,
      post: data.post,
    };
  } catch (error) {
    return { error: `Failed to get Reddit comments: ${error.message}` };
  }
}

/**
 * Search for subreddits based on a query
 */
export async function redditSearchSubreddits({ query, limit, exact }) {
  try {
    const plugin = usePlugin();

    // Check if API key is available
    if (!plugin.settings.RAPIDAPI_KEY) {
      return { error: "RapidAPI key is not configured in settings" };
    }

    // Construct the URL with query parameters
    const url = `https://reddit-scraper2.p.rapidapi.com/search_subreddits?query=${encodeURIComponent(query)}&limit=${limit}&exact=${exact ? 'true' : 'false'}`;

    // Make the API request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": plugin.settings.RAPIDAPI_KEY,
        "X-RapidAPI-Host": "reddit-scraper2.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      return { error: `API request failed with status ${response.status}` };
    }

    const data = await response.json();

    return {
      subreddits: data.subreddits,
    };
  } catch (error) {
    return { error: `Failed to search subreddits: ${error.message}` };
  }
}

/**
 * Get posts from a specific subreddit
 */
export async function redditGetPosts({ subreddit, sort, time, limit }) {
  try {
    const plugin = usePlugin();

    // Check if API key is available
    if (!plugin.settings.RAPIDAPI_KEY) {
      return { error: "RapidAPI key is not configured in settings" };
    }

    // Construct the URL with query parameters
    const url = `https://reddit-scraper2.p.rapidapi.com/get_subreddit_posts?subreddit=${encodeURIComponent(subreddit)}&sort=${sort}${time ? `&time=${time}` : ''}&limit=${limit}`;

    // Make the API request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": plugin.settings.RAPIDAPI_KEY,
        "X-RapidAPI-Host": "reddit-scraper2.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      return { error: `API request failed with status ${response.status}` };
    }

    const data = await response.json();

    return {
      posts: data.posts,
      subreddit_info: data.subreddit_info,
    };
  } catch (error) {
    return { error: `Failed to get subreddit posts: ${error.message}` };
  }
}
