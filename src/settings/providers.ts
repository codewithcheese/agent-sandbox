import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import type { AIAccount } from "./settings.ts";

export function createAIProvider(account: AIAccount) {
  switch (account.provider) {
    case "openai":
      return createOpenAI({
        ...account.config,
      });
    case "anthropic":
      return createAnthropic({
        ...account.config,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
          "anthropic-beta":
            "fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14",
        },
      });
    case "gemini":
      return createGoogleGenerativeAI({
        ...account.config,
      });
    // todo: bring back support when they ship v5 compatible provider
    // case "ollama":
    //   return createOllama({
    //     ...account.config,
    //   });
    case "assemblyai":
      throw Error("AssemblyAI cannot be used as a AI SDK provider.");
    default:
      throw new Error(`Unsupported AI provider: ${account.provider}`);
  }
}

export const ModelConfigField = {
  apiKey: {
    name: "API Key",
    description: "Your API key for authentication.",
    placeholder: "sk-...",
    isPassword: true,
  },
  baseURL: {
    name: "Base URL",
    description: "The base URL for the API.",
    placeholder: "https://api.example.com",
    isPassword: false,
  },
} as const;
