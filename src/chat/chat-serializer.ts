import type { UIMessage } from "ai";
import type { DocumentAttachment } from "./chat.svelte";
import superjson from "superjson";

export interface ChatFileData {
  version: number;
  chat: {
    messages: UIMessage[];
    attachments: DocumentAttachment[];
    title?: string;
    createdAt?: number;
    updatedAt?: number;
    metadata?: Record<string, any>;
  };
}

export interface ChatSchemaVersion {
  version: number;
  migrate: (data: any) => any;
}

export class ChatSerializer {
  // Current schema version
  static readonly CURRENT_VERSION = 1;

  // Schema migration definitions
  private static readonly SCHEMA_VERSIONS: ChatSchemaVersion[] = [
    {
      version: 1,
      migrate: (data: any) => data, // Identity migration for first version
    },
  ];

  /**
   * Serialize chat data to the current version format
   */
  static serialize(chat: any): ChatFileData {
    return {
      version: this.CURRENT_VERSION,
      chat: {
        messages: chat.messages || [],
        attachments: chat.attachments || [],
        title: chat.title || `Chat ${new Date().toLocaleString()}`,
        createdAt: chat.createdAt || Date.now(),
        updatedAt: Date.now(),
        metadata: chat.metadata || {},
      },
    };
  }

  /**
   * Convert serialized format to string
   */
  static stringify(data: ChatFileData): string {
    return superjson.stringify(data);
  }

  /**
   * Parse string to raw data format
   */
  static parse(jsonString: string): any {
    try {
      return superjson.parse(jsonString);
    } catch (error) {
      console.error("Error parsing chat data:", error);
      return { version: 0, chat: { messages: [], attachments: [] } };
    }
  }

  /**
   * Deserialize with migration support
   */
  static deserialize(data: any): ChatFileData {
    return this.migrateToLatest(data);
  }

  /**
   * Apply migrations to bring data to latest schema version
   */
  private static migrateToLatest(data: any): ChatFileData {
    let currentData = data;
    const sourceVersion = currentData.version || 0;

    // Apply each migration in sequence
    for (let v = sourceVersion + 1; v <= this.CURRENT_VERSION; v++) {
      const migration = this.SCHEMA_VERSIONS.find(
        (schema) => schema.version === v,
      );
      if (migration) {
        console.log(`Migrating chat data from version ${v - 1} to ${v}`);
        currentData = migration.migrate(currentData);
        currentData.version = v;
      }
    }

    return currentData as ChatFileData;
  }
}
