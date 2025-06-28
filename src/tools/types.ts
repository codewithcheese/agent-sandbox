import type { Vault } from "obsidian";
import type { ToolExecutionOptions } from "ai";
import { z, ZodAny, ZodObject } from "zod";
import type { SessionStore } from "../chat/session-store.svelte.ts";

export type ToolExecContext = {
  vault: Vault;
  config?: Record<string, any>;
  sessionStore: SessionStore;
};

export type ToolExecutionOptionsWithContext = ToolExecutionOptions & {
  getContext: () => ToolExecContext;
};

export type ToolDefinition = LocalToolDefinition | ServerToolDefinition;

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
    options: ToolExecutionOptionsWithContext,
  ) => Promise<any>;
};

export type ServerToolDefinition = {
  type: "server";
  name: string;
  humanName?: string;
  description: string;
  prompt?: string;
  providers: string[];
  providerOptions?: Partial<Record<string, Record<string, any>>>;
};
