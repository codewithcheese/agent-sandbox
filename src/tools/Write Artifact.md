---
name: write_artifact
description: Opens AI-generated HTML/JavaScript content in an isolated ArtifactView
import: writeArtifact
---

This tool allows you to display AI-generated HTML and JavaScript content in an isolated iframe environment. The content is loaded into the ArtifactView, which provides a sandbox where scripts can run without affecting Obsidian's core UI.

```json
{
  "type": "object",
  "properties": {
    "html": {
      "type": "string",
      "description": "The HTML content to display, which can include CSS and JavaScript. This content will be loaded into an iframe with sandbox attributes."
    }
  },
  "required": ["html"]
}
```
