---
name: list_files
description: List files in a directory in the Obsidian vault
import: listFiles
---

This tool allows you to list files and directories in a specified path within the Obsidian vault.

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "The path to the directory to list files from"
    }
  },
  "required": ["path"]
}
```