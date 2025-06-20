import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";

export type AIProviderId =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "assemblyai";

export type AIAccount = {
  id: string;
  name: string;
  provider: AIProviderId;
  config: ModelConfig;
};

export const AIProvider: Record<
  AIProviderId,
  {
    name: string;
    requiredFields: (keyof typeof ModelConfigField)[];
    optionalFields: (keyof typeof ModelConfigField)[];
  }
> = {
  ollama: {
    name: "Ollama",
    requiredFields: [],
    optionalFields: ["baseURL"],
  },
  openai: {
    name: "OpenAI",
    requiredFields: ["apiKey"],
    optionalFields: ["baseURL"],
  },
  anthropic: {
    name: "Anthropic",
    requiredFields: ["apiKey"],
    optionalFields: ["baseURL"],
  },
  gemini: {
    name: "Google Gemini",
    requiredFields: ["apiKey"],
    optionalFields: ["baseURL"],
  },
  assemblyai: {
    name: "AssemblyAI",
    requiredFields: ["apiKey"],
    optionalFields: ["baseURL"],
  },
} as const;

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
          "anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
        },
      });
    case "gemini":
      return createGoogleGenerativeAI({
        ...account.config,
      });
    case "ollama":
      return createOllama({
        ...account.config,
      });
    case "assemblyai":
      throw Error("AssemblyAI cannot be used as a AI SDK provider.");
    default:
      // exhaustive check
      const provider: never = account.provider;
      throw new Error(`Unsupported AI provider: ${account.provider}`);
  }
}

export type ModelConfig = {
  baseURL?: string;
  apiKey?: string;
};

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
