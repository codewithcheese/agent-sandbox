import type { Vault } from "obsidian";
import type { ToolExecutionOptions } from "ai";
import { z, ZodAny, ZodObject } from "zod";

export type ToolExecContext = {
  vault: Vault;
  config?: Record<string, any>;
};

export type ToolExecutionOptionsWithContext = ToolExecutionOptions & {
  getContext: () => ToolExecContext;
};

export type ToolDefinition<
  Schema extends ZodObject<any, any> = ZodObject<any, any>,
> = {
  name: string;
  description: string;
  prompt: string;
  inputSchema: Schema;
  execute: (
    params: z.infer<Schema>,
    options: ToolExecutionOptionsWithContext,
  ) => Promise<any>;
};
