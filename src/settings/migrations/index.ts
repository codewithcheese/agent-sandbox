import { migrationV1 } from "./01_init.ts";
import { migrationV2 } from "./02_recording_post_processing.ts";
import { migrationV3 } from "./03_gemini_25.ts";
import { migrationV4 } from "./04_model_pricing.ts";
import { migrationV5 } from "./05_add_deepseek.ts";
import { migrationV6 } from "./06_add_xai.ts";
import { migrationV7 } from "./07_add_cohere.ts";

export * from "./types";

// Export all migrations in order
export const SETTINGS_MIGRATIONS = [
  migrationV1,
  migrationV2,
  migrationV3,
  migrationV4,
  migrationV5,
  migrationV6,
  migrationV7,
];
