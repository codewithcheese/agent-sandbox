import { Notice } from "obsidian";
import type AgentSandboxPlugin from "../plugin";
import { type CurrentSettings, SETTINGS_SCHEMAS } from "./settings";
import { createDebug } from "$lib/debug.ts";
import { SettingsTab } from "./settings-tab";
import {
  migrateToLatest,
  migrateToLatestWithMetadata,
  needsMigration,
} from "./migrator.ts";
import { usePlugin } from "$lib/utils";

const debug = createDebug();

export class SettingsManager {
  settings: CurrentSettings;

  constructor(private plugin: AgentSandboxPlugin) {
    // Initialize with empty object and let migrations create the structure
    this.settings = migrateToLatest({});
  }

  async init(): Promise<void> {
    await this.loadSettings();
    debug("Init settings", this.settings);
    this.plugin.addSettingTab(new SettingsTab(this.plugin.app, this.plugin));
  }

  async loadSettings(): Promise<void> {
    try {
      const data = (await this.plugin.loadData()) || {};

      // Check if migrations are needed and create proactive backup
      if (needsMigration(data)) {
        await this.backupBeforeMigration(data);
      }

      const migrationResult = migrateToLatestWithMetadata(data);
      this.settings = migrationResult.settings;

      if (migrationResult.migrationsApplied) {
        debug(
          `Settings migrated from V${migrationResult.sourceVersion} to V${migrationResult.targetVersion}`,
        );
        await this.saveSettings();
      }
    } catch (error) {
      console.error("Settings migration failed, using defaults.", error);
      new Notice(
        "Settings migration failed. Please downgrade the plugin to the previous version and file an issue on GitHub.",
      );
      // Use defaults since backup was already created before migration attempt
      this.settings = migrateToLatest({});
    }
  }

  private async backupBeforeMigration(data: unknown): Promise<void> {
    const { app } = usePlugin();
    const dataFilePath = `${this.plugin.manifest.dir}/data.json`;

    // Get current version for backup filename
    let currentVersion = 0;
    if (data && typeof data === "object" && "version" in data) {
      currentVersion = (data as { version: unknown }).version as number;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFilePath = `${this.plugin.manifest.dir}/data.json.v${currentVersion}.${timestamp}.bak`;

    try {
      // Read the current data.json
      const currentData = await app.vault.read(dataFilePath);
      // Write it to a backup file
      await app.vault.write(backupFilePath, currentData);
      debug(
        `Settings backup created before migration: data.json.v${currentVersion}.${timestamp}.bak`,
      );
      new Notice(`Settings backed up before migration from V${currentVersion}`);
    } catch (error) {
      console.warn("Failed to create backup before migration:", error);
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
