// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the modules before importing
// Mock Obsidian
vi.mock("obsidian", () => ({
  TFile: class {},
}));

// Mock the AI SDK tool function
vi.mock("ai", () => ({
  tool: vi.fn().mockImplementation((config) => ({
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  })),
}));

// Mock the utils module
vi.mock("../../src/lib/utils", () => ({
  usePlugin: vi.fn(),
}));

// Create a mock implementation of usePlugin
const mockVault = {
  read: vi.fn(),
  getFileByPath: vi.fn(),
};

const mockMetadataCache = {
  getFileCache: vi.fn(),
  getFirstLinkpathDest: vi.fn(),
};

const mockApp = {
  vault: mockVault,
  metadataCache: mockMetadataCache,
};

const mockPlugin = {
  app: mockApp,
};

// Import after mocking
import type { TFile } from "obsidian";
import {
  parseToolDefinition,
  createVaultTool,
} from "../../src/lib/utils/tools";
import { usePlugin } from "../../src/lib/utils";

describe("Markdown Tool Execution", () => {
  // Define the options required by the AI SDK tool execute method
  const options = {
    toolCallId: "test-tool-call-id",
    messages: [],
    abortSignal: undefined,
  };
  let mockFile: TFile;
  let mockContent: string;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup the usePlugin mock to return our mock plugin
    vi.mocked(usePlugin).mockReturnValue(mockPlugin);

    // Create a mock TFile
    mockFile = {
      path: "test-tool.md",
      basename: "test-tool",
      extension: "md",
    } as TFile;

    // Create mock content for a tool definition
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
  });

  it("should parse a tool definition from markdown content", async () => {
    // Setup mocks for this test
    mockVault.read.mockResolvedValue(mockContent);
    mockMetadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        name: "TestTool",
        description: "A test tool for testing purposes",
      },
    });

    const toolDef = await parseToolDefinition(mockFile);

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
    expect(toolDef?.code).toContain(
      'return { result: "Echo: " + params.message }',
    );
  });

  it("should create and execute a tool from a markdown definition", async () => {
    // Create a mock tool definition with a simpler executeCode function
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
      executeCode: `
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

  it("should handle errors in tool execution", async () => {
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
      executeCode: `
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

    // Check the result contains the error
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("Test error");
  });
});
