import {
  convertToModelMessages,
  type ModelMessage,
  streamText,
  stepCountIs,
  wrapLanguageModel,
  extractReasoningMiddleware,
  type StepResult,
  type Tool,
} from "ai";
import type { UIMessageWithMetadata } from "./chat.svelte.ts";
import type { AgentContext, Agent } from "./Agent.ts";
import { createAIProvider } from "../settings/providers.ts";
import { wrapTextAttachments } from "$lib/utils/messages.ts";
import { filterIncompleteToolParts } from "$lib/utils/ai.ts";
import {
  applyStreamPartToMessages,
  type StreamingState,
} from "$lib/utils/stream.ts";
import { createDebug } from "$lib/debug.ts";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";

const debug = createDebug();

export interface RunOptions {
  signal?: AbortSignal;
  callbacks?: RunCallbacks;
  retryConfig?: {
    maxAttempts?: number;
    retryDelay?: number;
  };
  excludeTools?: string[];
}

export interface RunCallbacks {
  onStepFinish?: (step:  StepResult<Record<string, Tool>>) => Promise<void>;
  onRetry?: (attempt: number, maxAttempts: number, delay: number) => void;
}

export class AgentRunner {
  constructor(
    private messages: UIMessageWithMetadata[],
    private context: AgentContext
  ) {}

  async run(agent: Agent, options: RunOptions = {}): Promise<void> {
    const {
      signal,
      callbacks,
      retryConfig = { maxAttempts: 3, retryDelay: 1000 },
      excludeTools = []
    } = options;

    const provider = createAIProvider(this.context.account);
    const modelId = this.context.options.modelId!;

    // Retry loop
    let attempt = 0;
    while (true) {
      try {
        debug("Submitting messages", $state.snapshot(this.messages));

        // Convert messages
        const messages: ModelMessage[] = [
          ...convertToModelMessages(
            wrapTextAttachments(
              filterIncompleteToolParts($state.snapshot(this.messages)),
            ),
          ).filter((m) => m.content.length > 0),
        ];

        // Add cache control for anthropic
        const systemMessage = messages.find((m) => m.role === "system");
        if (systemMessage) {
          systemMessage.providerOptions = {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          };
        }

        const lastAssistantMessage = messages.findLast(
          (m) => m.role === "assistant",
        );
        if (lastAssistantMessage) {
          lastAssistantMessage.providerOptions = {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          };
        }

        // Filter tools if needed
        const activeTools = Object.fromEntries(
          Object.entries(agent.tools).filter(([name]) => !excludeTools.includes(name))
        );

        debug("Core messages", messages);
        debug("Active tools", activeTools);

        // Stream the conversation
        const stream = streamText({
          model:
            this.context.account.provider === "fireworks"
              ? wrapLanguageModel({
                  model: provider.languageModel(modelId),
                  middleware: extractReasoningMiddleware({ tagName: "think" }),
                })
              : provider.languageModel(modelId),
          messages,
          tools: Object.keys(activeTools).length > 0 ? activeTools : undefined,
          maxRetries: 0,
          stopWhen: stepCountIs(this.context.options.maxSteps),
          temperature: this.context.options.temperature,
          providerOptions: {
            anthropic: {
              ...(this.context.options.thinkingEnabled
                ? {
                    thinking: {
                      type: "enabled",
                      budgetTokens: this.context.options.thinkingTokensBudget,
                    },
                  }
                : {}),
            } satisfies AnthropicProviderOptions,
            openai: {
              reasoningEffort: modelId.includes("deep-research")
                ? "medium"
                : "high",
              reasoningSummary: "detailed",
              strictSchemas: false,
            } satisfies OpenAIResponsesProviderOptions,
            google: {
              thinkingConfig: {
                includeThoughts: true,
              },
            } satisfies GoogleGenerativeAIProviderOptions,
          },
          abortSignal: signal,
          onStepFinish: async (step) => {
            debug("Step finish", step);

            // Find the last assistant message to add step metadata
            const lastAssistantMessage = this.messages.findLast(
              (m) => m.role === "assistant",
            );

            if (lastAssistantMessage) {
              // Initialize steps array if it doesn't exist
              if (!lastAssistantMessage.metadata.steps) {
                lastAssistantMessage.metadata.steps = [];
              }

              // Add step metadata to the array
              lastAssistantMessage.metadata.steps.push({
                usage: step.usage,
                finishReason: step.finishReason,
                stepIndex: lastAssistantMessage.metadata.steps.length,
              });
            }

            step.toolCalls.forEach((toolCall) => {
              debug("Tool call", toolCall);
            });
            step.toolResults.forEach((toolResult) => {
              debug("Tool result", toolResult);
            });

            // Call user callback
            await callbacks?.onStepFinish?.(step);
          },
          onFinish: async (result) => {
            // Find the last assistant message that was created during streaming
            const lastAssistantMessage = this.messages.findLast(
              (m) => m.role === "assistant",
            );

            if (lastAssistantMessage) {
              // Attach account and model information to the assistant message
              lastAssistantMessage.metadata = {
                ...lastAssistantMessage.metadata,
                finishReason: result.finishReason,
                accountId: this.context.account.id,
                accountName: this.context.account.name,
                provider: this.context.account.provider,
                modelId: modelId,
              };
            }

            debug(
              "Finished",
              result.finishReason,
              $state.snapshot(this.messages),
            );
          },
        });

        // As we receive partial tokens, we apply them to `this.messages`
        const streamingState: StreamingState = {
          toolCalls: {},
          activeTextParts: {},
          activeReasoningParts: {},
        };
        for await (const part of stream.fullStream) {
          applyStreamPartToMessages(this.messages, part, streamingState);
        }

        debug("Finished streaming", $state.snapshot(this.messages));
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
}
