import type { AIProviderId } from "./providers.ts";

export type ChatModel = {
  id: string;
  provider: AIProviderId;
  type: "chat";
  inputTokenLimit: number;
  outputTokenLimit: number;
};

export type EmbeddingModel = {
  id: string;
  provider: AIProviderId;
  type: "embedding";
  dimensions: number;
};

export type TranscriptionModel = {
  id: string;
  provider: AIProviderId;
  type: "transcription";
};

export const models: (ChatModel | EmbeddingModel | TranscriptionModel)[] = [
  {
    id: "o1",
    provider: "openai",
    type: "chat",
    inputTokenLimit: 200000,
    outputTokenLimit: 60000,
  },
  {
    id: "o3-mini",
    provider: "openai",
    type: "chat",
    inputTokenLimit: 200000,
    outputTokenLimit: 4400,
  },
  {
    id: "gpt-4.5",
    provider: "openai",
    type: "chat",
    inputTokenLimit: 128000,
    outputTokenLimit: 8192,
  },
  {
    id: "gpt-4o",
    provider: "openai",
    type: "chat",
    inputTokenLimit: 128000,
    outputTokenLimit: 10000,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    type: "chat",
    inputTokenLimit: 128000,
    outputTokenLimit: 600,
  },
  {
    id: "claude-opus-4-20250514",
    provider: "anthropic",
    type: "chat",
    inputTokenLimit: 200000,
    outputTokenLimit: 32000,
  },
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    type: "chat",
    inputTokenLimit: 200000,
    outputTokenLimit: 64000,
  },
  {
    id: "claude-3-7-sonnet-20250219",
    provider: "anthropic",
    type: "chat",
    inputTokenLimit: 200000,
    outputTokenLimit: 64000,
  },
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    type: "chat",
    inputTokenLimit: 200000,
    outputTokenLimit: 8192,
  },
  {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    type: "chat",
    inputTokenLimit: 200000,
    outputTokenLimit: 4096,
  },
  {
    id: "gemini-2.0-flash",
    provider: "gemini",
    type: "chat",
    inputTokenLimit: 1048576,
    outputTokenLimit: 8192,
  },
  {
    id: "gemini-2.0-flash-lite",
    provider: "gemini",
    type: "chat",
    inputTokenLimit: 1048576,
    outputTokenLimit: 8192,
  },
  {
    id: "gemini-1.5-pro",
    provider: "gemini",
    type: "chat",
    inputTokenLimit: 2097152,
    outputTokenLimit: 8192,
  },
  {
    id: "gemini-1.5-flash",
    provider: "gemini",
    type: "chat",
    inputTokenLimit: 1048576,
    outputTokenLimit: 8192,
  },
  {
    id: "gemini-1.5-flash-8b",
    provider: "gemini",
    type: "chat",
    inputTokenLimit: 1048576,
    outputTokenLimit: 8192,
  },
  {
    id: "universal",
    provider: "assemblyai",
    type: "transcription",
  },
];
