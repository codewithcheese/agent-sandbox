import type { UIMessagePart } from "ai";

export function getTextFromParts(parts: UIMessagePart<any, any>[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * Filters out incomplete tool parts from UI messages before conversion to model messages.
 * Tool parts that are not in "output-available" or "output-error" state are removed
 * to prevent errors when conversations are cancelled during tool execution.
 */
export function filterIncompleteToolParts<T extends { role: string; parts: UIMessagePart<any, any>[] }>(
  messages: T[]
): T[] {
  return messages.map(message => {
    if (message.role !== "assistant") {
      return message;
    }
    
    return {
      ...message,
      parts: message.parts.filter(part => {
        // Keep non-tool parts
        if (!part.type.startsWith("tool-")) {
          return true;
        }
        
        // Only keep tool parts that have completed execution
        const toolPart = part as any; // ToolUIPart type
        return toolPart.state === "output-available" || toolPart.state === "output-error";
      })
    };
  });
}
