import { z } from "zod";
import _ from "lodash";
import { SettingsV1Schema } from "./01_init.ts";
import type { SettingsMigrator } from "./types";

// Settings V2 Schema (independent definition with postProcessing)
// ❌ NOT USING .extend() - We're changing the structure of the 'recording' object
// ✅ USING independent definition - Required when changing existing object structures
// Rule: Use .extend() only for adding completely new top-level fields, not modifying existing ones
export const SettingsV2Schema = z
  .object({
    version: z.literal(2),
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
    models: z.array(
      z.union([
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
      ]),
    ),
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

// Migration from V1 to V2 (adds postProcessing)
export const migrationV2: SettingsMigrator<
  z.infer<typeof SettingsV1Schema>,
  z.infer<typeof SettingsV2Schema>
> = {
  version: 2,
  migrate: (
    data: z.infer<typeof SettingsV1Schema>,
  ): z.infer<typeof SettingsV2Schema> => ({
    ...data,
    version: 2,
    models: _.unionBy(data.models, [], "id"),
    providers: _.unionBy(data.providers, [], "id"),
    recording: {
      ...data.recording,
      postProcessing: {
        enabled: true,
        prompt: `You are a transcript cleaner. Your task is to clean up the following transcript by making minor corrections while preserving the original meaning and content.

<transcript>
{{ transcript }}
</transcript>

Rules for cleaning:
1. Remove filler words (um, uh, you know, like, etc.)
2. Remove false starts and incomplete thoughts
3. Fix obvious repeated words
4. Correct basic punctuation and capitalization
5. Fix clear homophones based on context (there/their/they're, to/too/two)
6. Do NOT change the vocabulary, meaning, or structure
7. Do NOT add new information or interpretations
8. Preserve technical terms and proper nouns as much as possible

Output the cleaned transcript within <cleaned> tags. Do not include any explanation or additional text outside the tags.`,
        accountId: undefined,
        modelId: undefined,
      },
    },
  }),
};
