import { z } from "zod";
import _ from "lodash";
import { SettingsV5Schema } from "./05_add_deepseek.ts";
import type { SettingsMigrator } from "./types";

// V6 model schema (same as V5 - no changes to schema structure)
export const ModelV6Schema = z.discriminatedUnion("type", [
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

// Settings V6 Schema (independent definition with XAI GROK models)
export const SettingsV6Schema = z
  .object({
    version: z.literal(6),
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
    accounts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        provider: z.string(),
        config: z.record(z.any()),
      }),
    ),
    models: z.array(ModelV6Schema),
    providers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        requiredFields: z.array(z.string()),
        optionalFields: z.array(z.string()),
      }),
    ),
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
  })
  .strict();

// New XAI GROK-3 models to add in V6
const NEW_XAI_MODELS = [
  {
    id: "grok-3",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 3.0,
    outputPrice: 15.0,
  },
  {
    id: "grok-3-latest",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 3.0,
    outputPrice: 15.0,
  },
  {
    id: "grok-3-fast",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 5.0,
    outputPrice: 25.0,
  },
  {
    id: "grok-3-fast-latest",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 5.0,
    outputPrice: 25.0,
  },
  {
    id: "grok-3-mini",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 0.3,
    outputPrice: 0.5,
  },
  {
    id: "grok-3-mini-latest",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 0.3,
    outputPrice: 0.5,
  },
  {
    id: "grok-3-mini-fast",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 0.6,
    outputPrice: 4.0,
  },
  {
    id: "grok-3-mini-fast-latest",
    provider: "xai",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 0.6,
    outputPrice: 4.0,
  },
];

// New XAI provider
const XAI_PROVIDER = {
  id: "xai",
  name: "xAI",
  requiredFields: ["apiKey"],
  optionalFields: [],
};

// Migration from V5 to V6 (adds XAI GROK-3 models and provider)
export const migrationV6: SettingsMigrator<
  z.infer<typeof SettingsV5Schema>,
  z.infer<typeof SettingsV6Schema>
> = {
  version: 6,
  migrate: (
    data: z.infer<typeof SettingsV5Schema>,
  ): z.infer<typeof SettingsV6Schema> => ({
    ...data,
    version: 6,
    models: _.unionBy(data.models, NEW_XAI_MODELS, "id"),
    providers: _.unionBy(data.providers, [XAI_PROVIDER], "id"),
  }),
};
