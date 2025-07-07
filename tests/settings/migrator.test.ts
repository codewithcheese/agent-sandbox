import { describe, expect, it } from "vitest";
import { migrateToLatest } from "../../src/settings/migrator";
import {
  CURRENT_SETTINGS_VERSION,
  SETTINGS_SCHEMAS,
  SETTINGS_MIGRATIONS,
  type CurrentSettings,
} from "../../src/settings/settings";

describe("Settings Migrator (Generic)", () => {
  describe("migrateToLatest", () => {
    it("should migrate from empty object to current version", () => {
      const result = migrateToLatest({});
      
      expect(result.version).toBe(CURRENT_SETTINGS_VERSION);
      
      // Validate against current schema
      const schema = SETTINGS_SCHEMAS[CURRENT_SETTINGS_VERSION];
      const validation = schema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    it("should handle null/undefined input", () => {
      [null, undefined].forEach(input => {
        const result = migrateToLatest(input);
        expect(result.version).toBe(CURRENT_SETTINGS_VERSION);
        
        const schema = SETTINGS_SCHEMAS[CURRENT_SETTINGS_VERSION];
        expect(schema.safeParse(result).success).toBe(true);
      });
    });

    // Test migration from each version to current
    Object.keys(SETTINGS_SCHEMAS).forEach(versionStr => {
      const version = parseInt(versionStr);
      if (version < CURRENT_SETTINGS_VERSION) {
        it(`should migrate from V${version} to current version`, () => {
          // Create minimal valid settings for this version
          const schema = SETTINGS_SCHEMAS[version as keyof typeof SETTINGS_SCHEMAS];
          const minimalSettings = createMinimalSettings(version);
          
          // Validate input is valid for source version
          expect(schema.safeParse(minimalSettings).success).toBe(true);
          
          // Migrate to current
          const result = migrateToLatest(minimalSettings);
          
          // Validate output
          expect(result.version).toBe(CURRENT_SETTINGS_VERSION);
          const currentSchema = SETTINGS_SCHEMAS[CURRENT_SETTINGS_VERSION];
          expect(currentSchema.safeParse(result).success).toBe(true);
          
          // Ensure data preservation
          expect(result.services).toBeDefined();
          expect(result.models).toBeDefined();
          expect(result.providers).toBeDefined();
        });
      }
    });

    it("should preserve custom data during migration", () => {
      const customData = {
        version: 1,
        services: { rapidapi: { name: "Custom API", apiKey: "secret-key" } },
        defaults: { modelId: "custom-model", accountId: "custom-account" },
        vault: { chatsPath: "custom-path" },
        accounts: [{ id: "acc1", name: "Custom", provider: "test", config: {} }],
        models: [{ id: "custom", provider: "test", type: "chat", inputTokenLimit: 1000, outputTokenLimit: 500 }],
        providers: [{ id: "test", name: "Test", requiredFields: [], optionalFields: [] }],
        recording: { transcriptionsPath: "custom-transcriptions" },
        title: { prompt: "custom prompt" },
        agents: { templateRepairAgentPath: "custom-agent-path" },
      };

      const result = migrateToLatest(customData);
      
      // Custom values should be preserved
      expect(result.services.rapidapi.name).toBe("Custom API");
      expect(result.services.rapidapi.apiKey).toBe("secret-key");
      expect(result.defaults.modelId).toBe("custom-model");
      expect(result.vault.chatsPath).toBe("custom-path");
      expect(result.accounts).toHaveLength(1);
      expect(result.models.some(m => m.id === "custom")).toBe(true);
    });

    it("should handle current version without changes", () => {
      const currentSettings = migrateToLatest({});
      const result = migrateToLatest(currentSettings);
      
      expect(result).toEqual(currentSettings);
    });

    it("should throw for unsupported versions", () => {
      const invalidVersions = [-1, 999];
      
      invalidVersions.forEach(version => {
        expect(() => migrateToLatest({ version }))
          .toThrow(/Unsupported settings version/);
      });
      
      // Test invalid version type (should fail validation)
      expect(() => migrateToLatest({ version: "invalid" }))
        .toThrow(/Failed to migrate settings/);
    });

    it("should validate all migration outputs", () => {
      // Test that each migration produces valid output
      SETTINGS_MIGRATIONS.forEach(migration => {
        const version = migration.version;
        const minimalInput = version === 1 ? {} : createMinimalSettings(version - 1);
        
        const result = migration.migrate(minimalInput);
        
        const schema = SETTINGS_SCHEMAS[version as keyof typeof SETTINGS_SCHEMAS];
        const validation = schema.safeParse(result);
        
        expect(validation.success, `Migration to V${version} should produce valid output`).toBe(true);
      });
    });

    // Test specific features added in each version
    it("should add expected features in each version", () => {
      const features = {
        2: (result: any) => expect(result.recording.postProcessing).toBeDefined(),
        3: (result: any) => expect(result.models.some((m: any) => m.id.includes("gemini-2.5"))).toBe(true),
        4: (result: any) => {
          const chatModels = result.models.filter((m: any) => m.type === "chat");
          const modelsWithPricing = chatModels.filter((m: any) => m.inputPrice !== undefined);
          expect(modelsWithPricing.length).toBeGreaterThan(0);
        },
        5: (result: any) => {
          const deepSeekModels = result.models.filter((m: any) => m.provider === "deepseek");
          expect(deepSeekModels.length).toBe(2);
          expect(deepSeekModels.some((m: any) => m.id === "deepseek-chat")).toBe(true);
          expect(deepSeekModels.some((m: any) => m.id === "deepseek-reasoner")).toBe(true);
          const deepSeekProvider = result.providers.find((p: any) => p.id === "deepseek");
          expect(deepSeekProvider).toBeDefined();
          expect(deepSeekProvider.name).toBe("DeepSeek");
        },
        6: (result: any) => {
          const xaiModels = result.models.filter((m: any) => m.provider === "xai");
          expect(xaiModels.length).toBe(8);
          expect(xaiModels.some((m: any) => m.id === "grok-3")).toBe(true);
          expect(xaiModels.some((m: any) => m.id === "grok-3-mini")).toBe(true);
          expect(xaiModels.some((m: any) => m.id === "grok-3-fast")).toBe(true);
          const xaiProvider = result.providers.find((p: any) => p.id === "xai");
          expect(xaiProvider).toBeDefined();
          expect(xaiProvider.name).toBe("xAI");
        },
        7: (result: any) => {
          const cohereModels = result.models.filter((m: any) => m.provider === "cohere");
          expect(cohereModels.length).toBe(8);
          expect(cohereModels.some((m: any) => m.id === "command-r-plus")).toBe(true);
          expect(cohereModels.some((m: any) => m.id === "command-r")).toBe(true);
          expect(cohereModels.some((m: any) => m.id === "command-r7b")).toBe(true);
          expect(cohereModels.some((m: any) => m.id === "embed-english-v3.0")).toBe(true);
          const cohereProvider = result.providers.find((p: any) => p.id === "cohere");
          expect(cohereProvider).toBeDefined();
          expect(cohereProvider.name).toBe("Cohere");
        },
        8: (result: any) => {
          const fireworksModels = result.models.filter((m: any) => m.provider === "fireworks");
          expect(fireworksModels.length).toBe(14);
          expect(fireworksModels.some((m: any) => m.id === "accounts/fireworks/models/mixtral-8x7b-instruct")).toBe(true);
          expect(fireworksModels.some((m: any) => m.id === "accounts/fireworks/models/deepseek-r1-0528")).toBe(true);
          expect(fireworksModels.some((m: any) => m.id === "accounts/fireworks/models/llama4-maverick-instruct-basic")).toBe(true);
          expect(fireworksModels.some((m: any) => m.id === "accounts/fireworks/models/qwen3-235b-a22b")).toBe(true);
          const fireworksProvider = result.providers.find((p: any) => p.id === "fireworks");
          expect(fireworksProvider).toBeDefined();
          expect(fireworksProvider.name).toBe("Fireworks AI");
        },
      };

      Object.entries(features).forEach(([versionStr, testFn]) => {
        const version = parseInt(versionStr);
        const result = migrateToLatest(createMinimalSettings(version - 1));
        testFn(result);
      });
    });
  });
});

// Helper function to create minimal valid settings for a given version
function createMinimalSettings(version: number): any {
  const base = {
    services: { rapidapi: { name: "RapidAPI", apiKey: "" } },
    defaults: { modelId: "test-model", accountId: "" },
    vault: { chatsPath: "chats" },
    accounts: [],
    models: [],
    providers: [],
    recording: { transcriptionsPath: "transcriptions" },
    title: { prompt: "test prompt" },
    agents: { templateRepairAgentPath: null },
  };

  switch (version) {
    case 1:
      return { version: 1, ...base };
    case 2:
      return {
        version: 2,
        ...base,
        recording: {
          ...base.recording,
          postProcessing: { enabled: true, prompt: "test" },
        },
      };
    case 3:
      return {
        version: 3,
        ...base,
        recording: {
          ...base.recording,
          postProcessing: { enabled: true, prompt: "test" },
        },
      };
    case 4:
      return {
        version: 4,
        ...base,
        models: [
          {
            id: "test-chat",
            provider: "test",
            type: "chat",
            inputTokenLimit: 1000,
            outputTokenLimit: 500,
            inputPrice: 1.0,
            outputPrice: 2.0,
          },
        ],
        recording: {
          ...base.recording,
          postProcessing: { enabled: true, prompt: "test" },
        },
      };
    case 5:
      return {
        version: 5,
        ...base,
        models: [
          {
            id: "test-chat",
            provider: "test",
            type: "chat",
            inputTokenLimit: 1000,
            outputTokenLimit: 500,
            inputPrice: 1.0,
            outputPrice: 2.0,
          },
        ],
        recording: {
          ...base.recording,
          postProcessing: { enabled: true, prompt: "test" },
        },
      };
    case 6:
      return {
        version: 6,
        ...base,
        models: [
          {
            id: "test-chat",
            provider: "test",
            type: "chat",
            inputTokenLimit: 1000,
            outputTokenLimit: 500,
            inputPrice: 1.0,
            outputPrice: 2.0,
          },
        ],
        recording: {
          ...base.recording,
          postProcessing: { enabled: true, prompt: "test" },
        },
      };
    case 7:
      return {
        version: 7,
        ...base,
        models: [
          {
            id: "test-chat",
            provider: "test",
            type: "chat",
            inputTokenLimit: 1000,
            outputTokenLimit: 500,
            inputPrice: 1.0,
            outputPrice: 2.0,
          },
        ],
        recording: {
          ...base.recording,
          postProcessing: { enabled: true, prompt: "test" },
        },
      };
    default:
      throw new Error(`Unsupported test version: ${version}`);
  }
}
