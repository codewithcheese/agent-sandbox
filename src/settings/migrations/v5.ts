import { z } from "zod";
import _ from "lodash";
import { SettingsV4Schema } from "./v4";
import type { SettingsMigrator } from "./types";

// V5 model schema (same as V4 - no changes to schema structure)
export const ModelV5Schema = z.discriminatedUnion("type", [
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

// Settings V5 Schema (independent definition with DeepSeek models)
export const SettingsV5Schema = z.object({
  version: z.literal(5),
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
  models: z.array(ModelV5Schema),
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

// New DeepSeek models to add in V5
const NEW_DEEPSEEK_MODELS = [
  {
    id: "deepseek-chat",
    provider: "deepseek",
    type: "chat" as const,
    inputTokenLimit: 64000,
    outputTokenLimit: 8000,
    inputPrice: 0.27,
    outputPrice: 1.10,
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    type: "chat" as const,
    inputTokenLimit: 64000,
    outputTokenLimit: 64000,
    inputPrice: 0.55,
    outputPrice: 2.19,
  },
];

// New DeepSeek provider
const DEEPSEEK_PROVIDER = {
  id: "deepseek",
  name: "DeepSeek",
  requiredFields: ["apiKey"],
  optionalFields: [],
};

// Migration from V4 to V5 (adds DeepSeek models and provider)
export const migrationV5: SettingsMigrator<
  z.infer<typeof SettingsV4Schema>,
  z.infer<typeof SettingsV5Schema>
> = {
  version: 5,
  migrate: (data: z.infer<typeof SettingsV4Schema>): z.infer<typeof SettingsV5Schema> => ({
    ...data,
    version: 5,
    models: _.unionBy(
      data.models,
      NEW_DEEPSEEK_MODELS,
      "id",
    ),
    providers: _.unionBy(
      data.providers,
      [DEEPSEEK_PROVIDER],
      "id",
    ),
  }),
};