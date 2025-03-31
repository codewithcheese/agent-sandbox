// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { vault, helpers, fileCache } from "../mocks/obsidian";
import "../mocks/ai-sdk";

// Import after mocking - we can access the mocked objects directly
import type { TFile } from "obsidian";
import { parseToolDefinition, createVaultTool } from "$lib/utils/tools.ts";

describe("Markdown Tool Execution", () => {
  // Define the options required by the AI SDK tool execute method
  const options = {
    toolCallId: "test-tool-call-id",
    messages: [],
    abortSignal: undefined,
  };
  let mockFile: TFile;
  let mockContent: string;
  let mockImportContent: string;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Clear the in-memory file system
    helpers.reset();

    // Create mock content for a tool definition with code block
    mockContent = `---
name: TestTool
description: A test tool for testing purposes
---

This is a test tool.

\`\`\`json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "The message to echo"
    }
  },
  "required": ["message"]
}
\`\`\`

\`\`\`javascript
async function execute({ message }) {
  return {
    result: \`Echo: \${message}\`
  };
}
\`\`\`
`;

    // Create mock content for a tool definition with import
    mockImportContent = `---
name: ImportTool
description: A test tool that uses import
import: think
---

This is a test tool using import.

\`\`\`json
{
  "type": "object",
  "properties": {
    "thought": {
      "type": "string",
      "description": "The thought to process"
    }
  },
  "required": ["thought"]
}
\`\`\`
`;

    // Create a mock TFile by adding a file to the vault
    const filePath = "test-tool.md";
    helpers.addFile(filePath, mockContent);
    mockFile = vault.getFileByPath(filePath) as TFile;
  });

  it("should parse a tool definition from markdown content with code block", async () => {
    // Create a file with the tool definition
    const filePath = "code-tool.md";
    const content = `---
name: TestTool
description: A test tool for testing purposes
---

This is a test tool.

\`\`\`json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "The message to echo"
    }
  },
  "required": ["message"]
}
\`\`\`

\`\`\`javascript
async function execute({ message }) {
  return {
    result: \`Echo: \${message}\`
  };
}
\`\`\`
`;

    // Add the file to the vault - frontmatter will be parsed automatically
    const file = helpers.addFile(filePath, content);

    // Calculate the code block positions for the metadata cache
    const jsonBlockStart = content.indexOf("```json");
    const jsonBlockEnd = content.indexOf("```", jsonBlockStart + 7) + 3;

    const jsBlockStart = content.indexOf("```javascript");
    const jsBlockEnd = content.indexOf("```", jsBlockStart + 14) + 3;

    // Add the code sections to the metadata cache
    const fileCacheItem = fileCache.get(filePath) || {};
    fileCacheItem.sections = [
      {
        type: "code",
        position: {
          start: { offset: jsonBlockStart },
          end: { offset: jsonBlockEnd },
        },
      },
      {
        type: "code",
        position: {
          start: { offset: jsBlockStart },
          end: { offset: jsBlockEnd },
        },
      },
    ];
    fileCache.set(filePath, fileCacheItem);

    // Parse the tool definition using the file we just created
    const toolDef = await parseToolDefinition(file as unknown as TFile);

    expect(toolDef).not.toBeNull();
    expect(toolDef?.name).toBe("TestTool");
    expect(toolDef?.description).toBe("A test tool for testing purposes");
    expect(toolDef?.schema).toEqual({
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message to echo",
        },
      },
      required: ["message"],
    });
    expect(toolDef?.code).not.toBeNull();
    expect(toolDef?.import).toBeUndefined();
  });

  it("should parse a tool definition from markdown content with import", async () => {
    // Create a file with the tool definition
    const filePath = "import-tool.md";
    const content = `---
name: ImportTool
description: A test tool that uses import
import: think
---

This is a test tool using import.

\`\`\`json
{
  "type": "object",
  "properties": {
    "thought": {
      "type": "string",
      "description": "The thought to process"
    }
  },
  "required": ["thought"]
}
\`\`\`
`;

    // Add the file to the vault - frontmatter will be parsed automatically
    const file = helpers.addFile(filePath, content);

    // Calculate the code block positions for the metadata cache
    const jsonBlockStart = content.indexOf("```json");
    const jsonBlockEnd = content.indexOf("```", jsonBlockStart + 7) + 3;

    // Add the code sections to the metadata cache
    const fileCacheItem = fileCache.get(filePath) || {};
    fileCacheItem.sections = [
      {
        type: "code",
        position: {
          start: { offset: jsonBlockStart },
          end: { offset: jsonBlockEnd },
        },
      },
    ];
    fileCache.set(filePath, fileCacheItem);

    // Parse the tool definition using the file we just created
    const toolDef = await parseToolDefinition(file as unknown as TFile);

    expect(toolDef).not.toBeNull();
    expect(toolDef?.name).toBe("ImportTool");
    expect(toolDef?.description).toBe("A test tool that uses import");
    expect(toolDef?.schema).toEqual({
      type: "object",
      properties: {
        thought: {
          type: "string",
          description: "The thought to process",
        },
      },
      required: ["thought"],
    });
    expect(toolDef?.code).toBeNull();
    expect(toolDef?.import).toBe("think");
  });

  it("should create and execute a tool from a markdown definition with code", async () => {
    // Create a mock tool definition with a simpler code function
    const mockToolDef = {
      name: "echo",
      description: "Echo a message",
      schema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to echo",
          },
        },
        required: ["message"],
      },
      code: `
        return { result: "Echo: " + params.message };
      `,
      file: mockFile,
    };

    // Create the tool
    const { name, tool: echoTool } = createVaultTool(mockToolDef);

    // Execute the tool
    const result = await echoTool.execute(
      { message: "Hello, world!" },
      options,
    );

    // Check the result
    expect(name).toBe("echo");
    expect(result).toEqual({
      result: "Echo: Hello, world!",
    });
  });

  it("should create and execute a tool from a markdown definition with import", async () => {
    // Create a mock tool definition with import
    const mockToolDef = {
      name: "think",
      description: "Process a thought",
      schema: {
        type: "object",
        properties: {
          thought: {
            type: "string",
            description: "The thought to process",
          },
        },
        required: ["thought"],
      },
      code: null,
      import: "think",
      file: mockFile,
    };

    // Create the tool
    const { name, tool: thinkTool } = createVaultTool(mockToolDef);

    // Execute the tool
    const testThought = "This is a test thought";
    const result = await thinkTool.execute({ thought: testThought }, options);

    // Check the result
    expect(name).toBe("think");
    expect(result).toBe(testThought);
  });

  it("should handle errors in tool execution with code", async () => {
    // Create a mock tool definition with code that will throw an error
    const mockToolDef = {
      name: "error",
      description: "A tool that throws an error",
      schema: {
        type: "object",
        properties: {
          message: {
            type: "string",
          },
        },
        required: ["message"],
      },
      code: `
        throw new Error('Test error');
      `,
      file: mockFile,
    };

    // Create the tool
    const { tool: errorTool } = createVaultTool(mockToolDef);

    // Execute the tool
    const result = await errorTool.execute(
      { message: "Hello, world!" },
      options,
    );

    // Check that the error message contains our test error
    expect(result.error).toContain("Test error");
  });

  it("should handle errors when the import function doesn't exist", async () => {
    // Create a mock tool definition with an import that doesn't exist
    const mockToolDef = {
      name: "nonexistent",
      description: "A tool with a nonexistent import",
      schema: {
        type: "object",
        properties: {
          message: {
            type: "string",
          },
        },
        required: ["message"],
      },
      code: null,
      import: "nonexistentFunction",
      file: mockFile,
    };

    // Create the tool
    const { tool: errorTool } = createVaultTool(mockToolDef);

    // Execute the tool
    const result = await errorTool.execute(
      { message: "Hello, world!" },
      options,
    );

    // Check the result contains the error about the nonexistent function
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("not found in tools/index.ts");
  });
});
