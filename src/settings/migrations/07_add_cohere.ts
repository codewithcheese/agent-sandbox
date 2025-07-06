import { z } from "zod";
import _ from "lodash";
import { SettingsV6Schema } from "./06_add_xai";
import type { SettingsMigrator } from "./types";

// V7 model schema (same as V6 - no changes to schema structure)
export const ModelV7Schema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("chat"),
    inputTokenLimit: z.number(),
    outputTokenLimit: z.number(),
    inputPrice: z.number(),
    outputPrice: z.number(),
  }),
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("embedding"),
    dimensions: z.number(),
  }),
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("transcription"),
    pricePerHour: z.number(),
  }),
]);

// Settings V7 Schema (independent definition with Cohere models)
export const SettingsV7Schema = z.object({
  version: z.literal(7),
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
  accounts: z.array(z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    config: z.record(z.any()),
  })),
  models: z.array(ModelV7Schema),
  providers: z.array(z.object({
    id: z.string(),
    name: z.string(),
    requiredFields: z.array(z.string()),
    optionalFields: z.array(z.string()),
  })),
  recording: z.object({
    transcriptionsPath: z.string(),
    accountId: z.string().optional(),
    modelId: z.string().optional(),
    postProcessing: z.object({
      enabled: z.boolean(),
      prompt: z.string(),
      accountId: z.string().optional(),
      modelId: z.string().optional(),
    }),
  }),
  title: z.object({
    prompt: z.string(),
    accountId: z.string().optional(),
    modelId: z.string().optional(),
  }),
  agents: z.object({
    templateRepairAgentPath: z.string().nullable(),
  }),
}).strict();

// New Cohere models to add in V7 (excluding legacy models)
const NEW_COHERE_MODELS = [
  {
    id: "command-r-plus",
    provider: "cohere",
    type: "chat" as const,
    inputTokenLimit: 128000,
    outputTokenLimit: 4000,
    inputPrice: 2.50,
    outputPrice: 10.00,
  },
  {
    id: "command-r",
    provider: "cohere",
    type: "chat" as const,
    inputTokenLimit: 128000,
    outputTokenLimit: 4000,
    inputPrice: 0.15,
    outputPrice: 0.60,
  },
  {
    id: "command-r7b",
    provider: "cohere",
    type: "chat" as const,
    inputTokenLimit: 128000,
    outputTokenLimit: 4000,
    inputPrice: 0.0375,
    outputPrice: 0.15,
  },
  {
    id: "command-a-03-2025",
    provider: "cohere",
    type: "chat" as const,
    inputTokenLimit: 256000,
    outputTokenLimit: 8000,
    inputPrice: 2.50,
    outputPrice: 10.00,
  },
];

// New Cohere embedding models
const NEW_COHERE_EMBEDDING_MODELS = [
  {
    id: "embed-english-v3.0",
    provider: "cohere",
    type: "embedding" as const,
    dimensions: 1024,
  },
  {
    id: "embed-multilingual-v3.0",
    provider: "cohere",
    type: "embedding" as const,
    dimensions: 1024,
  },
  {
    id: "embed-english-light-v3.0",
    provider: "cohere",
    type: "embedding" as const,
    dimensions: 384,
  },
  {
    id: "embed-multilingual-light-v3.0",
    provider: "cohere",
    type: "embedding" as const,
    dimensions: 384,
  },
];

// New Cohere provider
const COHERE_PROVIDER = {
  id: "cohere",
  name: "Cohere",
  requiredFields: ["apiKey"],
  optionalFields: [],
};

// Migration from V6 to V7 (adds Cohere models and provider)
export const migrationV7: SettingsMigrator<
  z.infer<typeof SettingsV6Schema>,
  z.infer<typeof SettingsV7Schema>
> = {
  version: 7,
  migrate: (data: z.infer<typeof SettingsV6Schema>): z.infer<typeof SettingsV7Schema> => ({
    ...data,
    version: 7,
    models: _.unionBy(
      data.models,
      [...NEW_COHERE_MODELS, ...NEW_COHERE_EMBEDDING_MODELS],
      "id",
    ),
    providers: _.unionBy(
      data.providers,
      [COHERE_PROVIDER],
      "id",
    ),
  }),
};