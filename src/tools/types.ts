import type { Vault, MetadataCache } from "obsidian";
import { type Tool, tool, type ToolCallOptions } from "ai";
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
