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
  title?: string;        // Override tool name: "Text File" vs "Read"
  path?: string;         // File path - clickable to open in Obsidian
  context?: string;      // Brief context: "(error)" etc.
  contextStyle?: "normal" | "mono"; // Style for context display
  lines?: string;        // Line information: "1-100/500" or "45 lines" etc.
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
    toolPart: ToolUIPart
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
  generateDataPart?: (
    toolPart: ToolUIPart
  ) => ToolUIData | null;
};
