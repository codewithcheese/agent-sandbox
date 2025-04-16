import type { UIMessage } from "ai";
import { Chat, type DocumentAttachment } from "./chat.svelte";
import superjson from "superjson";
import type { ToolRequest } from "../tools/request.ts";

export type ChatFileV1 = {
  version: 1;
  chat: {
    messages: UIMessage[];
    attachments: DocumentAttachment[];
    toolRequests: ToolRequest[];
    createdAt: Date;
    updatedAt: Date;
  };
};

export type ChatFile = ChatFileV1;

export type ChatFileMigrator = {
  version: number;
  migrate: (data: any) => any;
};

const CURRENT_VERSION = 1 as const;

export class ChatSerializer {
  static readonly CURRENT_VERSION = 1;

  private static readonly VERSION_MIGRATORS: ChatFileMigrator[] = [
    {
      version: 1,
      migrate: (data: ChatFileV1): ChatFileV1 => data, // Identity migration for first version
    },
  ];

  static stringify(chat: Chat): string {
    return superjson.stringify({
      version: this.CURRENT_VERSION,
      chat: {
        messages: chat.messages,
        attachments: chat.attachments,
        toolRequests: chat.toolRequests,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      },
    } satisfies ChatFile & { version: typeof CURRENT_VERSION });
  }

  static parse(
    jsonString: string,
  ): ChatFile & { version: typeof CURRENT_VERSION } {
    const data = superjson.parse(jsonString);
    return this.migrateToLatest(data);
  }

  private static migrateToLatest(
    data: any,
  ): ChatFile & { version: typeof CURRENT_VERSION } {
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

    return currentData as ChatFile;
  }
}
