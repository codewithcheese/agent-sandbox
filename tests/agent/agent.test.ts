// mocks
import { helpers, plugin, vault } from "../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { Agent } from "../../src/agent/agent.ts";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { SessionStore } from "../../src/chat/session-store.svelte.ts";
import type { AIAccount } from "../../src/settings/settings.ts";
import type { AgentContext } from "../../src/agent/agent.ts";
import { MetadataCacheOverlay } from "../../src/chat/metadata-cache-overlay.ts";
import type { MetadataCache } from "obsidian";

describe("Agent", () => {
  let context: AgentContext;

  beforeEach(async () => {
    await helpers.reset();

    const account: AIAccount = {
      id: "test-account",
      name: "Test Provider",
      provider: "anthropic",
      config: {
        apiKey: "test-key",
      },
    };

    const overlay = new VaultOverlay(vault);
    const sessionStore = new SessionStore(overlay);

    plugin.app.metadataCache = new MetadataCacheOverlay(
      overlay,
      plugin.app.metadataCache,
    );

    context = {
      account,
      vault: overlay,
      sessionStore,
      chatPath: "test-chat.chat",
      options: {
        maxSteps: 10,
        temperature: 0.7,
        thinkingEnabled: false,
        maxTokens: 1000,
        thinkingTokensBudget: 512,
        modelId: "claude-3-sonnet",
        accountId: "test-account",
      },
    };
  });

  it("should load agent from file with frontmatter configuration", async () => {
    const toolContent = `---
import: read
---
You can read a file.`;

    await vault.create("tools/Read.md", toolContent);

    const agentContent = `---
name: Test Agent
model: claude-3-haiku
temperature: 0.5
maxTokens: 2000
maxSteps: 20
thinkingEnabled: true
thinkingTokensBudget: 1024
tools: 
  - "[[Read]]"
agent_name: TestBot
---
You are a helpful assistant named {{ agent_name }}.
Your job is to help users with their tasks.`;

    const agentFile = await vault.create("agents/test.agent", agentContent);

    const agent = await Agent.fromFile(agentFile.path, context);

    expect(agent).toBeDefined();
    expect(agent.tools).toBeDefined();

    // Test that agent prompt is generated correctly
    const prompt = await agent.getAgentPrompt(context);
    expect(prompt).toContain("You are a helpful assistant named TestBot.");
    expect(prompt).toContain("Your job is to help users with their tasks.");
    expect(prompt).not.toContain("{{ agent_name }}"); // Template should be processed
  });

  it("should throw error when agent file not found", async () => {
    await expect(
      Agent.fromFile("non-existent-agent.agent", context),
    ).rejects.toThrow("Agent file not found: non-existent-agent.agent");
  });

  it("should use fallback values when frontmatter is missing", async () => {
    const agentContent = `You are a basic assistant.`;

    const agentFile = await vault.create("agents/basic.agent", agentContent);

    const agent = await Agent.fromFile(agentFile.path, context);

    expect(agent).toBeDefined();

    const prompt = await agent.getAgentPrompt(context);
    expect(prompt).toContain("You are a basic assistant.");
  });
});
