import type { ProviderToolDefinition } from "../types.ts";
import { anthropic } from "@ai-sdk/anthropic";

type WebSearchOptions = Parameters<
  typeof anthropic.tools.webSearch_20250305
>[0];

export const toolDef: ProviderToolDefinition = {
  type: "provider",
  name: "web_search",
  humanName: "Web Search",
  description:
    "Search the web for real-time information to answer questions with up-to-date information beyond your knowledge cutoff.",
  providers: ["anthropic"],
  createTool: (options: WebSearchOptions) => {
    return anthropic.tools.webSearch_20250305(options);
  },
};
