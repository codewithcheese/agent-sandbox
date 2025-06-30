import type { ProviderToolDefinition } from "./types.ts";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

export const toolDef: ProviderToolDefinition = {
  type: "provider",
  name: "web_search_preview",
  humanName: "Web Search",
  description:
    "Search the web for real-time information to answer questions with up-to-date information beyond your knowledge cutoff.",
  providers: ["anthropic"],
  createTool: (providerId: string, options: any) => {
    switch (providerId) {
      case "anthropic":
        return anthropic.tools.webSearch_20250305(options);
      case "openai":
        return openai.tools.webSearchPreview(options);
      default:
        throw new Error(`Unsupported provider: ${providerId}`);
    }
  },
};
