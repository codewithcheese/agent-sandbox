import { z } from "zod";
import _ from "lodash";
import { SettingsV3Schema } from "./03_gemini_25.ts";
import type { SettingsMigrator } from "./types";

// V4 model schema with required pricing
export const ModelV4Schema = z.discriminatedUnion("type", [
  // Chat model schema with required pricing
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("chat"),
    inputTokenLimit: z.number(),
    outputTokenLimit: z.number(),
    inputPrice: z.number(), // Required in V4
    outputPrice: z.number(), // Required in V4
  }),
  // Embedding model schema (unchanged)
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("embedding"),
    dimensions: z.number(),
  }),
  // Transcription model schema with required pricing
  z.object({
    id: z.string(),
    provider: z.string(),
    type: z.literal("transcription"),
    pricePerHour: z.number(), // Required in V4
  }),
]);

// Settings V4 Schema (independent definition with required pricing)
// ❌ NOT USING .extend() - We're changing field requirements (optional → required pricing)
// ✅ USING independent definition - Required when changing existing field constraints
// Future versions: Use .extend() for adding fields, independent definition for changing requirements
export const SettingsV4Schema = z
  .object({
    version: z.literal(4),
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
    models: z.array(ModelV4Schema),
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

// Pricing data for existing models
const CHAT_MODEL_PRICING: Record<
  string,
  { inputPrice: number; outputPrice: number }
> = {
  o1: { inputPrice: 15, outputPrice: 60 },
  "o3-mini": { inputPrice: 1.1, outputPrice: 4.4 },
  "gpt-4.5": { inputPrice: 75, outputPrice: 150 },
  "gpt-4o": { inputPrice: 5, outputPrice: 20 },
  "gpt-4o-mini": { inputPrice: 0.6, outputPrice: 2.4 },
  "claude-opus-4-20250514": { inputPrice: 15, outputPrice: 75 },
  "claude-sonnet-4-20250514": { inputPrice: 3, outputPrice: 15 },
  "claude-3-7-sonnet-20250219": { inputPrice: 3, outputPrice: 15 },
  "claude-3-5-sonnet-20241022": { inputPrice: 3, outputPrice: 15 },
  "claude-3-5-haiku-20241022": { inputPrice: 0.8, outputPrice: 4 },
  "gemini-2.0-flash": { inputPrice: 0.1, outputPrice: 0.4 },
  "gemini-2.0-flash-lite": { inputPrice: 0.075, outputPrice: 0.3 },
  "gemini-1.5-pro": { inputPrice: 1.25, outputPrice: 5.0 },
  "gemini-1.5-flash": { inputPrice: 0.075, outputPrice: 0.3 },
  "gemini-1.5-flash-8b": { inputPrice: 0.0375, outputPrice: 0.15 },
  "gemini-2.5-pro": { inputPrice: 1.25, outputPrice: 10.0 },
  "gemini-2.5-flash": { inputPrice: 0.3, outputPrice: 2.5 },
  "gemini-2.5-flash-lite-preview-06-17": { inputPrice: 0.1, outputPrice: 0.4 },
};

const TRANSCRIPTION_MODEL_PRICING: Record<string, { pricePerHour: number }> = {
  universal: { pricePerHour: 0.27 }, // AssemblyAI universal model
};

// New OpenAI models to add in V4
const NEW_OPENAI_MODELS = [
  {
    id: "o3",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 200000,
    outputTokenLimit: 60000,
    inputPrice: 2,
    outputPrice: 8,
  },
  {
    id: "o4-mini",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 200000,
    outputTokenLimit: 4400,
    inputPrice: 1.1,
    outputPrice: 4.4,
  },
  {
    id: "o3-pro",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 200000,
    outputTokenLimit: 60000,
    inputPrice: 20,
    outputPrice: 80,
  },
  {
    id: "o1-pro",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 200000,
    outputTokenLimit: 60000,
    inputPrice: 150,
    outputPrice: 600,
  },
  {
    id: "gpt-4.1",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 128000,
    outputTokenLimit: 8192,
    inputPrice: 2,
    outputPrice: 8,
  },
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 128000,
    outputTokenLimit: 8192,
    inputPrice: 0.4,
    outputPrice: 1.6,
  },
  {
    id: "gpt-4.1-nano",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 128000,
    outputTokenLimit: 8192,
    inputPrice: 0.1,
    outputPrice: 0.4,
  },
  {
    id: "o3-deep-research",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 200000,
    outputTokenLimit: 60000,
    inputPrice: 10,
    outputPrice: 40,
  },
  {
    id: "o4-mini-deep-research",
    provider: "openai",
    type: "chat" as const,
    inputTokenLimit: 200000,
    outputTokenLimit: 4400,
    inputPrice: 2,
    outputPrice: 8,
  },
];

// Migration from V3 to V4 (adds pricing information and new models)
export const migrationV4: SettingsMigrator<
  z.infer<typeof SettingsV3Schema>,
  z.infer<typeof SettingsV4Schema>
> = {
  version: 4,
  migrate: (
    data: z.infer<typeof SettingsV3Schema>,
  ): z.infer<typeof SettingsV4Schema> => ({
    ...data,
    version: 4,
    models: _.unionBy(
      data.models.map((model) => {
        // Add pricing to existing models
        if (model.type === "chat") {
          const pricing = CHAT_MODEL_PRICING[model.id];
          if (pricing) {
            return {
              ...model,
              inputPrice: pricing.inputPrice,
              outputPrice: pricing.outputPrice,
            };
          }
          // Fallback for unknown chat models - use zero pricing
          return { ...model, inputPrice: 0, outputPrice: 0 };
        } else if (model.type === "transcription") {
          const pricing = TRANSCRIPTION_MODEL_PRICING[model.id];
          if (pricing) {
            return { ...model, pricePerHour: pricing.pricePerHour };
          }
          // Fallback for unknown transcription models - use zero pricing
          return { ...model, pricePerHour: 0 };
        }
        // Embedding models don't need pricing changes
        return model;
      }),
      NEW_OPENAI_MODELS,
      "id",
    ),
  }),
};
