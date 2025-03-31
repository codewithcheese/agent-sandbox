---
name: execute_python
description: Execute Python code using Pyodide
import: executePython
---

This tool allows you to execute Python code in the browser using Pyodide.

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "The Python code to execute"
    },
    "installPackages": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional Python packages to install before execution"
    }
  },
  "required": ["code"]
}
```
