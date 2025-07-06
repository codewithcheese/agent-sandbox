import { z } from "zod";
import { SettingsV1Schema } from "./migrations/01_init.ts";
import { SettingsV2Schema } from "./migrations/02_recording_post_processing.ts";
import { SettingsV3Schema } from "./migrations/03_gemini_25.ts";
import { SettingsV4Schema } from "./migrations/04_model_pricing.ts";
import { SettingsV5Schema } from "./migrations/05_add_deepseek.ts";
import { SettingsV6Schema } from "./migrations/06_add_xai.ts";
export { SETTINGS_MIGRATIONS, type SettingsMigrator } from "./migrations";

export type AIAccount = {
  id: string;
  name: string;
  provider: string;
  config: Record<string, any>;
};

export type ChatModel = {
  id: string;
  provider: string;
  type: "chat";
  inputTokenLimit: number;
  outputTokenLimit: number;
  inputPrice: number;
  outputPrice: number;
};

export type EmbeddingModel = {
  id: string;
  provider: string;
  type: "embedding";
  dimensions: number;
};

export type TranscriptionModel = {
  id: string;
  provider: string;
  type: "transcription";
  pricePerHour: number;
};

export type AnyModel = ChatModel | EmbeddingModel | TranscriptionModel;

export const CURRENT_SETTINGS_VERSION = 6 as const;

export const SETTINGS_SCHEMAS = {
  1: SettingsV1Schema,
  2: SettingsV2Schema,
  3: SettingsV3Schema,
  4: SettingsV4Schema,
  5: SettingsV5Schema,
  6: SettingsV6Schema,
} as const;

type CurrentSchema = (typeof SETTINGS_SCHEMAS)[typeof CURRENT_SETTINGS_VERSION];

export type CurrentSettings = z.infer<CurrentSchema>;
