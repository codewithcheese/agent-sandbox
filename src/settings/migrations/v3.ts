import { z } from "zod";
import _ from "lodash";
import { SettingsV2Schema } from "./v2";
import type { SettingsMigrator } from "./types";

// Settings V3 Schema (independent definition with Gemini models)
// ❌ NOT USING .extend() - We avoid .extend() entirely for consistency and predictability
// ✅ USING independent definition - All migration schemas use independent definitions
// Rule: Always use independent schema definitions in migrations to avoid type inference issues
export const SettingsV3Schema = z.object({
  version: z.literal(3),
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
  models: z.array(z.union([
    z.object({
      id: z.string(),
      provider: z.string(),
      type: z.literal("chat"),
      inputTokenLimit: z.number().optional(),
      outputTokenLimit: z.number().optional(),
    }),
    z.object({
      id: z.string(),
      provider: z.string(),
      type: z.literal("transcription"),
    }),
    z.object({
      id: z.string(),
      provider: z.string(),
      type: z.literal("embedding"),
      dimensions: z.number(),
    }),
  ])),
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

// Migration from V2 to V3 (adds latest Gemini models)
export const migrationV3: SettingsMigrator<
  z.infer<typeof SettingsV2Schema>,
  z.infer<typeof SettingsV3Schema>
> = {
  version: 3,
  migrate: (data: z.infer<typeof SettingsV2Schema>): z.infer<typeof SettingsV3Schema> => ({
    ...data,
    version: 3,
    models: _.unionBy(
      data.models,
      [
        {
          id: "gemini-2.5-pro",
          provider: "gemini",
          type: "chat",
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
        },
        {
          id: "gemini-2.5-flash",
          provider: "gemini",
          type: "chat",
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
        },
        {
          id: "gemini-2.5-flash-lite-preview-06-17",
          provider: "gemini",
          type: "chat",
          inputTokenLimit: 1000000,
          outputTokenLimit: 64000,
        },
      ],
      "id",
    ),
  }),
};
