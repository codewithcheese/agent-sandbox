import { Notice } from "obsidian";
import type AgentSandboxPlugin from "../plugin";
import {
  CURRENT_SETTINGS_VERSION,
  type CurrentSettings,
  SETTINGS_MIGRATIONS,
  SETTINGS_SCHEMAS,
} from "./settings";
import { createDebug } from "$lib/debug.ts";
import { SettingsTab } from "./settings-tab";

const debug = createDebug();

export class SettingsManager {
  settings: CurrentSettings;

  constructor(private plugin: AgentSandboxPlugin) {
    // Initialize with empty object and let migrations create the structure
    this.settings = this.migrateToLatest({});
  }

  /**
   * Migrate settings to the latest version with full type safety and validation
   */
  private migrateToLatest(data: unknown): CurrentSettings {
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

      // Validate source version is supported (0 is always supported as it means "start fresh")
      const minVersion = Math.min(...Object.keys(SETTINGS_SCHEMAS).map(Number));
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

      // todo: why does safePare return optional for all keys
      return validationResult.data as CurrentSettings;
    } catch (error) {
      console.error("Settings migration failed:", error);
      throw new Error(
        `Failed to migrate settings: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async init(): Promise<void> {
    await this.loadSettings();
    debug("Init settings", this.settings);
    this.plugin.addSettingTab(new SettingsTab(this.plugin.app, this.plugin));
  }

  async loadSettings(): Promise<void> {
    try {
      const data = (await this.plugin.loadData()) || {};
      this.settings = this.migrateToLatest(data);
      await this.saveSettings();
    } catch (error) {
      console.error("Settings migration failed, using defaults.", error);
      new Notice(
        "Settings migration failed. Please downgrade the plugin to the previous version and file an issue on GitHub.",
        8000,
      );
      // todo: create a backup of old settings, before resuming with defaults
      this.settings = this.migrateToLatest({});
    }
  }

  async saveSettings(): Promise<void> {
    await this.plugin.saveData(this.settings);
  }

  /**
   * Replace settings with new settings object and save
   */
  async replaceSettings(newSettings: CurrentSettings): Promise<void> {
    // Validate the new settings before saving
    const validationResult = this.validateSettings(newSettings);
    if (!validationResult.success) {
      throw new Error(
        `Settings validation failed: ${validationResult.error.message}`,
      );
    }
    debug("Replaced settings", newSettings);
    this.settings = newSettings;
    await this.saveSettings();
  }

  private validateSettings(settings: unknown): {
    success: boolean;
    error?: any;
  } {
    if (typeof settings !== "object" || settings === null) {
      return {
        success: false,
        error: { message: "Settings must be an object" },
      };
    }

    const settingsObj = settings as any;
    const version = settingsObj.version;

    // Get the schema for this version
    const schema = SETTINGS_SCHEMAS[version as keyof typeof SETTINGS_SCHEMAS];

    if (!schema) {
      const supportedVersions = Object.keys(SETTINGS_SCHEMAS).join(", ");
      return {
        success: false,
        error: {
          message: `Unsupported settings version: ${version}. Supported versions: ${supportedVersions}`,
        },
      };
    }

    return schema.safeParse(settings);
  }

  getSettings(): CurrentSettings {
    return this.settings;
  }
}
