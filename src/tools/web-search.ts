import type { ProviderToolDefinition } from "./types.ts";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { type ToolUIPart } from "ai";

// Define the UI tool type for the web search tool
type WebSearchUITool = {
  input: {
    query: string;
  };
  output: {
    url: string;
    title: string;
    pageAge: string | null;
    encryptedContent: string;
    type: string;
  }[];
};

type WebSearchToolUIPart = ToolUIPart<{ web_search: WebSearchUITool }>;

export const toolDef: ProviderToolDefinition = {
  type: "provider",
  name: "web_search",
  humanName: "Web Search",
  description:
    "Search the web for real-time information to answer questions with up-to-date information beyond your knowledge cutoff.",
  providers: ["anthropic"],
  createTool: (providerId: string, options: any) => {
    switch (providerId) {
      case "anthropic":
        return anthropic.tools.webSearch_20250305(options);
      // Fixme: webSearch_20250305 and webSearchPreview have different tool names and setup can't accommodate both
      // case "openai":
      //   return openai.tools.webSearchPreview(options);
      default:
        throw new Error(`Unsupported provider: ${providerId}`);
    }
  },
  generateDataPart: (toolPart: WebSearchToolUIPart) => {
    const { state, input } = toolPart;

    // Show query during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      return {
        title: "Web Search",
        context: input?.query ? `"${input.query}"` : undefined,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;
      const resultCount = Array.isArray(output)
        ? output.length
        : Object.keys(output).length;

      return {
        title: "Web Search",
        context: input?.query ? `"${input.query}"` : undefined,
        lines: resultCount > 0 ? `${resultCount} results` : "No results",
      };
    }

    if (state === "output-error") {
      // Show actual error message instead of generic "(error)"
      const errorText = toolPart.errorText || "Unknown error";
      
      return {
        title: "Web Search",
        context: input?.query ? `"${input.query}"` : undefined,
        lines: errorText,
      };
    }

    return null;
  },
};
