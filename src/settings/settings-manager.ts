import { Notice } from "obsidian";
import type AgentSandboxPlugin from "../plugin";
import { 
  SETTINGS_MIGRATIONS,
  SETTINGS_SCHEMAS,
  CURRENT_SETTINGS_VERSION,
  type CurrentSettings,
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
      if (!data || (typeof data === "object" && Object.keys(data as object).length === 0)) {
        sourceVersion = 0;
      } else if (typeof data === "object" && data !== null && "version" in data) {
        sourceVersion = (data as { version: unknown }).version as number;
      }

      // Validate source version is supported (0 is always supported as it means "start fresh")
      const minVersion = Math.min(...Object.keys(SETTINGS_SCHEMAS).map(Number));
      const maxVersion = CURRENT_SETTINGS_VERSION;
      
      if (sourceVersion < 0 || sourceVersion > maxVersion) {
        throw new Error(`Unsupported settings version: ${sourceVersion}. Supported versions: 0-${maxVersion}`);
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
        throw new Error(`Settings validation failed: ${validationResult.error.message}`);
      }
      
      return validationResult.data;
    } catch (error) {
      console.error("Settings migration failed:", error);
      throw new Error(
        `Failed to migrate settings: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Validate settings without migration (for testing)
   */
  validate(data: unknown): CurrentSettings {
    const currentSchema = SETTINGS_SCHEMAS[CURRENT_SETTINGS_VERSION];
    return currentSchema.parse(data);
  }

  /**
   * Check if data matches a specific version schema
   */
  isVersion(data: unknown, version: keyof typeof SETTINGS_SCHEMAS): boolean {
    const schema = SETTINGS_SCHEMAS[version];
    return schema ? schema.safeParse(data).success : false;
  }

  /**
   * Register settings manager with the plugin
   */
  static register(plugin: AgentSandboxPlugin): SettingsManager {
    const manager = new SettingsManager(plugin);

    // Store reference on plugin for easy access
    (plugin as any).settingsManager = manager;

    return manager;
  }

  /**
   * Initialize settings - load, migrate, and set up UI
   */
  async initialize(): Promise<void> {
    await this.loadSettings();
    this.setupUI();
  }

  /**
   * Load and migrate settings with atomic transaction
   */
  async loadSettings(): Promise<void> {
    try {
      const data = await this.plugin.loadData();

      if (!data) {
        // New installation - start with empty object and let migrations create the structure
        console.log("New installation: creating initial settings via migration system");
        this.settings = this.migrateToLatest({});
        await this.saveSettings();
      } else {
        // Existing installation - migrate but don't save until validation passes
        console.log("Existing installation: attempting migration");
        const migratedSettings = this.migrateToLatest(data);

        // Only assign and save after successful migration + validation
        this.settings = migratedSettings;
        console.log("Migration successful, saving updated settings");
        await this.saveSettings();
      }
    } catch (error) {
      console.error(
        "Settings migration failed, using defaults in memory only:",
        error,
      );
      new Notice(
        "Settings migration failed. Using defaults. Original settings preserved. Check console for details.",
        8000,
      );

      // Use migrated settings from empty object in memory but DON'T save (preserve original data)
      this.settings = this.migrateToLatest({});

      // Don't call saveSettings() here - keep original data intact
    }
  }

  /**
   * Save current settings to disk
   */
  async saveSettings(): Promise<void> {
    await this.plugin.saveData(this.settings);
  }

  /**
   * Update settings and save
   */
  async updateSettings(updates: Partial<CurrentSettings>): Promise<void> {
    const newSettings = { ...this.settings, ...updates };
    
    // Validate the merged settings before saving
    const validationResult = this.validateSettings(newSettings);
    if (!validationResult.success) {
      throw new Error(`Settings validation failed: ${validationResult.error.message}`);
    }
    
    this.settings = newSettings;
    await this.saveSettings();
  }

  /**
   * Replace settings with new settings object and save
   */
  async replaceSettings(newSettings: CurrentSettings): Promise<void> {
    // Validate the new settings before saving
    const validationResult = this.validateSettings(newSettings);
    if (!validationResult.success) {
      throw new Error(`Settings validation failed: ${validationResult.error.message}`);
    }
    
    this.settings = newSettings;
    await this.saveSettings();
  }

  /**
   * Validate settings against the appropriate schema based on version
   */
  private validateSettings(settings: unknown): { success: boolean; error?: any } {
    if (typeof settings !== 'object' || settings === null) {
      return { success: false, error: { message: 'Settings must be an object' } };
    }

    const settingsObj = settings as any;
    const version = settingsObj.version;

    // Get the appropriate schema for this version
    const schema = SETTINGS_SCHEMAS[version as keyof typeof SETTINGS_SCHEMAS];
    
    if (!schema) {
      const supportedVersions = Object.keys(SETTINGS_SCHEMAS).join(', ');
      return { 
        success: false, 
        error: { message: `Unsupported settings version: ${version}. Supported versions: ${supportedVersions}` } 
      };
    }

    return schema.safeParse(settings);
  }

  /**
   * Setup settings UI tab
   */
  private setupUI(): void {
    this.plugin.addSettingTab(new SettingsTab(this.plugin.app, this.plugin));
  }

  /**
   * Get settings for external access (backward compatibility)
   */
  getSettings(): CurrentSettings {
    return this.settings;
  }
}
