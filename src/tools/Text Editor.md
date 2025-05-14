---
name: str_replace_editor
description: Provides functionality for viewing and editing text files
---

This tool allows AI models to view and edit text files in your Obsidian vault.

This tool has built-in support for Anthropic models and doesn't require a schema when used with Anthropic. For other providers like OpenAI, Gemini, and others, the schema below is used to provide compatibility.

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "enum": ["view", "create", "str_replace", "insert", "undo_edit"],
      "description": "The operation to perform on the file"
    },
    "path": {
      "type": "string",
      "description": "Path to the file or directory to operate on"
    },
    "file_text": {
      "type": "string",
      "description": "Text content for creating a new file"
    },
    "insert_line": {
      "type": "integer",
      "description": "Line number where text should be inserted (for insert command)"
    },
    "new_str": {
      "type": "string",
      "description": "New text to insert or replace with"
    },
    "old_str": {
      "type": "string",
      "description": "Text to be replaced (for str_replace command)"
    },
    "view_range": {
      "type": "array",
      "items": {
        "type": "integer"
      },
      "minItems": 2,
      "maxItems": 2,
      "description": "Range of lines to view [startLine, endLine]. Use -1 for endLine to view until the end of file"
    }
  },
  "required": ["command", "path"],
  "additionalProperties": false
}
```
