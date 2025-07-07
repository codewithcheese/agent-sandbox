import { z } from "zod";
import _ from "lodash";
import { SettingsV7Schema } from "./07_add_cohere";
import type { SettingsMigrator } from "./types";

// V8 model schema (same as V7 - no changes to schema structure)
export const ModelV8Schema = z.discriminatedUnion("type", [
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

// Settings V8 Schema (independent definition with Fireworks models)
export const SettingsV8Schema = z.object({
  version: z.literal(8),
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
  models: z.array(ModelV8Schema),
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

// New Fireworks chat models to add in V8 (exact specifications from Fireworks AI public serverless catalogue, 7 Jul 2025)
const NEW_FIREWORKS_MODELS = [
  // Mixtral 8×7B Instruct
  {
    id: "accounts/fireworks/models/mixtral-8x7b-instruct",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 32768,
    outputTokenLimit: 32768,
    inputPrice: 0.50,
    outputPrice: 0.50,
  },
  // Mixtral 8×22B Instruct
  {
    id: "accounts/fireworks/models/mixtral-8x22b-instruct",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 65536,
    outputTokenLimit: 65536,
    inputPrice: 1.20,
    outputPrice: 1.20,
  },
  // Llama-3 70B Instruct
  {
    id: "accounts/fireworks/models/llama-v3-70b-instruct",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 8192,
    outputTokenLimit: 8192,
    inputPrice: 0.90,
    outputPrice: 0.90,
  },
  // Llama-3.1 405B Instruct (special output limit set by Fireworks)
  {
    id: "accounts/fireworks/models/llama-v3p1-405b-instruct",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 4096, // Limited by Fireworks, not full context window
    inputPrice: 3.00,
    outputPrice: 3.00,
  },
  // DeepSeek R1 (Fast)
  {
    id: "accounts/fireworks/models/deepseek-r1",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 163840,
    outputTokenLimit: 163840,
    inputPrice: 3.00,
    outputPrice: 8.00,
  },
  // DeepSeek R1 (Basic)
  {
    id: "accounts/fireworks/models/deepseek-r1-basic",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 160000,
    outputTokenLimit: 160000,
    inputPrice: 0.55,
    outputPrice: 2.19,
  },
  // DeepSeek R1 0528 (Fast)
  {
    id: "accounts/fireworks/models/deepseek-r1-0528",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 163840,
    outputTokenLimit: 163840,
    inputPrice: 3.00,
    outputPrice: 8.00,
  },
  // Qwen-3 235B-A22B
  {
    id: "accounts/fireworks/models/qwen3-235b-a22b",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 128000,
    outputTokenLimit: 128000,
    inputPrice: 0.22,
    outputPrice: 0.88,
  },
  // Qwen-3 30B-A3B
  {
    id: "accounts/fireworks/models/qwen3-30b-a3b",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 40000,
    outputTokenLimit: 40000,
    inputPrice: 0.15,
    outputPrice: 0.60,
  },
  // Llama-4 Maverick (Basic)
  {
    id: "accounts/fireworks/models/llama4-maverick-instruct-basic",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 1000000,
    outputTokenLimit: 1000000,
    inputPrice: 0.22,
    outputPrice: 0.88,
  },
  // Llama-4 Scout (Basic)
  {
    id: "accounts/fireworks/models/llama4-scout-instruct-basic",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 1048576,
    outputTokenLimit: 1048576,
    inputPrice: 0.15,
    outputPrice: 0.60,
  },
  // Phi-3 Mini 128K Instruct
  {
    id: "accounts/fireworks/models/phi-3-mini-128k-instruct",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 131072,
    outputTokenLimit: 131072,
    inputPrice: 0.10,
    outputPrice: 0.10,
  },
  // Phi-3.5 Vision Instruct
  {
    id: "accounts/fireworks/models/phi-3-vision-128k-instruct",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 32064,
    outputTokenLimit: 32064,
    inputPrice: 0.20,
    outputPrice: 0.20,
  },
  // DBRX (MoE 8×22B)
  {
    id: "accounts/fireworks/models/dbrx-instruct",
    provider: "fireworks",
    type: "chat" as const,
    inputTokenLimit: 65536,
    outputTokenLimit: 65536,
    inputPrice: 1.20,
    outputPrice: 1.20,
  },
];

// New Fireworks provider
const FIREWORKS_PROVIDER = {
  id: "fireworks",
  name: "Fireworks AI",
  requiredFields: ["apiKey"],
  optionalFields: ["baseURL"],
};

// Migration from V7 to V8 (adds Fireworks models and provider)
export const migrationV8: SettingsMigrator<
  z.infer<typeof SettingsV7Schema>,
  z.infer<typeof SettingsV8Schema>
> = {
  version: 8,
  migrate: (data: z.infer<typeof SettingsV7Schema>): z.infer<typeof SettingsV8Schema> => ({
    ...data,
    version: 8,
    models: _.unionBy(
      data.models,
      NEW_FIREWORKS_MODELS,
      "id",
    ),
    providers: _.unionBy(
      data.providers,
      [FIREWORKS_PROVIDER],
      "id",
    ),
  }),
};