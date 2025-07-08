import type { Vault, MetadataCache } from "obsidian";
import { type Tool, tool, type ToolCallOptions, type ToolUIPart } from "ai";
import { z, ZodAny, ZodObject } from "zod";
import type { SessionStore } from "../chat/session-store.svelte.ts";

export type ToolExecuteContext = {
  vault: Vault;
  config?: Record<string, any>;
  sessionStore: SessionStore;
  metadataCache: MetadataCache;
};

export type ToolCallOptionsWithContext = ToolCallOptions & {
  getContext: () => ToolExecuteContext;
};

export type ToolUIData = {
  title?: string;
  description?: string;
  status?: 'loading' | 'success' | 'error' | 'streaming';
  
  // Streaming info
  streamingInfo?: {
    tokenCount: number;
    isStreaming: boolean;
  };
  
  // Generic key-value pairs for any tool info
  infoItems?: {
    icon: string; // Lucide icon name
    label: string;
    value: string;
    color?: 'normal' | 'muted' | 'faint' | 'accent' | 'success' | 'warning' | 'error';
  }[];
  
  // Generic preview content
  preview?: {
    type: 'text' | 'image' | 'json' | 'list';
    content: string;
    truncated?: boolean;
    maxHeight?: string;
  };
  
  // Generic actions
  actions?: {
    icon: string;
    label: string;
    onClick: () => void;
  }[];
  
  // Additional metadata (fallback)
  metadata?: Record<string, any>;
};

export type ToolDefinition = LocalToolDefinition | ProviderToolDefinition;

export type LocalToolDefinition<
  Schema extends ZodObject<any, any> = ZodObject<any, any>,
> = {
  type: "local";
  name: string;
  humanName?: string;
  description: string;
  prompt?: string;
  inputSchema: Schema;
  execute: (
    params: z.infer<Schema>,
    options: ToolCallOptionsWithContext,
  ) => Promise<any>;
  generateDataPart?: (
    toolPart: ToolUIPart,
    streamingInfo?: { tokenCount: number }
  ) => ToolUIData | null;
};

export type ProviderToolDefinition = {
  type: "provider";
  name: string;
  humanName?: string;
  description: string;
  prompt?: string;
  providers: string[];
  createTool: (providerId: string, options: any) => Tool;
};
