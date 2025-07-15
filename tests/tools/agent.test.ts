import { describe, it, expect, beforeEach } from "vitest";
import { agentTool } from "../../src/tools/agent.ts";
import {
  vault as mockVault,
  helpers as mockVaultHelpers,
  metadataCache,
  plugin,
} from "../mocks/obsidian";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import type { ToolCallOptionsWithContext } from "../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";
import { SessionStore } from "../../src/chat/session-store.svelte.ts";
import type { AIAccount } from "../../src/settings/settings.ts";
import { useRecording } from "../use-recording.ts";

// Skip tests in CI since we don't have API access
describe.skipIf(process.env.CI)("Agent tool", () => {
  useRecording();

  let toolExecOptions: ToolCallOptionsWithContext;
  let vault: VaultOverlay;
  let sessionStore: SessionStore;

  const mockAccount: AIAccount = {
    id: "test-account",
    name: "Test Account",
    provider: "anthropic",
    config: {
      apiKey: process.env.VITE_ANTHROPIC_API_KEY || "dummy-key-for-testing",
    },
  };

  beforeEach(async () => {
    await mockVaultHelpers.reset();

    vault = new VaultOverlay(mockVault);
    sessionStore = new SessionStore(vault);

    // Setup plugin defaults
    plugin.settings.defaults = {
      accountId: "test-account",
      modelId: "claude-3-haiku-20240307",
    };
    plugin.settings.accounts = [mockAccount];

    toolExecOptions = {
      toolCallId: "test-agent-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        config: {},
        sessionStore,
        metadataCache,
      }),
      abortSignal: new AbortController().signal,
    };
  });

  it("should return error when agent file not found", async () => {
    const params = {
      agent_path: "/agents/nonexistent.md",
      description: "Test agent",
      prompt: "Hello world",
      fresh_context: true,
    };

    const result = await agentTool.execute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object"
    );
    expect(result.error).toBe("Agent file not found");
    expect(result.message).toContain(`Agent file "${params.agent_path}" not found`);
  });

  it("should execute simple echo agent successfully", async () => {
    const agentContent = `---
name: Echo Agent
tools: []
---
You are an echo agent. Simply repeat back exactly what the user says, nothing more.`;

    await mockVault.create("/agents/echo.md", agentContent);

    const params = {
      agent_path: "/agents/echo.md",
      description: "Echo agent",
      prompt: "Hello world",
      fresh_context: true,
    };

    const result = await agentTool.execute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "response" in result,
      "Expected success object"
    );
    expect(result.response).toContain("Hello world");
    expect(result.agentName).toBe("Echo Agent");
    expect(result.messageCount).toBe(3); // system + user + assistant
  });

  it("should work with agent that has tools but excludes Agent tool", async () => {
    const agentContent = `---
name: Tool Agent
tools: 
  - "[[Read]]"
---
You are an agent that can use tools. If asked to read a file, use the Read tool.`;

    await mockVault.create("/agents/tool-agent.md", agentContent);

    // Create a Read tool
    await mockVault.create("/tools/Read.md", `---
import: read
---
Read files from the vault.`);

    // Create a test file to read
    await mockVault.create("/test.txt", "This is test content.");

    const params = {
      agent_path: "/agents/tool-agent.md",
      description: "Agent with tools",
      prompt: "Please read the file /test.txt and tell me what it contains.",
      fresh_context: true,
    };

    const result = await agentTool.execute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "response" in result,
      "Expected success object"
    );
    expect(result.response).toContain("test content");
    expect(result.agentName).toBe("Tool Agent");
  });

  it("should return error when no default account configured", async () => {
    // Remove default account
    plugin.settings.defaults.accountId = undefined;

    const agentContent = `---
name: Test Agent
---
You are a helpful assistant.`;

    await mockVault.create("/agents/test.md", agentContent);

    const params = {
      agent_path: "/agents/test.md",
      description: "Test agent",
      prompt: "Hello world",
      fresh_context: true,
    };

    const result = await agentTool.execute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object"
    );
    expect(result.error).toBe("Configuration error");
    expect(result.message).toContain("No account specified and no default account configured");
  });

  it("should return error when specified account not found", async () => {
    const agentContent = `---
name: Test Agent
---
You are a helpful assistant.`;

    await mockVault.create("/agents/test.md", agentContent);

    const params = {
      agent_path: "/agents/test.md",
      description: "Test agent",
      prompt: "Hello world",
      fresh_context: true,
      account_id: "nonexistent-account",
    };

    const result = await agentTool.execute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object"
    );
    expect(result.error).toBe("Account not found");
    expect(result.message).toContain("Account \"nonexistent-account\" not found");
  });

  it("should handle agent with custom model settings", async () => {
    const agentContent = `---
name: Custom Agent
temperature: 0.1
maxTokens: 100
tools: []
---
You are a very precise agent. Answer with exactly one word: "precise".`;

    await mockVault.create("/agents/custom.md", agentContent);

    const params = {
      agent_path: "/agents/custom.md",
      description: "Custom configured agent",
      prompt: "How would you describe yourself?",
      fresh_context: true,
    };

    const result = await agentTool.execute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "response" in result,
      "Expected success object"
    );
    expect(result.response.toLowerCase()).toContain("precise");
    expect(result.agentName).toBe("Custom Agent");
  });
});
