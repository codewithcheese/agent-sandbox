import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import type { UIMessageWithMetadata } from "../chat/chat.svelte.ts";
import type { AgentContext, Agent } from "./agent.ts";
import type { RunOptions, RunCallbacks } from "./types.ts";
import { createDebug } from "$lib/debug.ts";
import { convertClaudeCodeMessageToUI } from "./claude-code-utils.ts";

const debug = createDebug();

export class ClaudeCodeRunner {
  constructor(
    private messages: UIMessageWithMetadata[],
    private context: AgentContext
  ) {}

  async run(agent: Agent, options: RunOptions = {}): Promise<void> {
    const {
      signal,
      callbacks,
      retryConfig = { maxAttempts: 3, retryDelay: 1000 }
    } = options;

    // Retry loop
    let attempt = 0;
    while (true) {
      try {
        debug("Starting Claude Code conversation", { agentName: agent.name });

        // Get system prompt from agent
        const systemPrompt = await agent.getAgentPrompt(this.context);

        // Run the conversation with Claude Code SDK
        const conversationMessages: SDKMessage[] = [];

        for await (const message of query({
          prompt: this.getLastUserPrompt(),
          options: {
            customSystemPrompt: systemPrompt,
            maxTurns: this.context.options.maxSteps,
            // Note: Claude Code SDK doesn't use traditional tools like AI SDK
            // We're starting without tool support as specified
          }
        })) {
          conversationMessages.push(message);

          // Convert and apply the message to UI
          const uiMessage = convertClaudeCodeMessageToUI(
            message,
            this.context.account.id,
            this.context.account.name,
            this.context.account.provider,
            this.context.options.modelId || "claude-3-sonnet"
          );
          
          if (uiMessage) {
            this.messages.push(uiMessage);
          }

          // Call step finish callback if provided
          await callbacks?.onStepFinish?.(message);
        }

        debug("Claude Code conversation completed", { messageCount: conversationMessages.length });
        return;

      } catch (error: any) {
        // Handle abort
        if (error instanceof DOMException && error.name === "AbortError") {
          debug("Request aborted by user");
          throw error;
        }

        // Handle rate limit with retry
        if (error.statusCode === 429) {
          attempt++;
          if (attempt > retryConfig.maxAttempts!) {
            throw error;
          }

          const delay = error.responseHeaders?.["retry-after"]
            ? parseInt(error.responseHeaders["retry-after"]) * 1000
            : retryConfig.retryDelay!;

          debug(
            `Rate limited (429). Retrying in ${delay / 1000} seconds... (Attempt ${attempt} of ${retryConfig.maxAttempts})`,
          );

          callbacks?.onRetry?.(attempt, retryConfig.maxAttempts!, delay);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Other errors bubble up
        throw error;
      }
    }
  }

  private getLastUserPrompt(): string {
    // Find the last user message for the initial prompt
    const lastUserMessage = this.messages
      .filter(m => m.role === "user")
      .pop();

    if (!lastUserMessage) {
      return "Hello";
    }

    return lastUserMessage.parts
      .filter(part => part.type === "text")
      .map(part => part.text)
      .join("\n");
  }
}
