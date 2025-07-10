// mocks
import { helpers, plugin, vault } from "../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { Chat } from "../../src/chat/chat.svelte.ts";
import { ChatSerializer } from "../../src/chat/chat-serializer.ts";
import { useRecording } from "../use-recording.ts";
import superjson from "superjson";
import type { AIAccount } from "../../src/settings/settings.ts";
import { invariant } from "@epic-web/invariant";

// fixme: not using har in CI
describe.skipIf(process.env.CI)("Chat", () => {
  useRecording();

  let chat: Chat;

  beforeEach(async () => {

    await helpers.reset()

    const agentFile = await vault.create("agents/test.agent", "");
    const chatFile = await vault.create(
      "chats/test.chat",
      superjson.stringify(ChatSerializer.INITIAL_DATA),
    );

    chat = new Chat(
      chatFile.path,
      ChatSerializer.parse(await vault.read(chatFile)),
    );
    chat.options.agentPath = agentFile.path;

    const modelId = "claude-4-sonnet-20250514";
    const account: AIAccount = {
      id: modelId,
      name: "Anthropic",
      provider: "anthropic",
      config: {
        apiKey: process.env.VITE_ANTHROPIC_API_KEY || "dummy-key-for-testing",
      },
    };
    plugin.settings.accounts.push(account);
    chat.options.accountId = account.id;
    chat.options.modelId = modelId;
  });

  it("should submit content with no attachments", async () => {
    await chat.submit(
      "What is the meaning of life? Answer with numerals only.",
      [],
    );
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[0].role).toEqual("system");
    expect(chat.messages[1].role).toEqual("user");
    expect(chat.messages[2].role).toEqual("assistant");
    invariant(chat.messages[2].parts[1].type === "text", "Expected text part");
    expect(chat.messages[2].parts[1].text).toEqual("42");
  });

  it("should submit content with attachments", async () => {
    const attachment = await vault.create(
      "meaning.txt",
      "The meaning of life is 420",
    );
    await chat.submit(
      "What is the meaning of life? Answer with numerals only.",
      [attachment.path],
    );
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[0].role).toEqual("system");
    expect(chat.messages[1].role).toEqual("user");
    expect(chat.messages[2].role).toEqual("assistant");
    invariant(chat.messages[2].parts[1].type === "text", "Expected text part");
    expect(chat.messages[2].parts[1].text).toEqual("420");
  });

  it("should edit user message and regenerate response", async () => {
    await chat.submit("What is 2+2?", []);
    expect(chat.messages).toHaveLength(3);

    // Edit the user message
    await chat.edit(1, "What is 3+3? Answer with numeral only.", []);

    // Should still have 3 messages (system, edited user, new assistant)
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[1].role).toEqual("user");
    invariant(chat.messages[1].parts[0].type === "text", "Expected text part");
    expect(chat.messages[1].parts[0].text).toEqual("What is 3+3? Answer with numeral only.");
    expect(chat.messages[2].role).toEqual("assistant");
    invariant(chat.messages[2].parts[1].type === "text", "Expected text part");
    expect(chat.messages[2].parts[1].text).toEqual("6");
  });

  it("should regenerate response from user message", async () => {
    await chat.submit("What is 4+4? Answer with numeral only.", []);
    expect(chat.messages).toHaveLength(3);

    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[1].role).toEqual("user");
    invariant(chat.messages[1].parts[0].type === "text", "Expected text part");
    expect(chat.messages[1].parts[0].text).toEqual("What is 4+4? Answer with numeral only.");
    expect(chat.messages[2].role).toEqual("assistant");
    invariant(chat.messages[2].parts[1].type === "text", "Expected text part");
    expect(chat.messages[2].parts[1].text).toEqual("8");

    // Regenerate from the user message
    await chat.regenerate(1);

    // Should still have 3 messages but potentially different response
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[1].role).toEqual("user");
    invariant(chat.messages[1].parts[0].type === "text", "Expected text part");
    expect(chat.messages[1].parts[0].text).toEqual("What is 4+4? Answer with numeral only.");
    expect(chat.messages[2].role).toEqual("assistant");
    invariant(chat.messages[2].parts[1].type === "text", "Expected text part");
    expect(chat.messages[2].parts[1].text).toEqual("8");
  });

  it("should load and cache chat instances", async () => {
    const chatFile = await vault.create(
      "chats/cached-test.chat",
      superjson.stringify(ChatSerializer.INITIAL_DATA),
    );

    // First load should create new instance
    const chat1 = await Chat.load(chatFile.path);
    expect(chat1).toBeDefined();
    expect(chat1.path).toEqual(chatFile.path);

    // Second load should return cached instance
    const chat2 = await Chat.load(chatFile.path);
    expect(chat2).toBe(chat1); // Same instance

    // Verify it's the same object reference
    expect(chat1 === chat2).toBeTruthy();
  });

  it("should apply system message and tools from agent file", async () => {
    const agentContent = `---
tools: [[Read]]
agent_name: Test
---
You are a helpful assistant named {{ agent_name }}.`;

    await vault.modify(
      vault.getFileByPath(chat.options.agentPath!),
      agentContent,
    );

    // Apply system message
    await chat.applySystemMessage();

    // Should have system message as first message
    expect(chat.messages).toHaveLength(1);
    invariant(chat.messages[0].role === "system", "Expected system message");
    invariant(chat.messages[0].parts[0].type === "text", "Expected text part");
    expect(chat.messages[0].parts[0].text).toContain("You are a helpful assistant named test.");
    expect(chat.messages[0].metadata.agentPath).toEqual(chat.options.agentPath);
  });
});
