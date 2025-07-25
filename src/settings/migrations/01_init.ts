import { z } from "zod";
import type { SettingsMigrator } from "./types";

// V1 schemas - self-contained to avoid circular dependencies
const AIAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  config: z.record(z.any()),
});

const ModelSchema = z.discriminatedUnion("type", [
  // Chat model schema
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("chat"),
    inputTokenLimit: z.number(),
    outputTokenLimit: z.number(),
  }),
  // Embedding model schema
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("embedding"),
    dimensions: z.number(),
  }),
  // Transcription model schema
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("transcription"),
  }),
]);

const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  requiredFields: z.array(z.string()),
  optionalFields: z.array(z.string()),
});

// Settings V1 Schema
export const SettingsV1Schema = z
  .object({
    version: z.literal(1),
    services: z.object({
      rapidapi: z.object({
        name: z.string(),
        apiKey: z.string(),
      }),
    }),
    defaults: z.object({
      modelId: z.string(),
      accountId: z.string(),
    }),
    vault: z.object({
      chatsPath: z.string(),
    }),
    accounts: z.array(AIAccountSchema),
    models: z.array(ModelSchema),
    providers: z.array(ProviderSchema),
    recording: z.object({
      transcriptionsPath: z.string(),
      accountId: z.string().optional(),
      modelId: z.string().optional(),
    }),
    title: z.object({
      prompt: z.string(),
      accountId: z.string().optional(),
      modelId: z.string().optional(),
    }),
    agents: z.object({
      templateRepairAgentPath: z.string().nullable(),
    }),
  })
  .strict();

// Migration from empty/unknown data to V1
export const migrationV1: SettingsMigrator<unknown, z.infer<typeof SettingsV1Schema>> = {
  version: 1,
  migrate: (_data: unknown): z.infer<typeof SettingsV1Schema> => {
    // Create initial V1 settings structure from empty/unknown data
    return {
      version: 1,
      services: {
        rapidapi: {
          name: "RapidAPI",
          apiKey: "",
        },
      },
      defaults: {
        modelId: "claude-3-5-sonnet-20241022",
        accountId: "",
      },
      vault: {
        chatsPath: "chats",
      },
      accounts: [],
      models: [
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
      ],
      providers: [
        {
          id: "ollama",
          name: "Ollama",
          requiredFields: [],
          optionalFields: ["baseURL"],
        },
        {
          id: "openai",
          name: "OpenAI",
          requiredFields: ["apiKey"],
          optionalFields: ["baseURL"],
        },
        {
          id: "anthropic",
          name: "Anthropic",
          requiredFields: ["apiKey"],
          optionalFields: ["baseURL"],
        },
        {
          id: "gemini",
          name: "Google Gemini",
          requiredFields: ["apiKey"],
          optionalFields: ["baseURL"],
        },
        {
          id: "assemblyai",
          name: "AssemblyAI",
          requiredFields: ["apiKey"],
          optionalFields: ["baseURL"],
        },
      ],
      recording: {
        transcriptionsPath: "transcriptions",
        accountId: "",
        modelId: "",
      },
      agents: {
        templateRepairAgentPath: "",
      },
      title: {
        prompt: `Your task is to generate a short and concise title that summarizes the main topic or theme of the conversation.

<conversation>
{{ conversation }}
</conversation>

Guidelines for creating the title:
1. Keep the title brief, ideally 3-7 words.
2. Capture the main topic or theme of the conversation.
3. Use clear and simple language.
4. Avoid using specific names unless they are crucial to the main topic.
5. Do not include unnecessary details or tangential information.

Generate the title and output it within <title> tags. Do not include any explanation or additional text outside the tags.`,
        accountId: "",
        modelId: "",
      },
    };
  },
};
