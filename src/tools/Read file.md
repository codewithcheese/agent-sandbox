---
name: read_file
description: Read the contents of a file in the Obsidian vault
import: readFile
---

This tool allows you to read the contents of any file in the Obsidian vault.

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "The path to the file to read"
    }
  },
  "required": ["path"]
}
```