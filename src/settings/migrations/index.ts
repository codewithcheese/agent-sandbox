import { migrationV1 } from "./v1";
import { migrationV2 } from "./v2";
import { migrationV3 } from "./v3";
import { migrationV4 } from "./v4";
import { migrationV5 } from "./v5";

export * from "./types";

// Export all migrations in order
export const SETTINGS_MIGRATIONS = [
  migrationV1,
  migrationV2,
  migrationV3,
  migrationV4,
  migrationV5,
];
