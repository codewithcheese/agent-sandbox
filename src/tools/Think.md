---
name: think
description: Use this tool to think about something. It will not obtain new information or change anything, but just allows for complex reasoning or brainstorming. Use it when you need to analyze tool outputs, verify policy compliance, or make sequential decisions.
import: think
---

This tool allows the AI to think through complex problems in a structured way. It doesn't obtain new information or change anything, but provides space for detailed reasoning.

```json
{
  "type": "object",
  "properties": {
    "thought": {
      "type": "string",
      "description": "Your detailed thoughts, analysis, or reasoning process."
    }
  },
  "required": ["thought"]
}
```
