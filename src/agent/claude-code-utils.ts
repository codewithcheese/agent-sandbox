import type { SDKMessage, SDKAssistantMessage, SDKUserMessage } from "@anthropic-ai/claude-code";
import type { UIMessageWithMetadata, WithSystemMetadata, WithUserMetadata, WithAssistantMetadata } from "../chat/chat.svelte.ts";
import { nanoid } from "nanoid";

/**
 * Extracts text content from Claude Code SDK message content
 */
function extractTextContent(message: any): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  
  if (Array.isArray(message.content)) {
    return message.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
  }
  
  return '';
}

/**
 * Converts Claude Code SDK messages to UI message format
 * This is the equivalent of applyStreamPartToMessages but for Claude Code SDK
 */
export function convertClaudeCodeMessageToUI(
  claudeMessage: SDKMessage,
  accountId: string,
  accountName: string,
  provider: string,
  modelId: string
): UIMessageWithMetadata | null {
  
  switch (claudeMessage.type) {
    case "assistant": {
      const textContent = extractTextContent(claudeMessage.message);
      return {
        id: nanoid(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: textContent
          }
        ],
        metadata: {
          createdAt: new Date(),
          accountId,
          accountName,
          provider,
          modelId,
        }
      } as UIMessageWithMetadata & WithAssistantMetadata;
    }

    case "user": {
      const textContent = extractTextContent(claudeMessage.message);
      return {
        id: nanoid(),
        role: "user", 
        parts: [
          {
            type: "text",
            text: textContent
          }
        ],
        metadata: {
          createdAt: new Date(),
        }
      } as UIMessageWithMetadata & WithUserMetadata;
    }

    case "system":
      // System messages are initialization info, convert to assistant message
      const systemInfo = `Claude Code session initialized with ${claudeMessage.tools.length} tools in ${claudeMessage.cwd}`;
      return {
        id: nanoid(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: systemInfo
          }
        ],
        metadata: {
          createdAt: new Date(),
          accountId,
          accountName,
          provider,
          modelId,
        }
      } as UIMessageWithMetadata & WithAssistantMetadata;

    case "result":
      // Result messages contain execution results
      if (claudeMessage.subtype === 'success') {
        return {
          id: nanoid(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: claudeMessage.result
            }
          ],
          metadata: {
            createdAt: new Date(),
            accountId,
            accountName,
            provider,
            modelId,
          }
        } as UIMessageWithMetadata & WithAssistantMetadata;
      } else {
        // Error result
        return {
          id: nanoid(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Error: ${claudeMessage.subtype} after ${claudeMessage.num_turns} turns`
            }
          ],
          metadata: {
            createdAt: new Date(),
            accountId,
            accountName,
            provider,
            modelId,
          }
        } as UIMessageWithMetadata & WithAssistantMetadata;
      }

    default:
      // Unknown message type, skip
      return null;
  }
}

/**
 * Converts UI messages to Claude Code SDK message format
 */
export function convertUIMessageToClaudeCode(uiMessage: UIMessageWithMetadata): SDKMessage | null {
  // Skip system messages as they're handled via systemPrompt in Claude Code SDK
  if (uiMessage.role === "system") {
    return null;
  }

  // Extract text content from message parts
  const textContent = uiMessage.parts
    .filter(part => part.type === "text")
    .map(part => part.text)
    .join("\n");

  if (!textContent.trim()) {
    return null;
  }

  return {
    type: uiMessage.role as "user" | "assistant",
    message: {
      content: textContent
    }
  } as any;
}

/**
 * Converts an array of UI messages to Claude Code format
 * Filters out system messages and empty messages
 */
export function convertUIMessagesToClaudeCode(uiMessages: UIMessageWithMetadata[]): SDKMessage[] {
  return uiMessages
    .map(convertUIMessageToClaudeCode)
    .filter((msg): msg is SDKMessage => msg !== null);
}