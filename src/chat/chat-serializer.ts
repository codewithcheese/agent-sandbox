import type { UIMessage } from "ai";
import { Chat, type UIMessageWithMetadata } from "./chat.svelte";
import superjson from "superjson";
import { nanoid } from "nanoid";
import type { SuperJSONObject } from "$lib/utils/superjson";
import { ChatMarkdownFormatter } from "./chat-markdown-formatter.ts";

export type ChatFileV1 = {
  version: 1;
  payload: {
    id: string;
    messages: UIMessageWithMetadata[];
    vault:
      | {
          tracking: Uint8Array;
          proposed: Uint8Array;
        }
      | undefined;
    options: {
      maxSteps: number;
      modelId?: string;
      accountId?: string;
      agentPath?: string;
      temperature: number;
      thinkingEnabled: boolean;
      maxTokens: number;
      thinkingTokensBudget: number;
    };
    createdAt: Date;
    updatedAt: Date;
  };
};

export type ChatFile = ChatFileV1;

export type CurrentChatFile = ChatFile & {
  version: typeof ChatSerializer.CURRENT_VERSION;
};

export type ChatFileMigrator = {
  version: number;
  migrate: (data: any) => any;
};

export class ChatSerializer {
  static readonly CURRENT_VERSION = 1 as const;

  static INITIAL_DATA = {
    version: 1,
    payload: {
      id: nanoid(),
      messages: [],
      vault: undefined,
      options: {
        maxSteps: 100,
        temperature: 0.7,
        thinkingEnabled: false,
        maxTokens: 4000,
        thinkingTokensBudget: 1200,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } satisfies CurrentChatFile;

  private static readonly VERSION_MIGRATORS: ChatFileMigrator[] = [
    {
      version: 1,
      migrate: (data: ChatFileV1): ChatFileV1 => data, // Identity migration for first version
    },
  ];

  static stringify(chat: Chat): string {
    const chatData = {
      version: this.CURRENT_VERSION,
      payload: {
        id: chat.id,
        messages: chat.messages,
        vault: chat.vault.snapshot(),
        options: chat.options,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      },
    } satisfies CurrentChatFile;

    // Check file extension to determine format
    const isMarkdownFormat = chat.path.endsWith(".chat.md");

    if (isMarkdownFormat) {
      // Generate human-readable markdown format for .chat.md files
      const markdown = ChatMarkdownFormatter.formatChat(chat.messages);

      // Encode the JSON data as base64
      const jsonString = superjson.stringify(chatData);
      const encodedData = btoa(jsonString);

      // Combine markdown with embedded JSON data (similar to Excalidraw format)
      return `${markdown}

%%
# Chat Data
\`\`\`chatdata
${encodedData}
\`\`\`
%%`;
    } else {
      // Use raw JSON format for .chat files (backward compatibility)
      return superjson.stringify(chatData);
    }
  }

  static parse(content: string): CurrentChatFile {
    // Try to extract JSON data from markdown format first
    const extractedData = this.extractJsonFromMarkdown(content);
    if (extractedData) {
      return this.migrateToLatest(extractedData);
    }

    // Fall back to parsing as raw JSON for backward compatibility
    const data = superjson.parse(content);
    return this.migrateToLatest(data);
  }

  private static extractJsonFromMarkdown(content: string): any | null {
    const lines = content.split("\n");

    // Find the chatdata code block
    let codeBlockStart = -1;
    let codeBlockEnd = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "```chatdata") {
        codeBlockStart = i + 1;
      } else if (codeBlockStart !== -1 && lines[i].trim() === "```") {
        codeBlockEnd = i;
        break;
      }
    }

    if (codeBlockStart === -1 || codeBlockEnd === -1) {
      return null;
    }

    // Extract the base64 content from the code block
    const base64Content = lines
      .slice(codeBlockStart, codeBlockEnd)
      .join("\n")
      .trim();

    try {
      // Decode base64 and parse JSON
      const decodedJson = atob(base64Content);
      return superjson.parse(decodedJson);
    } catch (error) {
      console.error("Failed to parse embedded chat data:", error);
      return null;
    }
  }

  private static migrateToLatest(data: any): CurrentChatFile {
    let currentData = data;
    const sourceVersion = currentData.version || 0;

    // Apply each migration in sequence
    for (let v = sourceVersion + 1; v <= this.CURRENT_VERSION; v++) {
      const migration = this.VERSION_MIGRATORS.find(
        (schema) => schema.version === v,
      );
      if (migration) {
        console.log(`Migrating chat data from version ${v - 1} to ${v}`);
        currentData = migration.migrate(currentData);
        currentData.version = v;
      }
    }

    return currentData as CurrentChatFile;
  }
}
