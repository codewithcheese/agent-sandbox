import {
  CURRENT_SETTINGS_VERSION,
  type CurrentSettings,
  SETTINGS_MIGRATIONS,
  SETTINGS_SCHEMAS,
} from "./settings.ts";

export function migrateToLatest(data: unknown): CurrentSettings {
  try {
    // Extract version from data
    let currentData = data;
    let sourceVersion = 0; // Start from version 0 for empty/unknown data

    // Check if data is empty or null - treat as version 0
    if (
      !data ||
      (typeof data === "object" && Object.keys(data as object).length === 0)
    ) {
      sourceVersion = 0;
    } else if (typeof data === "object" && "version" in data) {
      sourceVersion = (data as { version: unknown }).version as number;
    }

    const maxVersion = CURRENT_SETTINGS_VERSION;

    if (sourceVersion < 0 || sourceVersion > maxVersion) {
      throw new Error(
        `Unsupported settings version: ${sourceVersion}. Supported versions: 0-${maxVersion}`,
      );
    }

    // Apply each migration in sequence starting from sourceVersion + 1
    for (let v = sourceVersion + 1; v <= CURRENT_SETTINGS_VERSION; v++) {
      const migration = SETTINGS_MIGRATIONS.find((m) => m.version === v);
      if (migration) {
        currentData = migration.migrate(currentData);
      }
    }

    // Validate the final result against the current version schema
    const currentSchema = SETTINGS_SCHEMAS[CURRENT_SETTINGS_VERSION];
    const validationResult = currentSchema.safeParse(currentData);
    if (!validationResult.success) {
      throw new Error(
        `Settings validation failed: ${validationResult.error.message}`,
      );
    }

    return validationResult.data as CurrentSettings;
  } catch (error) {
    console.error("Settings migration failed:", error);
    throw new Error(
      `Failed to migrate settings: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
