import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseToolDefinition } from "../../src/tools";
import { helpers, vault as mockVault, plugin } from "../mocks/obsidian";
import { invariant } from "@epic-web/invariant";

describe("Prompt Tools", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await helpers.reset(); // Reset the mock vault state
  });

  describe("parseToolDefinition", () => {
    it("should create a prompt tool from simple markdown file", async () => {
      const content = `---
name: simple_prompt
description: A simple test prompt
---

# Simple Prompt

This is a simple prompt tool for testing.

Please help the user with their request.`;

      await mockVault.create("/test/simple-prompt.md", content);
      const file = mockVault.getFileByPath("/test/simple-prompt.md");
      invariant(file, "File should exist");

      const toolDef = await parseToolDefinition(file);
      invariant(toolDef.type === "local", "Tool should be local");

      expect(toolDef.type).toBe("local");
      expect(toolDef.name).toBe("simple_prompt");
      expect(toolDef.description).toBe("A simple test prompt");
      expect(toolDef.inputSchema).toBeDefined();
    });

    it("should create a prompt tool with schema and templating", async () => {
      const content = `---
name: templated_prompt
description: A prompt tool with templating support
---

# Code Review for {{ language | default("code") }}

{% if focus %}
Focus areas: {{ focus }}
{% endif %}

Please review the code for best practices.

\`\`\`schema
{
  "type": "object",
  "properties": {
    "language": {
      "type": "string",
      "description": "Programming language"
    },
    "focus": {
      "type": "string",
      "description": "Areas to focus on"
    }
  }
}
\`\`\``;

      await mockVault.create("/test/templated-prompt.md", content);
      const file = mockVault.getFileByPath("/test/templated-prompt.md");
      invariant(file, "File should exist");

      const toolDef = await parseToolDefinition(file);
      invariant(toolDef.type === "local", "Tool should be local");

      expect(toolDef.type).toBe("local");
      expect(toolDef.name).toBe("templated_prompt");
      expect(toolDef.description).toBe("A prompt tool with templating support");
      expect(toolDef.inputSchema).toBeDefined();
    });

    it("should sanitize tool name when using filename fallback", async () => {
      const content = `---
description: A prompt without explicit name
---

# Test Prompt

This prompt has no name in frontmatter.`;

      await mockVault.create("/test/My Cool Prompt!.md", content);
      const file = mockVault.getFileByPath("/test/My Cool Prompt!.md");
      invariant(file, "File should exist");

      const toolDef = await parseToolDefinition(file);

      expect(toolDef.type).toBe("local");
      expect(toolDef.name).toBe("My_Cool_Prompt"); // Sanitized filename
      expect(toolDef.description).toBe("A prompt without explicit name");
    });

    it("should handle prompt tool without frontmatter", async () => {
      const content = `# Basic Prompt

This is a basic prompt with no frontmatter.`;

      await mockVault.create("/test/basic-prompt.md", content);
      const file = mockVault.getFileByPath("/test/basic-prompt.md");
      invariant(file, "File should exist");

      const toolDef = await parseToolDefinition(file);

      expect(toolDef.type).toBe("local");
      expect(toolDef.name).toBe("basic-prompt"); // Uses filename
      expect(toolDef.description).toBe("Prompt: basic-prompt");
    });

    it("should handle invalid schema gracefully", async () => {
      const content = `---
name: invalid_schema_prompt
description: A prompt with invalid schema
---

# Prompt with Bad Schema

This has an invalid JSON schema.

\`\`\`schema
{
  "type": "object",
  "properties": {
    "language": {
      "type": "string"
    // Missing closing brace - invalid JSON
}
\`\`\``;

      await mockVault.create("/test/invalid-schema.md", content);
      const file = mockVault.getFileByPath("/test/invalid-schema.md");
      invariant(file, "File should exist");

      // Should not throw, but create tool with empty schema
      const toolDef = await parseToolDefinition(file);
      invariant(toolDef.type === "local", "Tool should be local");

      expect(toolDef.type).toBe("local");
      expect(toolDef.name).toBe("invalid_schema_prompt");
      expect(toolDef.inputSchema).toBeDefined(); // Should have empty schema
    });
  });

  describe("prompt tool execution", () => {
    it("should execute simple prompt tool", async () => {
      const content = `---
name: execution_test
description: Test prompt execution
---

# Execution Test

This is a test of prompt execution.`;

      await mockVault.create("/test/execution-test.md", content);
      const file = mockVault.getFileByPath("/test/execution-test.md");
      invariant(file, "File should exist");

      const toolDef = await parseToolDefinition(file);
      invariant(toolDef.type === "local", "Tool should be local");

      const result = await toolDef.execute(
        {},
        {
          toolCallId: "test-call",
          messages: [],
          abortSignal: new AbortController().signal,
          getContext: () => ({
            vault: mockVault,
            config: {},
            sessionStore: {} as any,
            metadataCache: plugin.app.metadataCache,
          }),
        },
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("Execution Test");
      expect(result).toContain("This is a test of prompt execution.");
    });

    it("should execute templated prompt tool with parameters", async () => {
      const content = `---
name: templated_execution
description: Test templated prompt execution
---

# Review for {{ language }}

{% if focus %}
Focus: {{ focus }}
{% endif %}

Standard checklist applies.

\`\`\`schema
{
  "type": "object",
  "properties": {
    "language": {
      "type": "string",
      "description": "Programming language"
    },
    "focus": {
      "type": "string",
      "description": "Focus area"
    }
  }
}
\`\`\``;

      await mockVault.create("/test/templated-execution.md", content);
      const file = mockVault.getFileByPath("/test/templated-execution.md");
      invariant(file, "File should exist");

      const toolDef = await parseToolDefinition(file);
      invariant(toolDef.type === "local", "Tool should be local");

      const result = await toolDef.execute(
        { language: "TypeScript", focus: "type safety" },
        {
          toolCallId: "test-call",
          messages: [],
          abortSignal: new AbortController().signal,
          getContext: () => ({
            vault: mockVault,
            config: {},
            sessionStore: {} as any,
            metadataCache: plugin.app.metadataCache,
          }),
        },
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("Review for TypeScript");
      expect(result).toContain("Focus: type safety");
      expect(result).toContain("Standard checklist applies.");
    });

    it("should execute templated prompt without parameters", async () => {
      const content = `---
name: optional_params
description: Test prompt with optional parameters
---

# Review for {{ language | default("code") }}

{% if focus %}
Focus: {{ focus }}
{% else %}
General review.
{% endif %}

\`\`\`schema
{
  "type": "object",
  "properties": {
    "language": {
      "type": "string",
      "description": "Programming language"
    },
    "focus": {
      "type": "string",
      "description": "Focus area"
    }
  }
}
\`\`\``;

      await mockVault.create("/test/optional-params.md", content);
      const file = mockVault.getFileByPath("/test/optional-params.md");
      invariant(file, "File should exist");

      const toolDef = await parseToolDefinition(file);
      invariant(toolDef.type === "local", "Tool should be local");

      const result = await toolDef.execute(
        {},
        {
          toolCallId: "test-call",
          messages: [],
          abortSignal: new AbortController().signal,
          getContext: () => ({
            vault: mockVault,
            config: {},
            sessionStore: {} as any,
            metadataCache: plugin.app.metadataCache,
          }),
        },
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("Review for code"); // Default value
      expect(result).toContain("General review."); // Else branch
    });
  });
});
