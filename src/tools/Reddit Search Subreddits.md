---
name: reddit_search_subreddits
description: Search for subreddits based on a query using RapidAPI
import: redditSearchSubreddits
---

This tool allows you to search for subreddits based on a query using the RapidAPI Reddit Scraper.

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "The search query for subreddits"
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100,
      "default": 10,
      "description": "Maximum number of results to return"
    },
    "exact": {
      "type": "boolean",
      "default": false,
      "description": "Whether to search for exact matches only"
    }
  },
  "required": ["query"]
}
```
