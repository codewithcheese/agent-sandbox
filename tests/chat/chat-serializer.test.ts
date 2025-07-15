import { describe, it, expect, beforeEach } from "vitest";
import {
  ChatSerializer,
  type CurrentChatFile,
} from "../../src/chat/chat-serializer.ts";
import { Chat } from "../../src/chat/chat.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import { nanoid } from "nanoid";
import superjson from "superjson";
import { invariant } from "@epic-web/invariant";

describe("ChatSerializer", () => {
  beforeEach(async () => {
    await helpers.reset();
  });

  describe("stringify", () => {
    it("should serialize .chat.md files to markdown format", async () => {
      const agentFile = await vault.create("agents/test.agent", "");
      const chatFile = await vault.create(
        "chats/test.chat.md",
        superjson.stringify(ChatSerializer.INITIAL_DATA),
      );

      const chat = new Chat(
        chatFile.path,
        ChatSerializer.parse(await vault.read(chatFile)),
      );

      // Add some messages
      chat.messages.push({
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "Hello, world!" }],
        metadata: {
          createdAt: new Date("2024-01-01T10:30:00Z"),
        },
      });

      chat.messages.push({
        id: nanoid(),
        role: "assistant",
        parts: [{ type: "text", text: "Hi there!" }],
        metadata: {
          createdAt: new Date("2024-01-01T10:30:15Z"),
        },
      });

      const result = ChatSerializer.stringify(chat);

      // Should contain human-readable markdown
      expect(result).toContain("## User");
      expect(result).toContain("Hello, world!");
      expect(result).toContain("## Assistant");
      expect(result).toContain("Hi there!");

      // Should contain embedded data section
      expect(result).toContain("%%");
      expect(result).toContain("# Chat Data");
      expect(result).toContain("```chatdata");
      expect(result).toContain("```");
    });

    it("should serialize .chat files to raw JSON format", async () => {
      const agentFile = await vault.create("agents/test.agent", "");
      const chatFile = await vault.create(
        "chats/test.chat",
        superjson.stringify(ChatSerializer.INITIAL_DATA),
      );

      const chat = new Chat(
        chatFile.path,
        ChatSerializer.parse(await vault.read(chatFile)),
      );

      // Add some messages
      chat.messages.push({
        id: nanoid(),
        role: "user",
        parts: [{ type: "text", text: "Hello, world!" }],
        metadata: {
          createdAt: new Date("2024-01-01T10:30:00Z"),
        },
      });

      const result = ChatSerializer.stringify(chat);

      // Should be raw JSON format (no markdown)
      expect(result).not.toContain("## User");
      expect(result).not.toContain("## Assistant");
      expect(result).not.toContain("%%");
      expect(result).not.toContain("# Chat Data");
      expect(result).not.toContain("```chatdata");

      // Should be valid JSON
      expect(() => superjson.parse(result)).not.toThrow();
      const parsed = superjson.parse(result) as CurrentChatFile;
      expect(parsed.version).toBe(ChatSerializer.CURRENT_VERSION);
      expect(parsed.payload.messages).toHaveLength(1);
      invariant(
        parsed.payload.messages[0].parts[0].type === "text",
        "Expected text part",
      );
      expect(parsed.payload.messages[0].parts[0].text).toBe("Hello, world!");
    });

    it("should embed base64 encoded JSON data", async () => {
      const agentFile = await vault.create("agents/test.agent", "");
      const chatFile = await vault.create(
        "chats/test.chat.md",
        superjson.stringify(ChatSerializer.INITIAL_DATA),
      );

      const chat = new Chat(
        chatFile.path,
        ChatSerializer.parse(await vault.read(chatFile)),
      );

      const result = ChatSerializer.stringify(chat);

      // Extract the base64 content
      const chatDataMatch = result.match(/```chatdata\n([\s\S]*?)\n```/);
      expect(chatDataMatch).toBeTruthy();

      const base64Content = chatDataMatch![1].trim();
      expect(base64Content).toBeTruthy();

      // Should be valid base64
      expect(() => atob(base64Content)).not.toThrow();

      // Decoded content should be valid JSON
      const decodedJson = atob(base64Content);
      expect(() => superjson.parse(decodedJson)).not.toThrow();

      const parsedData = superjson.parse(decodedJson) as CurrentChatFile;
      expect(parsedData.version).toBe(ChatSerializer.CURRENT_VERSION);
      expect(parsedData.payload).toBeDefined();
      expect(parsedData.payload.id).toBe(chat.id);
      expect(parsedData.payload.messages).toEqual(chat.messages);
    });
  });

  describe("parse", () => {
    it("should parse markdown format with embedded data", () => {
      const testMarkdown = `## User
*1/1/2024, 10:30:00 AM*

Hello, world!

## Assistant
*1/1/2024, 10:30:15 AM*

Hi there!

%%
# Chat Data
\`\`\`chatdata
${btoa(
  superjson.stringify({
    version: 1,
    payload: {
      id: "test-id",
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello, world!" }],
          metadata: { createdAt: new Date("2024-01-01T10:30:00Z") },
        },
      ],
      vault: undefined,
      options: {
        maxSteps: 100,
        temperature: 0.7,
        thinkingEnabled: false,
        maxTokens: 4000,
        thinkingTokensBudget: 1200,
      },
      createdAt: new Date("2024-01-01T10:00:00Z"),
      updatedAt: new Date("2024-01-01T10:30:00Z"),
    },
  }),
)}
\`\`\`
%%`;

      const result = ChatSerializer.parse(testMarkdown);

      expect(result.version).toBe(1);
      expect(result.payload.id).toBe("test-id");
      expect(result.payload.messages).toHaveLength(1);
      expect(result.payload.messages[0].role).toBe("user");
      invariant(
        result.payload.messages[0].parts[0].type === "text",
        "Expected text part",
      );
      expect(result.payload.messages[0].parts[0].text).toBe("Hello, world!");
    });

    it("should fall back to raw JSON parsing", () => {
      const rawJson = superjson.stringify({
        version: 1,
        payload: {
          id: "test-id",
          messages: [],
          vault: undefined,
          options: {
            maxSteps: 100,
            temperature: 0.7,
            thinkingEnabled: false,
            maxTokens: 4000,
            thinkingTokensBudget: 1200,
          },
          createdAt: new Date("2024-01-01T10:00:00Z"),
          updatedAt: new Date("2024-01-01T10:00:00Z"),
        },
      });

      const result = ChatSerializer.parse(rawJson);

      expect(result.version).toBe(1);
      expect(result.payload.id).toBe("test-id");
      expect(result.payload.messages).toHaveLength(0);
    });

    it("should handle missing chatdata section gracefully", () => {
      const markdownWithoutData = `## User
*1/1/2024, 10:30:00 AM*

Hello, world!

No data section here.`;

      // Should fall back to raw JSON parsing and fail gracefully
      expect(() => ChatSerializer.parse(markdownWithoutData)).toThrow();
    });

    it("should handle malformed base64 data gracefully", () => {
      const malformedMarkdown = `## User
*1/1/2024, 10:30:00 AM*

Hello, world!

%%
# Chat Data
\`\`\`chatdata
not-valid-base64!!!
\`\`\`
%%`;

      // Should fall back to raw JSON parsing and fail gracefully
      expect(() => ChatSerializer.parse(malformedMarkdown)).toThrow();
    });

    it("should handle empty chatdata section", () => {
      const emptyDataMarkdown = `## User
*1/1/2024, 10:30:00 AM*

Hello, world!

%%
# Chat Data
\`\`\`chatdata
\`\`\`
%%`;

      // Should fall back to raw JSON parsing and fail gracefully
      expect(() => ChatSerializer.parse(emptyDataMarkdown)).toThrow();
    });
  });

  describe("roundtrip", () => {
    it("should maintain data integrity through stringify/parse cycle", async () => {
      const agentFile = await vault.create("agents/test.agent", "");
      const chatFile = await vault.create(
        "chats/test.chat.md",
        superjson.stringify(ChatSerializer.INITIAL_DATA),
      );

      const originalChat = new Chat(
        chatFile.path,
        ChatSerializer.parse(await vault.read(chatFile)),
      );

      // Add complex message with various parts
      const toolCallId = nanoid();
      originalChat.messages.push({
        id: nanoid(),
        role: "user",
        parts: [
          { type: "text", text: "Please check this file" },
          {
            type: "file",
            filename: "/src/example.ts",
            mediaType: "text/plain",
            url: "",
          },
        ],
        metadata: {
          createdAt: new Date("2024-01-01T10:30:00Z"),
          modified: ["/src/file1.ts", "/src/file2.ts"],
          command: {
            text: "check files",
            path: "/commands/check.md",
          },
        },
      });

      originalChat.messages.push({
        id: nanoid(),
        role: "assistant",
        parts: [
          { type: "text", text: "I'll check the file for you." },
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
              title: "Read File",
              context: "reading file",
              lines: "1-50",
            },
          },
        ],
        metadata: {
          createdAt: new Date("2024-01-01T10:30:15Z"),
          steps: [
            {
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              finishReason: "stop",
              stepIndex: 0,
            },
          ],
        },
      });

      // Serialize and parse
      const serialized = ChatSerializer.stringify(originalChat);
      const parsed = ChatSerializer.parse(serialized);

      // Verify data integrity
      expect(parsed.version).toBe(
        originalChat.id
          ? ChatSerializer.CURRENT_VERSION
          : ChatSerializer.CURRENT_VERSION,
      );
      expect(parsed.payload.id).toBe(originalChat.id);
      expect(parsed.payload.messages).toHaveLength(
        originalChat.messages.length,
      );
      expect(parsed.payload.options).toEqual(originalChat.options);

      // Verify message content
      expect(parsed.payload.messages[0].role).toBe("user");
      invariant(
        parsed.payload.messages[0].parts[0].type === "text",
        "Expected text part",
      );
      expect(parsed.payload.messages[0].parts[0].text).toBe(
        "Please check this file",
      );
      invariant(
        parsed.payload.messages[0].parts[1].type === "file",
        "Expected file part",
      );
      expect(parsed.payload.messages[0].parts[1].filename).toBe(
        "/src/example.ts",
      );
      invariant(
        parsed.payload.messages[0].role === "user",
        "Expected user message",
      );
      expect(parsed.payload.messages[0].metadata.modified).toEqual([
        "/src/file1.ts",
        "/src/file2.ts",
      ]);
      expect(parsed.payload.messages[0].metadata.command?.text).toBe(
        "check files",
      );

      expect(parsed.payload.messages[1].role).toBe("assistant");
      invariant(
        parsed.payload.messages[1].parts[0].type === "text",
        "Expected text part",
      );
      expect(parsed.payload.messages[1].parts[0].text).toBe(
        "I'll check the file for you.",
      );
      expect(parsed.payload.messages[1].parts[1].type).toBe("tool-Read");
      invariant(
        parsed.payload.messages[1].role === "assistant",
        "Expected assistant message",
      );
      expect(parsed.payload.messages[1].metadata.steps).toHaveLength(1);
    });
  });

  describe("createInitialMarkdown", () => {
    it("should create initial markdown with default options", () => {
      const result = ChatSerializer.createInitialMarkdown();

      expect(result).toContain("%%");
      expect(result).toContain("# Chat Data");
      expect(result).toContain("```chatdata");
      expect(result).toContain("```");

      // Should contain valid base64 encoded data
      const base64Match = result.match(/```chatdata\n([\s\S]*?)\n```/);
      expect(base64Match).toBeTruthy();

      const decodedData = superjson.parse(
        atob(base64Match![1].trim()),
      ) as CurrentChatFile;
      expect(decodedData.version).toBe(1);
      expect(decodedData.payload.messages).toEqual([]);
      expect(decodedData.payload.options.maxSteps).toBe(100);
    });

    it("should create initial markdown with custom options", () => {
      const result = ChatSerializer.createInitialMarkdown({
        modelId: "custom-model",
        accountId: "custom-account",
      });

      const base64Match = result.match(/```chatdata\n([\s\S]*?)\n```/);
      const decodedData = superjson.parse(
        atob(base64Match![1].trim()),
      ) as CurrentChatFile;

      expect(decodedData.payload.options.modelId).toBe("custom-model");
      expect(decodedData.payload.options.accountId).toBe("custom-account");
    });
  });

  describe("migration", () => {
    it("should handle version migration", () => {
      // Create data with version 0 (should be migrated to version 1)
      const oldVersionData = {
        version: 0,
        payload: {
          id: "test-id",
          messages: [],
          vault: undefined,
          options: {
            maxSteps: 100,
            temperature: 0.7,
            thinkingEnabled: false,
            maxTokens: 4000,
            thinkingTokensBudget: 1200,
          },
          createdAt: new Date("2024-01-01T10:00:00Z"),
          updatedAt: new Date("2024-01-01T10:00:00Z"),
        },
      };

      const rawJson = superjson.stringify(oldVersionData);
      const result = ChatSerializer.parse(rawJson);

      expect(result.version).toBe(ChatSerializer.CURRENT_VERSION);
      expect(result.payload.id).toBe("test-id");
    });
  });
});
