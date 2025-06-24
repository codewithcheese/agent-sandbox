import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { RenameTracker } from "../../src/chat/rename-tracker.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import type { TFile } from "obsidian";

describe("syncAll with timestamp filtering", () => {
  let overlay: VaultOverlay;
  let tracker: RenameTracker;
  let mockPlugin: any;

  beforeEach(() => {
    // Reset singleton
    (RenameTracker as any).instance = null;
    
    // Mock plugin and register tracker
    mockPlugin = {
      registerEvent: vi.fn(),
      app: { 
        vault: {
          on: vi.fn().mockReturnValue({}), // Mock event reference
        },
        loadLocalStorage: vi.fn().mockReturnValue([]),
        saveLocalStorage: vi.fn(),
      }
    };
    tracker = RenameTracker.register(mockPlugin);
    
    overlay = new VaultOverlay(vault);
  });

  afterEach(async () => {
    await helpers.reset();
    (RenameTracker as any).instance = null;
  });

  describe("GIVEN file renamed after timestamp", () => {
    let originalFile: TFile;
    const baseTime = new Date("2024-01-01T10:00:00Z");
    const renameTime = new Date("2024-01-01T11:00:00Z");

    beforeEach(async () => {
      // Create and track file
      originalFile = helpers.addFile("test.md", "content");
      await overlay.modify(originalFile, "content");
      
      // Mock rename time and log rename
      vi.spyOn(Date, 'now').mockReturnValue(renameTime.getTime());
      tracker['logRename']("test.md", "renamed.md");
      
      // Rename in vault
      await vault.rename(originalFile, "renamed.md");
    });

    it("should detect rename when sinceTimestamp is before rename", async () => {
      const result = await overlay.syncAll(baseTime);
      
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("renamed.md");
      expect(result[0].diff).toContain("Renamed test.md → renamed.md");
    });

    it("should not detect rename when sinceTimestamp is after rename", async () => {
      const afterRename = new Date("2024-01-01T12:00:00Z");
      const result = await overlay.syncAll(afterRename);
      
      expect(result).toHaveLength(1);
      expect(result[0].diff).toContain("delete"); // Should treat as deletion
    });
  });

  describe("GIVEN file renamed before timestamp", () => {
    let originalFile: TFile;
    const renameTime = new Date("2024-01-01T10:00:00Z");
    const checkpointTime = new Date("2024-01-01T11:00:00Z");

    beforeEach(async () => {
      // Create and track file
      originalFile = helpers.addFile("test.md", "content");
      await overlay.modify(originalFile, "content");
      
      // Mock rename time and log rename
      vi.spyOn(Date, 'now').mockReturnValue(renameTime.getTime());
      tracker['logRename']("test.md", "renamed.md");
      
      // Rename in vault
      await vault.rename(originalFile, "renamed.md");
    });

    it("should not apply old rename when sinceTimestamp is after rename", async () => {
      const result = await overlay.syncAll(checkpointTime);
      
      expect(result).toHaveLength(1);
      expect(result[0].diff).toContain("delete"); // Should treat as deletion
    });
  });

  describe("GIVEN no timestamp provided", () => {
    let originalFile: TFile;

    beforeEach(async () => {
      // Create and track file
      originalFile = helpers.addFile("test.md", "content");
      await overlay.modify(originalFile, "content");
      
      // Log rename
      tracker['logRename']("test.md", "renamed.md");
      
      // Rename in vault
      await vault.rename(originalFile, "renamed.md");
    });

    it("should apply all recent renames", async () => {
      const result = await overlay.syncAll(); // No timestamp
      
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("renamed.md");
      expect(result[0].diff).toContain("Renamed test.md → renamed.md");
    });
  });

  describe("GIVEN multiple renames in chain", () => {
    let originalFile: TFile;
    const baseTime = new Date("2024-01-01T10:00:00Z");

    beforeEach(async () => {
      // Create and track file
      originalFile = helpers.addFile("original.md", "content");
      await overlay.modify(originalFile, "content");
      
      // Mock time and create rename chain: original → intermediate → final
      vi.spyOn(Date, 'now').mockReturnValue(baseTime.getTime() + 1000);
      (tracker as any).logRename("original.md", "intermediate.md");
      
      vi.spyOn(Date, 'now').mockReturnValue(baseTime.getTime() + 2000);
      (tracker as any).logRename("intermediate.md", "final.md");
      
      // Vault file is now at final location
      await vault.rename(originalFile, "final.md");
    });

    it("should follow rename chain to final destination", async () => {
      const result = await overlay.syncAll(baseTime);
      
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("final.md");
      expect(result[0].diff).toContain("Renamed original.md → final.md");
    });
  });
});
