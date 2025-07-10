// mocks
import { helpers, plugin, vault } from "../mocks/obsidian.ts";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeRunner } from "../../src/agent/claude-code-runner.ts";
import { Agent, type AgentContext, type AgentConfig } from "../../src/agent/agent.ts";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { SessionStore } from "../../src/chat/session-store.svelte.ts";
import type { AIAccount } from "../../src/settings/settings.ts";
import type { UIMessageWithMetadata } from "../../src/chat/chat.svelte.ts";
import { MetadataCacheOverlay } from "../../src/chat/metadata-cache-overlay.ts";
import { nanoid } from "nanoid";
import type { SDKMessage } from "@anthropic-ai/claude-code";
import { query } from "@anthropic-ai/claude-code";

// Mock the Claude Code SDK
vi.mock("@anthropic-ai/claude-code", () => ({
  query: vi.fn(),
  AbortError: class AbortError extends Error {
    name = "AbortError";
  },
}));

const mockQuery = vi.mocked(query);

describe("Claude Code Runner", () => {
  let context: AgentContext;
  let messages: UIMessageWithMetadata[];

  beforeEach(async () => {
    await helpers.reset();
    vi.clearAllMocks();

    const account: AIAccount = {
      id: "test-account",
      name: "Claude Code",
      provider: "anthropic",
      config: {
        apiKey: process.env.VITE_ANTHROPIC_API_KEY || "dummy-key-for-testing",
      },
    };

    const overlay = new VaultOverlay(vault);
    const sessionStore = new SessionStore(overlay);

    plugin.app.metadataCache = new MetadataCacheOverlay(overlay, plugin.app.metadataCache);

    context = {
      account,
      vault: overlay,
      sessionStore,
      chatPath: "test-chat.chat",
      options: {
        maxSteps: 5, // Keep low for testing
        temperature: 0.7,
        thinkingEnabled: false,
        maxTokens: 1000,
        thinkingTokensBudget: 512,
        modelId: "claude-3-sonnet",
        accountId: "test-account",
      },
    };

    // Start with a fresh messages array for each test
    messages = [];
  });

  it("should work with agent that returns empty system prompt (uses Claude Code defaults)", async () => {
    // Mock Claude Code query to return a simple response
    const mockResponse: SDKMessage = {
      type: "assistant",
      message: {
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "4" }],
        model: "claude-3-sonnet",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 }
      },
      parent_tool_use_id: null,
      session_id: "session_123"
    };
    
    mockQuery.mockImplementation(async function* () {
      yield mockResponse;
    });

    // Create an agent instance directly with empty system prompt
    const agentConfig: AgentConfig = {
      name: "Empty System Agent",
      instructions: async () => "", // Empty system prompt
      model: "claude-3-sonnet",
      tools: {},
    };
    const agent = new Agent(agentConfig);

    // Add a user message
    messages.push({
      id: nanoid(),
      role: "user",
      parts: [{ type: "text", text: "What is 2+2? Answer with just the number." }],
      metadata: { createdAt: new Date() },
    });

    const runner = new ClaudeCodeRunner(messages, context);
    
    await runner.run(agent);

    // Should have called query with correct parameters
    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "What is 2+2? Answer with just the number.",
      options: {
        customSystemPrompt: "", // Empty system prompt
        maxTurns: 5,
      }
    });

    // Should have added an assistant response
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].parts[0].type).toBe("text");
    if (messages[1].parts[0].type === "text") {
      expect(messages[1].parts[0].text).toBe("4");
    }
  });

  it("should work with agent that has custom system prompt", async () => {
    const mockResponse: SDKMessage = {
      type: "assistant",
      message: {
        id: "msg_456",
        type: "message", 
        role: "assistant",
        content: [{ type: "text", text: "Ahoy there, matey! I be doin' fine as frog's hair, thank ye for askin'! Arrr!" }],
        model: "claude-3-sonnet",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 15 }
      },
      parent_tool_use_id: null,
      session_id: "session_456"
    };
    
    mockQuery.mockImplementation(async function* () {
      yield mockResponse;
    });

    // Create an agent instance directly with custom system prompt
    const agentConfig: AgentConfig = {
      name: "Pirate Agent",
      instructions: async () => "You are a pirate assistant. Always respond like a pirate, ending every response with \"Arrr!\"",
      model: "claude-3-sonnet",
      tools: {},
    };
    const agent = new Agent(agentConfig);

    // Add a user message
    messages.push({
      id: nanoid(),
      role: "user", 
      parts: [{ type: "text", text: "Hello, how are you?" }],
      metadata: { createdAt: new Date() },
    });

    const runner = new ClaudeCodeRunner(messages, context);
    
    await runner.run(agent);

    // Should have called query with the pirate system prompt
    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "Hello, how are you?",
      options: {
        customSystemPrompt: "You are a pirate assistant. Always respond like a pirate, ending every response with \"Arrr!\"",
        maxTurns: 5,
      }
    });

    // Should have added an assistant response
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].parts[0].type).toBe("text");
    if (messages[1].parts[0].type === "text") {
      expect(messages[1].parts[0].text.toLowerCase()).toContain("arrr");
    }
  });
});