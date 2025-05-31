import type { Vault } from "obsidian";
import type { ToolExecutionOptions } from "ai";

export type ToolExecContext = {
  vault: Vault;
  config?: Record<string, any>;
};

export type ToolExecutionOptionsWithContext = ToolExecutionOptions & {
  getContext: () => ToolExecContext;
};
