import { z } from "zod";
import type {
  ToolDefinition,
  ToolCallOptionsWithContext,
  LocalToolDefinition,
} from "./types.ts";
import { Agent } from "../agent/agent.ts";
import { AgentRunner } from "../agent/agent-runner.svelte.ts";
import type { UIMessageWithMetadata } from "../chat/chat.svelte.ts";
import { nanoid } from "nanoid";
import { usePlugin } from "$lib/utils";
import { createDebug } from "$lib/debug.ts";
import { getTextFromParts } from "$lib/utils/ai.ts";
import type { ToolUIPart } from "ai";
import type { VaultOverlay } from "../chat/vault-overlay.svelte.ts";

const debug = createDebug();

// Define the UI tool type for the agent tool
type AgentUITool = {
  input: {
    agent_path: string;
    description: string;
    prompt: string;
    fresh_context: boolean;
    account_id?: string;
    model_id?: string;
  };
  output:
    | {
        response: string;
        messageCount: number;
        agentName: string;
      }
    | {
        error: string;
        message?: string;
      };
};

type AgentToolUIPart = ToolUIPart<{ Agent: AgentUITool }>;

const TOOL_NAME = "Agent";
const TOOL_DESCRIPTION = "Run a subagent with a specific task";
const TOOL_PROMPT_GUIDANCE = `Run a subagent to handle a specific task or subtask.

This tool allows you to delegate work to specialized agents that have their own instructions and tools.

Usage:
- Provide the path to an agent file in the vault
- Describe what you want the agent to do
- Provide a specific prompt or task
- Choose whether to start fresh or inherit the current conversation context
- Optionally specify account and model (defaults to plugin settings)

The agent will run to completion and return its final response.`;

const inputSchema = z.strictObject({
  agent_path: z
    .string()
    .describe("Path to the agent file (e.g., /agents/researcher.md)"),
  description: z
    .string()
    .describe("Brief description of what the agent should do"),
  prompt: z.string().describe("The task or prompt for the agent"),
  fresh_context: z
    .boolean()
    .default(true)
    .describe(
      "Start with fresh context (true) or inherit current conversation",
    ),
  account_id: z
    .string()
    .optional()
    .describe("Account ID to use (defaults to plugin default)"),
  model_id: z
    .string()
    .optional()
    .describe("Model ID to use (defaults to plugin default)"),
});

async function execute(
  params: z.infer<typeof inputSchema>,
  options: ToolCallOptionsWithContext,
) {
  const { abortSignal } = options;
  const { vault, sessionStore } = options.getContext();

  if (!vault) {
    throw new Error("Vault not available in execution context");
  }

  const plugin = usePlugin();

  // Determine account and model
  let accountId = params.account_id;
  let modelId = params.model_id;

  if (!accountId || !modelId) {
    // Use plugin defaults
    accountId = accountId || plugin.settings.defaults.accountId;
    modelId = modelId || plugin.settings.defaults.modelId;

    if (!accountId) {
      return {
        error: "Configuration error",
        message:
          "No account specified and no default account configured. Please specify an account_id or configure a default account in settings.",
      };
    }
    if (!modelId) {
      return {
        error: "Configuration error",
        message:
          "No model specified and no default model configured. Please specify a model_id or configure a default model in settings.",
      };
    }
  }

  // Find account
  const account = plugin.settings.accounts.find((a) => a.id === accountId);
  if (!account) {
    return {
      error: "Account not found",
      message: `Account "${accountId}" not found. Available accounts: ${plugin.settings.accounts.map((a) => a.id).join(", ") || "none"}`,
    };
  }

  // Create agent context
  const agentContext = {
    account,
    vault: vault as VaultOverlay,
    sessionStore,
    chatPath: "", // Subagent doesn't have a chat path
    options: {
      accountId: account.id,
      modelId: modelId!,
      maxSteps: 50,
      temperature: 0.7,
      thinkingEnabled: false,
      maxTokens: 4000,
      thinkingTokensBudget: 1024,
    },
  };

  // Load the agent
  let agent: Agent;
  try {
    agent = await Agent.fromFile(params.agent_path, agentContext);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Agent file not found")
    ) {
      return {
        error: "Agent file not found",
        message: `Agent file "${params.agent_path}" not found`,
      };
    }
    throw new Error(
      `Failed to load agent from ${params.agent_path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Create messages array
  const messages: UIMessageWithMetadata[] = [];

  // Add system message from agent
  const systemPrompt = await agent.getAgentPrompt(agentContext);
  messages.push({
    id: nanoid(),
    role: "system",
    parts: [{ type: "text", text: systemPrompt }],
    metadata: {
      createdAt: new Date(),
      agentPath: params.agent_path,
      agentModified: Date.now(),
    },
  });

  // Add user message with the task
  messages.push({
    id: nanoid(),
    role: "user",
    parts: [{ type: "text", text: params.prompt }],
    metadata: {
      createdAt: new Date(),
    },
  });

  // TODO: If fresh_context is false, we would need access to parent conversation
  // For now, we always start fresh

  // Create runner and execute
  const runner = new AgentRunner(messages, agentContext);

  try {
    await runner.run(agent, {
      signal: abortSignal,
      excludeTools: [TOOL_NAME], // Prevent recursion
      callbacks: {
        onStepFinish: async (step) => {
          debug("Agent step finished", step);
        },
      },
    });

    // Get the final assistant response
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const finalMessage = assistantMessages[assistantMessages.length - 1];

    if (!finalMessage) {
      throw new Error("No response from agent");
    }

    const finalResponse = getTextFromParts(finalMessage.parts);

    return {
      response: finalResponse,
      messageCount: messages.length,
      agentName: agent.name,
    };
  } catch (error) {
    debug("Agent execution error:", error);

    // Check for abort
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error; // Re-throw to mark as error not warning
    }

    return {
      error: "Agent execution failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const agentTool: LocalToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: AgentToolUIPart) => {
    const { state, input } = toolPart;

    // During input streaming/available, show basic info
    if (state === "input-streaming" || state === "input-available") {
      return {
        title: "Agent",
        path: input?.agent_path,
        context: input?.description || "Running...",
      };
    }

    // After completion, show results
    if (state === "output-available") {
      const { output } = toolPart;

      if (output && "response" in output) {
        // Success case
        const { agentName, messageCount } = output;

        return {
          title: `Agent: ${agentName}`,
          path: input?.agent_path,
          context: input?.description,
          lines: `${messageCount} messages`,
        };
      } else if (output && "error" in output) {
        // Error case
        return {
          title: "Agent",
          path: input?.agent_path,
          context: output.message || output.error,
          error: true,
        };
      }
    }

    // Error state
    if (state === "output-error") {
      return {
        title: "Agent",
        path: input?.agent_path,
        context: toolPart.errorText || "Failed",
        error: true,
      };
    }

    return null;
  },
};
