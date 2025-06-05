import type { Vault } from "obsidian";
import type { ToolExecutionOptions } from "ai";
import { z, ZodAny, ZodObject } from "zod";
import type { AIProviderId } from "../settings/providers.ts";

export type ToolExecContext = {
  vault: Vault;
  config?: Record<string, any>;
};

export type ToolExecutionOptionsWithContext = ToolExecutionOptions & {
  getContext: () => ToolExecContext;
};

export type ToolDefinition<
  Schema extends ZodObject<any, any> = ZodObject<any, any>,
> =
  | {
      name: string;
      humanName?: string;
      description: string;
      prompt?: string;
      inputSchema: Schema;
      execute: (
        params: z.infer<Schema>,
        options: ToolExecutionOptionsWithContext,
      ) => Promise<any>;
    }
  | {
      type: "server_tool";
      name: string;
      humanName?: string;
      description: string;
      prompt?: string;
      providers: AIProviderId[];
      providerOptions?: Partial<Record<AIProviderId, Record<string, any>>>;
    };
