---
name: reddit_get_subreddit_posts
description: Get posts from a specific subreddit using RapidAPI
import: redditGetPosts
---

This tool allows you to fetch posts from a specific subreddit using the RapidAPI Reddit Scraper.

```json
{
  "type": "object",
  "properties": {
    "subreddit": {
      "type": "string",
      "description": "The name of the subreddit to get posts from (without the r/ prefix)"
    },
    "sort": {
      "type": "string",
      "enum": ["hot", "new", "top", "rising", "controversial"],
      "default": "hot",
      "description": "Sort method for the posts"
    },
    "time": {
      "type": "string",
      "enum": ["hour", "day", "week", "month", "year", "all"],
      "default": "all",
      "description": "Time range for the posts (only applicable for 'top' and 'controversial' sort)"
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100,
      "default": 25,
      "description": "Maximum number of posts to return"
    }
  },
  "required": ["subreddit"]
}
```
