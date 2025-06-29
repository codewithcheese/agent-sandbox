// mocks
import { plugin, vault } from "../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { Chat } from "../../src/chat/chat.svelte.ts";
import { ChatSerializer } from "../../src/chat/chat-serializer.ts";
import { useRecording } from "../use-recording.ts";
import superjson from "superjson";
import type { AIAccount } from "../../src/settings/settings.ts";
import { invariant } from "@epic-web/invariant";

describe("Chat", () => {
  useRecording();

  let chat: Chat;

  beforeEach(async () => {
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
    invariant(chat.messages[2].parts[0].type === "text", "Expected text part");
    expect(chat.messages[2].parts[0].text).toEqual("42");
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
    invariant(chat.messages[2].parts[0].type === "text", "Expected text part");
    expect(chat.messages[2].parts[0].text).toEqual("420");
  });
});
