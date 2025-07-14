import { describe, it, expect } from "vitest";
import { ChatMarkdownFormatter } from "../../src/chat/chat-markdown-formatter.ts";
import type { UIMessageWithMetadata } from "../../src/chat/chat.svelte.ts";
import { nanoid } from "nanoid";

describe("ChatMarkdownFormatter", () => {
  it("should format empty chat", () => {
    const messages: UIMessageWithMetadata[] = [];
    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toBe("");
  });

  it("should skip system messages", () => {
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "system",
        parts: [{ type: "text", text: "You are a helpful assistant." }],
        metadata: {
          createdAt: new Date(),
          agentPath: "/agents/test.agent",
          agentModified: 123456,
        },
      },
    ];
    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toBe("");
  });

  it("should skip system meta messages", () => {
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "System reminder: files changed" }],
        metadata: {
          createdAt: new Date(),
          isSystemMeta: true,
        },
      },
    ];
    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toBe("");
  });

  it("should format basic user message", () => {
    const createdAt = new Date("2024-01-01T10:30:00Z");
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "Hello, how are you?" }],
        metadata: {
          createdAt,
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("## User");
    expect(result).toContain("Hello, how are you?");
    expect(result).toContain(createdAt.toLocaleString());
  });

  it("should format basic assistant message", () => {
    const createdAt = new Date("2024-01-01T10:30:15Z");
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "assistant",
        parts: [{ type: "text", text: "I'm doing well, thank you!" }],
        metadata: {
          createdAt,
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("## Assistant");
    expect(result).toContain("I'm doing well, thank you!");
    expect(result).toContain(createdAt.toLocaleString());
  });

  it("should format user message with command", () => {
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "Execute command" }],
        metadata: {
          createdAt: new Date(),
          command: {
            text: "Execute command",
            path: "/commands/test.md",
          },
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("**Command:** [[/commands/test.md]]");
  });

  it("should format user message with modified files", () => {
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "I made some changes" }],
        metadata: {
          createdAt: new Date(),
          modified: ["/src/file1.ts", "/src/file2.ts"],
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("**Modified files:** [[/src/file1.ts]], [[/src/file2.ts]]");
  });

  it("should format message with file attachments", () => {
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "user",
        parts: [
          { type: "text", text: "Check this file" },
          { type: "file", filename: "/docs/readme.md", mediaType: "text/markdown", url: "" },
          { type: "file", filename: "/src/index.ts", mediaType: "text/typescript", url: "" },
        ],
        metadata: {
          createdAt: new Date(),
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("Check this file");
    expect(result).toContain("**Attachments:**");
    expect(result).toContain("- [[/docs/readme.md]]");
    expect(result).toContain("- [[/src/index.ts]]");
  });

  it("should format message with tool calls", () => {
    const toolCallId = nanoid();
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "assistant",
        parts: [
          { type: "text", text: "I'll read the file for you." },
          {
            type: "tool-Read",
            toolCallId,
            input: { path: "/src/example.ts" },
            output: { content: "file content" },
            state: "output-available",
          },
          {
            type: "data-tool-ui",
            id: toolCallId,
            data: {
              path: "/src/example.ts",
              context: "reading file",
              lines: "1-50",
              title: "Read File",
            },
          },
        ],
        metadata: {
          createdAt: new Date(),
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("I'll read the file for you.");
    expect(result).toContain("**Tools used:**");
    expect(result).toContain("- Read: [[/src/example.ts]] (reading file) 1-50");
  });

  it("should format tool call with title different from tool name", () => {
    const toolCallId = nanoid();
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "assistant",
        parts: [
          { type: "text", text: "I'll help you with that." },
          {
            type: "tool-Edit",
            toolCallId,
            input: { path: "/src/example.ts", content: "new content" },
            output: { success: true },
            state: "output-available",
          },
          {
            type: "data-tool-ui",
            id: toolCallId,
            data: {
              path: "/src/example.ts",
              title: "Update Implementation",
              lines: "10-20",
            },
          },
        ],
        metadata: {
          createdAt: new Date(),
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("**Tools used:**");
    expect(result).toContain("- Edit: [[/src/example.ts]] 10-20 \"Update Implementation\"");
  });

  it("should format tool call without data part", () => {
    const toolCallId = nanoid();
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "assistant",
        parts: [
          { type: "text", text: "I'll help you with that." },
          {
            type: "tool-Bash",
            toolCallId,
            input: { command: "ls -la" },
            output: { result: "list output" },
            state: "output-available",
          },
        ],
        metadata: {
          createdAt: new Date(),
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("**Tools used:**");
    expect(result).toContain("- Bash");
    expect(result).not.toContain("- Bash:");
  });

  it("should format multiple messages", () => {
    const userTime = new Date("2024-01-01T10:30:00Z");
    const assistantTime = new Date("2024-01-01T10:30:15Z");
    
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "Hello!" }],
        metadata: {
          createdAt: userTime,
        },
      },
      {
        id: nanoid(),
        role: "assistant",
        parts: [{ type: "text", text: "Hi there!" }],
        metadata: {
          createdAt: assistantTime,
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("## User");
    expect(result).toContain("Hello!");
    expect(result).toContain("## Assistant");
    expect(result).toContain("Hi there!");
    expect(result).toContain(userTime.toLocaleString());
    expect(result).toContain(assistantTime.toLocaleString());
  });

  it("should handle empty text content", () => {
    const messages: UIMessageWithMetadata[] = [
      {
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "" }],
        metadata: {
          createdAt: new Date(),
        },
      },
    ];

    const result = ChatMarkdownFormatter.formatChat(messages);
    expect(result).toContain("## User");
    expect(result).not.toContain("**Attachments:**");
    expect(result).not.toContain("**Tools used:**");
  });
});