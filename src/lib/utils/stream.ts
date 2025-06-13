import type { TextStreamPart, UIMessage } from "ai";
import { nanoid } from "nanoid";
import { getToolCall, updateToolInvocationPart } from "../../tools";
import { parsePartialJson } from "@ai-sdk/ui-utils";
import { createDebug } from "$lib/debug.ts";
import { encodeBase64 } from "$lib/utils/base64.ts";

const debug = createDebug();

export function applyStreamPartToMessages(
  messages: UIMessage[],
  part: TextStreamPart<any>,
) {
  const message = messages[messages.length - 1]!;
  const currentPart =
    message.parts.length > 0 ? message.parts[message.parts.length - 1] : null;
  let step =
    1 +
    // find max step in existing tool invocations:
    (message.parts
      .filter((part) => part.type === "tool-invocation")
      .map((part) => part.toolInvocation)
      .reduce((max, toolInvocation) => {
        return Math.max(max, toolInvocation.step ?? 0);
      }, 0) ?? 0);

  switch (part.type) {
    case "step-start":
      messages.push({
        id: nanoid(),
        role: "assistant",
        content: "",
        parts: [],
      });
      break;
    case "text-delta":
      if (currentPart?.type === "text") {
        currentPart.text += part.textDelta;
        message.content += part.textDelta;
      } else {
        message.parts.push({ type: "text", text: part.textDelta.trimStart() });
        message.content += part.textDelta.trimStart();
      }
      break;
    case "reasoning":
      if (currentPart && currentPart.type === "reasoning") {
        currentPart.reasoning += part.textDelta;
        const currentDetail =
          currentPart.details.length > 0
            ? currentPart.details[currentPart.details.length - 1]
            : null;
        if (currentDetail && currentDetail.type === "text") {
          currentDetail.text += part.textDelta;
        } else {
          currentPart.details.push({ type: "text", text: part.textDelta });
        }
      } else {
        message.parts.push({
          type: "reasoning",
          reasoning: part.textDelta,
          details: [{ type: "text", text: part.textDelta }],
        });
      }
      break;
    case "redacted-reasoning": {
      if (currentPart && currentPart.type === "reasoning") {
        currentPart.details.push({ type: "redacted", data: part.data });
      } else {
        message.parts.push({
          type: "reasoning",
          reasoning: "",
          details: [{ type: "redacted", data: part.data }],
        });
      }
      break;
    }
    case "reasoning-signature": {
      if (currentPart && currentPart.type === "reasoning") {
        const currentDetail =
          currentPart.details.length > 0
            ? currentPart.details[currentPart.details.length - 1]
            : null;
        if (!currentDetail || currentDetail.type !== "text") {
          throw Error(
            'Received "reasoning-signature" before "reasoning" text detail',
          );
        } else {
          currentDetail.signature = part.signature;
        }
      } else {
        throw Error('Received "reasoning-signature" before "reasoning"');
      }
      break;
    }
    case "source":
      message.parts.push({
        type: "source",
        source: part.source,
      });
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
    case "tool-call-streaming-start": {
      const invocation = {
        state: "partial-call",
        step,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: undefined,
        text: "",
      } as const;

      updateToolInvocationPart(message, part.toolCallId, invocation);
      break;
    }
    case "tool-call-delta": {
      const toolCall = getToolCall(message, part.toolCallId);
      if (!toolCall) {
        throw new Error(`Partial tool call not found: ${part.toolCallId}`);
      }

      toolCall.toolInvocation.text += part.argsTextDelta;

      const { value: partialArgs } = parsePartialJson(
        toolCall.toolInvocation.text,
      );

      const invocation = {
        state: "partial-call",
        step: toolCall.toolInvocation.step,
        toolCallId: part.toolCallId,
        toolName: toolCall.toolInvocation.toolName,
        args: partialArgs,
        text: toolCall.toolInvocation.text,
      } as const;

      updateToolInvocationPart(message, part.toolCallId, invocation);
      break;
    }
    case "tool-call": {
      const invocation = {
        state: "call",
        step,
        ...part,
      } as const;

      updateToolInvocationPart(message, part.toolCallId, invocation);
      break;
    }
    case "tool-result": {
      const toolCall = getToolCall(message, part.toolCallId);
      if (!toolCall) {
        throw new Error(`Tool call not found: ${part.toolCallId}`);
      }

      const invocation = {
        ...toolCall.toolInvocation,
        state: "result" as const,
        ...part,
      } as const;
      updateToolInvocationPart(message, part.toolCallId, invocation);
      break;
    }
    case "file": {
      message.parts.push({
        type: "file",
        mimeType: part.mimeType,
        data: part.base64 ?? encodeBase64(part.uint8Array),
      });
      break;
    }
    case "finish":
      debug("finish", part);
      break;
    case "step-finish":
      debug("step-finish", part);
      break;
    default: {
      const exhaustiveCheck: never = part;
      throw new Error(
        `Unknown stream part: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}
