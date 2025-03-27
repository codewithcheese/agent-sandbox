---
name: reddit_get_post_comments
description: Get comments for a specific Reddit post using RapidAPI
import: redditGetPostComments
---

This tool allows you to fetch comments for a specific Reddit post using the RapidAPI Reddit Scraper.

```json
{
  "type": "object",
  "properties": {
    "postId": {
      "type": "string",
      "description": "The ID of the Reddit post to get comments for"
    },
    "sort": {
      "type": "string",
      "enum": ["confidence", "top", "new", "controversial", "old", "random", "qa", "live"],
      "default": "confidence",
      "description": "Sort method for the comments"
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100,
      "default": 25,
      "description": "Maximum number of comments to return"
    }
  },
  "required": ["postId"]
}
```
