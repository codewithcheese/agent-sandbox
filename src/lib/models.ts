import { anthropic } from "@ai-sdk/anthropic";

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

export const ModelProvider: Record<
  string,
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
} as const;
