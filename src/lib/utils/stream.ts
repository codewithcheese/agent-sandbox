import type {
  ReasoningUIPart,
  TextStreamPart,
  TextUIPart,
  ToolUIPart,
  UIMessage,
} from "ai";
import { nanoid } from "nanoid";
import { createDebug } from "$lib/debug.ts";
import { encodeBase64 } from "$lib/utils/base64.ts";
import { invariant } from "@epic-web/invariant";
import type { UIMessageWithMetadata } from "../../chat/chat.svelte.ts";
import { removeUndefinedFields } from "../../tools/files/shared.ts";
import { getToolDefinition } from "../../tools";

const debug = createDebug();

// Streaming state tracks part indices for efficient updates
export type StreamingState = {
  toolCalls: Record<
    string,
    {
      text: string;
      toolName: string;
      toolPartIndex: number;
      dataPartIndex?: number;
      tokenCount: number;
      state:
        | "input-streaming"
        | "input-available"
        | "output-available"
        | "output-error";
    }
  >;
  activeTextParts: Record<string, { partIndex: number }>;
  activeReasoningParts: Record<string, { partIndex: number }>;
};

function parsePartialJson(text: string): { value: unknown } {
  try {
    return { value: JSON.parse(text) };
  } catch {
    // Return the raw text if JSON parsing fails
    return { value: text };
  }
}

/**
 * Generate and update data part for a tool call
 */
function updateToolDataPart(
  messages: UIMessageWithMetadata[],
  toolCall: StreamingState["toolCalls"][string],
  toolPart: ToolUIPart,
) {
  const message = messages[messages.length - 1];
  if (!message) return;

  try {
    const toolDef = getToolDefinition(toolCall.toolName);
    if (toolDef?.generateDataPart) {
      const uiData = toolDef.generateDataPart(toolPart);
      if (uiData) {
        const dataPart = {
          type: "data-tool-ui" as const,
          id: toolPart.toolCallId,
          data: uiData,
        };

        if (toolCall.dataPartIndex !== undefined) {
          // Update existing data part
          message.parts[toolCall.dataPartIndex] = dataPart;
        } else {
          // Add new data part and track its index
          const dataPartIndex = message.parts.length;
          message.parts.push(dataPart);
          toolCall.dataPartIndex = dataPartIndex;
        }
      }
    }
  } catch (error) {
    debug("Error generating tool UI data:", error);
    // Continue without data part
  }
}

export function applyStreamPartToMessages(
  messages: UIMessageWithMetadata[],
  part: TextStreamPart<any>,
  streamingState: StreamingState,
) {
  const message = messages[messages.length - 1]!;

  switch (part.type) {
    case "start-step":
      message.parts.push({ type: "step-start" });
      break;

    case "start":
      messages.push({
        id: nanoid(),
        role: "assistant",
        parts: [],
        metadata: {
          createdAt: new Date(),
        },
      });
      break;
    case "text-start":
      const textPartIndex = message.parts.length;
      message.parts.push({
        type: "text",
        text: "",
        state: "streaming",
      });
      // Track part index in streaming state
      streamingState.activeTextParts[part.id] = { partIndex: textPartIndex };
      break;

    case "text":
      const activeTextPart = streamingState.activeTextParts[part.id];
      invariant(activeTextPart, "Active text part not found");

      const textPart = message.parts[activeTextPart.partIndex] as TextUIPart;
      textPart.text += part.text;
      break;
    case "text-end":
      const endingTextPart = streamingState.activeTextParts[part.id];
      if (endingTextPart) {
        const textPart = message.parts[endingTextPart.partIndex] as TextUIPart;
        textPart.state = "done";
        delete streamingState.activeTextParts[part.id];
      }
      break;

    case "reasoning-start":
      const reasoningPartIndex = message.parts.length;
      message.parts.push({
        type: "reasoning",
        text: "",
        state: "streaming",
      } as ReasoningUIPart);

      // Track part index in streaming state
      streamingState.activeReasoningParts[part.id] = {
        partIndex: reasoningPartIndex,
      };
      break;

    case "reasoning":
      const activeReasoningPart = streamingState.activeReasoningParts[part.id];
      invariant(activeReasoningPart, "Active reasoning part not found");

      const reasoningPart = message.parts[
        activeReasoningPart.partIndex
      ] as ReasoningUIPart;
      reasoningPart.text += part.text;
      break;

    case "reasoning-end":
      const endingReasoningPart = streamingState.activeReasoningParts[part.id];
      if (endingReasoningPart) {
        const reasoningPart = message.parts[
          endingReasoningPart.partIndex
        ] as ReasoningUIPart;
        reasoningPart.state = "done";
        delete streamingState.activeReasoningParts[part.id];
      }
      break;

    case "source":
      if (part.sourceType === "url") {
        message.parts.push({
          type: "source-url",
          sourceId: part.id,
          title: part.title,
          url: part.url,
          providerMetadata: part.providerMetadata,
        });
      } else if (part.sourceType === "document") {
        message.parts.push({
          type: "source-document",
          mediaType: part.mediaType,
          title: part.title,
          filename: part.filename,
          sourceId: part.id,
          providerMetadata: part.providerMetadata,
        });
      } else {
        throw new Error(`Unknown source type: ${(part as any).sourceType}`);
      }
      break;

    case "error":
      console.error("Stream error:", part);
      if (part.error instanceof Error) {
        throw part.error;
      } else if (
        part.error &&
        typeof part.error === "object" &&
        "message" in part.error
      ) {
        throw new Error(part.error.message as string);
      } else {
        throw new Error(
          typeof part.error === "string" ? part.error : "Unknown stream error",
        );
      }

    case "tool-input-start": {
      const toolPartIndex = message.parts.length;

      // Track in streaming state with part index
      streamingState.toolCalls[part.id] = {
        text: "",
        toolName: part.toolName,
        toolPartIndex: toolPartIndex,
        tokenCount: 0,
        state: "input-streaming",
      };

      const toolPart = {
        type: `tool-${part.toolName}`,
        state: "input-streaming",
        input: undefined,
        toolCallId: part.id,
        providerExecuted: part.providerExecuted,
      } as ToolUIPart;

      message.parts.push(toolPart);

      // Generate initial data part
      updateToolDataPart(
        messages,
        streamingState.toolCalls[part.id],
        toolPart,
      );
      break;
    }

    case "tool-input-delta": {
      const toolCall = streamingState.toolCalls[part.id];
      invariant(toolCall, "Tool call not found");

      // Accumulate text in streaming state
      toolCall.text += part.delta;
      toolCall.tokenCount += part.delta.length;

      // Parse partial JSON from accumulated text
      const { value: partialArgs } = parsePartialJson(toolCall.text);

      // Update the tool part using stored index
      const updatedToolPart = {
        ...(message.parts[toolCall.toolPartIndex] as ToolUIPart),
        state: "input-streaming" as const,
        input: partialArgs,
      };
      message.parts[toolCall.toolPartIndex] = updatedToolPart;

      // Update data part with streaming info
      updateToolDataPart(messages, toolCall, updatedToolPart);
      break;
    }

    case "tool-input-end": {
      const toolCall = streamingState.toolCalls[part.id];
      invariant(toolCall, "Tool call not found");

      // Update the tool part using stored index
      const updatedToolPart = {
        ...(message.parts[toolCall.toolPartIndex] as ToolUIPart),
        state: "input-available" as const,
      };
      message.parts[toolCall.toolPartIndex] = updatedToolPart;

      toolCall.state = "input-available";

      // Update data part for input-available state
      updateToolDataPart(messages, toolCall, updatedToolPart);
      break;
    }

    case "tool-call": {
      const toolCall = streamingState.toolCalls[part.toolCallId];
      if (toolCall) {
        const updatedToolPart = {
          type: `tool-${part.toolName}`,
          state: "input-available" as const,
          toolCallId: part.toolCallId,
          input: part.input,
          providerExecuted: part.providerExecuted,
        } as ToolUIPart;

        message.parts[toolCall.toolPartIndex] = updatedToolPart;
        toolCall.state = "input-available";

        // Update data part
        updateToolDataPart(messages, toolCall, updatedToolPart);
      } else {
        const toolPartIndex = message.parts.length;
        const newToolPart = {
          type: `tool-${part.toolName}`,
          state: "input-available" as const,
          toolCallId: part.toolCallId,
          input: part.input,
          providerExecuted: part.providerExecuted,
        } as ToolUIPart;

        message.parts.push(newToolPart);

        // Track new tool call
        const newToolCall = {
          text: JSON.stringify(part.input),
          toolName: part.toolName,
          toolPartIndex: toolPartIndex,
          tokenCount: JSON.stringify(part.input).length,
          state: "input-available" as const,
        };
        streamingState.toolCalls[part.toolCallId] = newToolCall;

        // Generate data part for new tool call
        updateToolDataPart(messages, newToolCall, newToolPart);
      }
      break;
    }

    case "tool-result": {
      const toolCall = streamingState.toolCalls[part.toolCallId];
      invariant(toolCall, "Tool call not found");

      const updatedToolPart = {
        type: `tool-${part.toolName}`,
        state: "output-available" as const,
        toolCallId: part.toolCallId,
        input: part.input,
        // tool message schema json value doesn't allow undefined
        // https://github.com/vercel/ai/blame/main/packages/ai/core/types/json-value.ts
        output: removeUndefinedFields(part.output),
        providerExecuted: part.providerExecuted,
      } as ToolUIPart;

      message.parts[toolCall.toolPartIndex] = updatedToolPart;
      toolCall.state = "output-available";

      // Update data part with final results
      updateToolDataPart(messages, toolCall, updatedToolPart);
      break;
    }

    case "tool-error": {
      const toolCall = streamingState.toolCalls[part.toolCallId];
      invariant(toolCall, "Tool call not found");

      const updatedToolPart = {
        type: `tool-${part.toolName}`,
        state: "output-error" as const,
        toolCallId: part.toolCallId,
        input: part.input,
        errorText:
          part.error instanceof Error
            ? part.error.message
            : typeof part.error === "string"
              ? part.error
              : "Undefined tool error",
        providerExecuted: part.providerExecuted,
      } as ToolUIPart;

      message.parts[toolCall.toolPartIndex] = updatedToolPart;
      toolCall.state = "output-error";

      // Update data part with error state
      updateToolDataPart(messages, toolCall, updatedToolPart);
      break;
    }

    case "file": {
      message.parts.push({
        type: "file",
        mediaType: part.file.mediaType,
        url: part.file.uint8Array
          ? `data:${part.file.mediaType};base64,${encodeBase64(part.file.uint8Array)}`
          : `data:${part.file.mediaType};base64,${part.file.base64}`,
      });
      break;
    }

    case "finish":
      debug("finish", part);
      // Mark all streaming parts as done using stored indices
      Object.values(streamingState.activeTextParts).forEach(({ partIndex }) => {
        const part = message.parts[partIndex] as TextUIPart;
        part.state = "done";
      });
      Object.values(streamingState.activeReasoningParts).forEach(
        ({ partIndex }) => {
          const part = message.parts[partIndex] as ReasoningUIPart;
          part.state = "done";
        },
      );

      // Clear streaming state
      streamingState.activeTextParts = {};
      streamingState.activeReasoningParts = {};
      streamingState.toolCalls = {};
      break;

    case "finish-step":
      debug("finish-step", part);
      break;

    case "raw":
      debug("raw", part);
      break;

    default: {
      const exhaustiveCheck: never = part;
      throw new Error(
        `Unknown stream part: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}
