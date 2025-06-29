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

const debug = createDebug();

// Streaming state tracks part indices for efficient updates
export type StreamingState = {
  partialToolCalls: Record<
    string,
    { text: string; toolName: string; partIndex: number }
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

export function applyStreamPartToMessages(
  messages: UIMessage[],
  part: TextStreamPart<any>,
  streamingState: StreamingState = {
    partialToolCalls: {},
    activeTextParts: {},
    activeReasoningParts: {},
  },
) {
  const message = messages[messages.length - 1]!;

  switch (part.type) {
    case "start-step":
      messages.push({
        id: nanoid(),
        role: "assistant",
        parts: [],
      });
      break;

    case "start":
      // Stream start - no action needed
      break;

    case "text-start":
      const textPartIndex = message.parts.length;
      message.parts.push({
        type: "text",
        text: "",
        state: "streaming",
      } as TextUIPart);

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
        (textPart as any).state = "done";
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
        (reasoningPart as any).state = "done";
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
      streamingState.partialToolCalls[part.id] = {
        text: "",
        toolName: part.toolName,
        partIndex: toolPartIndex,
      };

      message.parts.push({
        type: `tool-${part.toolName}`,
        state: "input-streaming",
        input: undefined,
        toolCallId: part.id,
        providerExecuted: part.providerExecuted,
      } as ToolUIPart);
      break;
    }

    case "tool-input-delta": {
      const partialToolCall = streamingState.partialToolCalls[part.id];
      invariant(partialToolCall, "Partial tool call not found");

      // Accumulate text in streaming state
      partialToolCall.text += part.delta;

      // Parse partial JSON from accumulated text
      const { value: partialArgs } = parsePartialJson(partialToolCall.text);

      // Update the tool part using stored index
      const toolPart = message.parts[partialToolCall.partIndex] as ToolUIPart;
      message.parts[partialToolCall.partIndex] = {
        ...toolPart,
        state: "input-streaming",
        input: partialArgs,
      };
      break;
    }

    case "tool-input-end": {
      const partialToolCall = streamingState.partialToolCalls[part.id];
      invariant(partialToolCall, "Partial tool call not found");

      // Update the tool part using stored index
      const toolPart = message.parts[partialToolCall.partIndex] as ToolUIPart;
      message.parts[partialToolCall.partIndex] = {
        ...toolPart,
        state: "input-available",
      };
      break;
    }

    case "tool-call": {
      const partialToolCall = streamingState.partialToolCalls[part.toolCallId];
      if (partialToolCall) {
        message.parts[partialToolCall.partIndex] = {
          type: `tool-${part.toolName}`,
          state: "input-available",
          toolCallId: part.toolCallId,
          input: part.input,
          providerExecuted: part.providerExecuted,
        };
      } else {
        message.parts.push({
          type: `tool-${part.toolName}`,
          state: "input-available",
          toolCallId: part.toolCallId,
          input: part.input,
          providerExecuted: part.providerExecuted,
        });
      }
      break;
    }

    case "tool-result": {
      const partIndex = message.parts.findIndex(
        (p) =>
          p.type === `tool-${part.toolName}` &&
          // @ts-expect-error narrow doesn't work
          p.toolCallId === part.toolCallId,
      );
      invariant(partIndex > -1, "Tool part not found");

      message.parts[partIndex] = {
        type: `tool-${part.toolName}`,
        state: "output-available",
        toolCallId: part.toolCallId,
        input: part.input,
        output: part.output,
        providerExecuted: part.providerExecuted,
      };
      break;
    }

    case "tool-error": {
      const partIndex = message.parts
        .filter((part): part is ToolUIPart => part.type.startsWith("tool-"))
        .findIndex((p) => p.toolCallId === part.toolCallId);
      invariant(partIndex > -1, "Tool part not found");

      message.parts[partIndex] = {
        type: `tool-${part.toolName}`,
        state: "output-error",
        toolCallId: part.toolCallId,
        input: part.input,
        errorText:
          part.error instanceof Error
            ? part.error.message
            : typeof part.error === "string"
              ? part.error
              : "Undefined tool error",
        providerExecuted: part.providerExecuted,
      };
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
        (part as any).state = "done";
      });
      Object.values(streamingState.activeReasoningParts).forEach(
        ({ partIndex }) => {
          const part = message.parts[partIndex] as ReasoningUIPart;
          (part as any).state = "done";
        },
      );

      // Clear streaming state
      streamingState.activeTextParts = {};
      streamingState.activeReasoningParts = {};
      streamingState.partialToolCalls = {};
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
