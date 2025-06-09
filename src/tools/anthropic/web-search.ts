import type { ServerToolDefinition, ToolDefinition } from "../types.ts";

export const toolDef: ServerToolDefinition = {
  type: "server",
  name: "web_search",
  humanName: "Web Search",
  description:
    "Search the web for real-time information to answer questions with up-to-date information beyond its knowledge cutoff.",
  providers: ["anthropic"],
  providerOptions: {
    anthropic: {
      type: "web_search_20250305",
    },
  },
};
