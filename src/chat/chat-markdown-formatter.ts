import type { UIMessageWithMetadata } from "./chat.svelte.ts";
import { getTextFromParts } from "$lib/utils/ai.ts";
import { getToolName, isToolUIPart } from "ai";
import { normalizePath } from "obsidian";

export class ChatMarkdownFormatter {
  static formatChat(messages: UIMessageWithMetadata[]): string {
    const sections: string[] = [];

    for (const message of messages) {
      // Skip system messages and system meta messages
      if (
        message.role === "system" ||
        (message.role === "user" && message.metadata?.isSystemMeta)
      ) {
        continue;
      }

      sections.push(this.formatMessage(message));
    }

    return sections.join("\n\n");
  }

  private static formatMessage(message: UIMessageWithMetadata): string {
    const parts: string[] = [];

    // Add role header
    if (message.role === "user") {
      parts.push("## User");
    } else if (message.role === "assistant") {
      parts.push("## Assistant");
    }

    // Add timestamp
    const timestamp = new Date(message.metadata.createdAt).toLocaleString();
    parts.push(`*${timestamp}*`);

    // Add command info if present
    if (
      message.role === "user" &&
      message.metadata &&
      "command" in message.metadata &&
      message.metadata.command
    ) {
      parts.push(`**Command:** [[${message.metadata.command.path}]]`);
    }

    // Add modified files if present
    if (message.role === "user" && message.metadata?.modified?.length) {
      const modifiedFiles = message.metadata.modified
        .map((path) => `[[${path}]]`)
        .join(", ");
      parts.push(`**Modified files:** ${modifiedFiles}`);
    }

    // Process message parts
    const textParts = message.parts.filter((p) => p.type === "text");
    const fileParts = message.parts.filter((p) => p.type === "file");
    const toolParts = message.parts.filter((p) => isToolUIPart(p));

    // Add text content
    if (textParts.length > 0) {
      const textContent = getTextFromParts(message.parts);
      if (textContent.trim()) {
        parts.push(textContent);
      }
    }

    // Add file attachments
    if (fileParts.length > 0) {
      parts.push("**Attachments:**");
      for (const file of fileParts) {
        parts.push(`- [[${file.filename}]]`);
      }
    }

    // Add tool calls (simplified list format)
    if (toolParts.length > 0) {
      parts.push("**Tools used:**");
      for (const toolPart of toolParts) {
        const toolName = getToolName(toolPart);
        const toolInfo = this.formatToolInfo(toolPart, message);
        parts.push(`- ${toolName}${toolInfo}`);
      }
    }

    return parts.join("\n\n");
  }

  private static formatToolInfo(
    toolPart: any,
    message: UIMessageWithMetadata,
  ): string {
    // Find associated data part
    const dataPart = message.parts.find(
      (p) => p.type === "data-tool-ui" && p.id === toolPart.toolCallId,
    );

    if (!dataPart || !(dataPart as any).data) {
      return "";
    }

    const data = (dataPart as any).data;

    const info: string[] = [];

    // Add file path as wiki link if available
    if (data.path) {
      info.push(`[[${data.path}]]`);
    }

    // Add context info
    if (data.context) {
      info.push(`(${data.context})`);
    }

    // Add line numbers if available
    if (data.lines) {
      info.push(`${data.lines}`);
    }

    // Add title if different from tool name
    if (data.title && data.title !== getToolName(toolPart)) {
      info.push(`"${data.title}"`);
    }

    return info.length > 0 ? `: ${info.join(" ")}` : "";
  }
}
