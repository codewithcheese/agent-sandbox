import type { UIMessage } from "ai";
import type { ToolInvocation, ToolInvocationUIPart } from "@ai-sdk/ui-utils";

export function hasToolResultsPending(message: UIMessage) {
  return (
    message.role === "assistant" &&
    // has tool invocations
    message.parts.some((part) => part.type === "tool-invocation") &&
    // every one has a result
    message.parts
      .filter((part) => part.type === "tool-invocation")
      .every((part) => part.toolInvocation.state === "result")
  );
}

export function updateToolInvocationPart(
  message: UIMessage,
  toolCallId: string,
  invocation: ToolInvocation,
) {
  const part = message.parts.find(
    (part) =>
      part.type === "tool-invocation" &&
      part.toolInvocation.toolCallId === toolCallId,
  ) as ToolInvocationUIPart | undefined;

  if (part != null) {
    part.toolInvocation = invocation;
  } else {
    message.parts.push({
      type: "tool-invocation",
      toolInvocation: invocation,
    });
  }
}

export function getToolCall(message: UIMessage, toolCallId: string) {
  return message.parts.find(
    (p) =>
      p.type === "tool-invocation" &&
      p.toolInvocation.toolCallId === toolCallId,
  ) as
    | (ToolInvocationUIPart & { toolInvocation: { text: string } })
    | undefined;
}
