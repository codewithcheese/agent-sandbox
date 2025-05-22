import type { UIMessage } from "ai";
import { Chat, type DocumentAttachment } from "./chat.svelte";
import superjson from "superjson";
import type { ToolRequest } from "../tools/tool-request.ts";
import { nanoid } from "nanoid";

export type ChatFileV1 = {
  version: 1;
  payload: {
    id: string;
    messages: UIMessage[];
    attachments: DocumentAttachment[];
    toolRequests: ToolRequest[];
    overlay:
      | {
          master: Uint8Array;
          staging: Uint8Array;
        }
      | undefined;
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
      attachments: [],
      toolRequests: [],
      overlay: undefined,
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
    return superjson.stringify({
      version: this.CURRENT_VERSION,
      payload: {
        id: chat.id,
        messages: chat.messages,
        attachments: chat.attachments,
        toolRequests: chat.toolRequests,
        overlay: chat.vaultOverlay.snapshot(),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      },
    } satisfies CurrentChatFile);
  }

  static parse(jsonString: string): CurrentChatFile {
    const data = superjson.parse(jsonString);
    return this.migrateToLatest(data);
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
