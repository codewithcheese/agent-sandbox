---
name: reddit_search
description: Search Reddit posts on a specific topic using RapidAPI
import: redditSearch
---

This tool allows you to search for Reddit posts on specific topics using the RapidAPI Reddit Scraper.

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "The search query for Reddit posts"
    },
    "sort": {
      "type": "string",
      "enum": ["RELEVANCE", "HOT", "TOP", "NEW", "COMMENTS"],
      "default": "RELEVANCE",
      "description": "Sort method for the results"
    },
    "time": {
      "type": "string",
      "enum": ["hour", "day", "week", "month", "year", "all"],
      "default": "all",
      "description": "Time range for the results"
    },
    "nsfw": {
      "type": "string",
      "enum": ["0", "1"],
      "default": "0",
      "description": "Whether to include NSFW content (0 for no, 1 for yes)"
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100,
      "default": 10,
      "description": "Maximum number of results to return"
    },
    "cursor": {
      "type": "string",
      "description": "Pagination cursor for fetching the next page of results"
    }
  },
  "required": ["query"]
}
```
