import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { RenameTracker } from "../../src/chat/rename-tracker.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import { getText, isTrashed } from "$lib/utils/loro.ts";
import type { TFile, TFolder } from "obsidian";

describe("syncRename", () => {
  let overlay: VaultOverlay;

  beforeEach(() => {
    overlay = new VaultOverlay(vault);
  });

  afterEach(async () => {
    await helpers.reset();
    // Reset RenameTracker singleton to avoid test interference
    (RenameTracker as any).instance = null;
  });

  describe("Basic rename scenarios", () => {
    describe("GIVEN tracked file renamed in vault", () => {
      let originalFile: TFile;

      beforeEach(async () => {
        // Create and track original file
        originalFile = helpers.addFile("original.md", "Original content");
        await overlay.modify(originalFile, "Original content"); // Create tracking

        // Rename in vault
        await vault.rename(originalFile, "renamed.md");
      });

      it("SHOULD move tracking and proposed nodes to new path", async () => {
        const result = await overlay.syncRename("original.md", "renamed.md");

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          path: "renamed.md",
          diff: "Renamed original.md → renamed.md",
        });

        // Original path should be empty
        expect(overlay.trackingFS.findByPath("original.md")).toBeUndefined();
        expect(overlay.proposedFS.findByPath("original.md")).toBeUndefined();

        // New path should have the nodes
        const trackingNode = overlay.trackingFS.findByPath("renamed.md");
        const proposedNode = overlay.proposedFS.findByPath("renamed.md");

        expect(trackingNode).toBeTruthy();
        expect(proposedNode).toBeTruthy();
        expect(trackingNode?.id).toBe(proposedNode?.id);
        expect(getText(proposedNode)).toBe("Original content");
      });
    });

    describe("GIVEN tracked file with AI modifications renamed in vault", () => {
      let originalFile: TFile;

      beforeEach(async () => {
        // Create, track, and modify file
        originalFile = helpers.addFile("original.md", "Original content");
        await overlay.modify(originalFile, "Original content\n\nAI addition");

        // Rename in vault
        await vault.rename(originalFile, "renamed.md");
      });

      it("SHOULD preserve AI modifications at new path", async () => {
        const result = await overlay.syncRename("original.md", "renamed.md");

        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("renamed.md");

        // Check content is preserved
        const proposedNode = overlay.proposedFS.findByPath("renamed.md");
        expect(getText(proposedNode)).toBe("Original content\n\nAI addition");
      });
    });

    describe("GIVEN folder renamed in vault", () => {
      let originalFolder: TFolder;
      let childFile: TFile;

      beforeEach(async () => {
        // Create folder with child file
        originalFolder = helpers.addFolder("original-folder");
        childFile = helpers.addFile(
          "original-folder/child.md",
          "Child content",
        );
        await overlay.modify(childFile, "Child content"); // Create tracking

        // Rename folder in vault
        await vault.rename(originalFolder, "renamed-folder");
      });

      it("SHOULD move folder and children to new path", async () => {
        const result = await overlay.syncRename(
          "original-folder",
          "renamed-folder",
        );

        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("renamed-folder");

        // Check folder moved
        expect(
          overlay.trackingFS.findByPath("original-folder"),
        ).toBeUndefined();
        expect(overlay.trackingFS.findByPath("renamed-folder")).toBeTruthy();

        // Check child file moved
        expect(
          overlay.trackingFS.findByPath("original-folder/child.md"),
        ).toBeUndefined();
        expect(
          overlay.trackingFS.findByPath("renamed-folder/child.md"),
        ).toBeTruthy();

        const childNode = overlay.proposedFS.findByPath(
          "renamed-folder/child.md",
        );
        expect(getText(childNode)).toBe("Child content");
      });
    });
  });

  describe("Conflict resolution scenarios", () => {
    describe("GIVEN AI created file at destination path", () => {
      let originalFile: TFile;

      beforeEach(async () => {
        // Create and track original file
        originalFile = helpers.addFile("original.md", "Original content");
        await overlay.modify(originalFile, "Original content"); // Create tracking

        // AI creates file at destination path
        await overlay.create("renamed.md", "AI created content");

        // Rename original file in vault to conflict path
        await vault.rename(originalFile, "renamed.md");
      });

      it("SHOULD rebase AI created file as modify", async () => {
        const result = await overlay.syncRename("original.md", "renamed.md");

        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("renamed.md");

        // Should have the vault content in tracking
        const trackingNode = overlay.trackingFS.findByPath("renamed.md");
        expect(getText(trackingNode)).toBe("Original content");

        // Should have AI content in proposed (rebased as modify)
        const proposedNode = overlay.proposedFS.findByPath("renamed.md");
        expect(getText(proposedNode)).toBe("AI created content");

        // Should be same node ID (rebased)
        expect(trackingNode?.id).toBe(proposedNode?.id);
      });
    });

    describe("GIVEN AI renamed different file to destination path", () => {
      let originalFile: TFile;
      let otherFile: TFile;

      beforeEach(async () => {
        // Create and track original file
        originalFile = helpers.addFile("original.md", "Original content");
        await overlay.modify(originalFile, "Original content"); // Create tracking

        // Create and track other file
        otherFile = helpers.addFile("other.md", "Other content");
        await overlay.modify(otherFile, "Other content"); // Create tracking

        // AI renames other file to destination path
        await overlay.rename(otherFile, "renamed.md");

        // Vault renames original file to same destination path
        await vault.rename(originalFile, "renamed.md");
      });

      it("SHOULD undo AI rename and move vault rename to destination", async () => {
        const result = await overlay.syncRename("original.md", "renamed.md");

        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("renamed.md");

        // Original file should be at new path
        const renamedNode = overlay.proposedFS.findByPath("renamed.md");
        expect(getText(renamedNode)).toBe("Original content");

        // Other file should be back at original path (AI rename undone)
        const otherNode = overlay.proposedFS.findByPath("other.md");
        expect(getText(otherNode)).toBe("Other content");

        // No file should be orphaned
        expect(overlay.proposedFS.findByPath("original.md")).toBeUndefined();
      });
    });
  });

  describe("Trashed node scenarios", () => {
    describe("GIVEN tracked file deleted in overlay then renamed in vault", () => {
      let originalFile: TFile;

      beforeEach(async () => {
        // Create, track, and delete file in overlay
        originalFile = helpers.addFile("original.md", "Original content");
        await overlay.modify(originalFile, "Original content"); // Create tracking
        await overlay.delete(originalFile);

        // Rename in vault (file still exists there)
        await vault.rename(originalFile, "renamed.md");
      });

      it("SHOULD restore trashed node at new path", async () => {
        const result = await overlay.syncRename("original.md", "renamed.md");

        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("renamed.md");

        // Node should be restored at new path
        const proposedNode = overlay.proposedFS.findByPath("renamed.md");
        expect(proposedNode).toBeTruthy();
        expect(isTrashed(proposedNode!)).toBe(false);
        expect(getText(proposedNode)).toBe("Original content");
      });
    });
  });

  describe("Parent directory creation", () => {
    describe("GIVEN file renamed to nested path that doesn't exist", () => {
      let originalFile: TFile;

      beforeEach(async () => {
        // Create and track original file
        originalFile = helpers.addFile("original.md", "Original content");
        await overlay.modify(originalFile, "Original content"); // Create tracking

        // Rename to nested path in vault
        await vault.rename(originalFile, "deep/nested/path/renamed.md");
      });

      it("SHOULD create parent directories automatically", async () => {
        const result = await overlay.syncRename(
          "original.md",
          "deep/nested/path/renamed.md",
        );

        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("deep/nested/path/renamed.md");

        // Check parent directories exist
        expect(overlay.trackingFS.findByPath("deep")).toBeTruthy();
        expect(overlay.trackingFS.findByPath("deep/nested")).toBeTruthy();
        expect(overlay.trackingFS.findByPath("deep/nested/path")).toBeTruthy();

        expect(overlay.proposedFS.findByPath("deep")).toBeTruthy();
        expect(overlay.proposedFS.findByPath("deep/nested")).toBeTruthy();
        expect(overlay.proposedFS.findByPath("deep/nested/path")).toBeTruthy();

        // Check file is at final path
        const finalNode = overlay.proposedFS.findByPath(
          "deep/nested/path/renamed.md",
        );
        expect(getText(finalNode)).toBe("Original content");
      });
    });
  });

  describe("Error conditions", () => {
    describe("GIVEN vault file doesn't exist at new path", () => {
      beforeEach(async () => {
        // Create and track original file
        const originalFile = helpers.addFile("original.md", "Original content");
        await overlay.modify(originalFile, "Original content"); // Create tracking

        // Delete the file from vault (simulating external deletion)
        await vault.delete(originalFile);
      });

      it("SHOULD drop the rename event", async () => {
        const result = await overlay.syncRename(
          "original.md",
          "nonexistent.md",
        );

        expect(result).toHaveLength(0);

        // Original tracking should remain unchanged
        expect(overlay.trackingFS.findByPath("original.md")).toBeTruthy();
        expect(overlay.proposedFS.findByPath("original.md")).toBeTruthy();
      });
    });

    describe("GIVEN file not tracked in overlay", () => {
      beforeEach(async () => {
        // Create file but don't track it
        const originalFile = helpers.addFile("original.md", "Original content");
        // Rename in vault
        await vault.rename(originalFile, "renamed.md");
      });

      it("SHOULD drop the rename event", async () => {
        const result = await overlay.syncRename("original.md", "renamed.md");

        expect(result).toHaveLength(0);

        // No nodes should be created
        expect(overlay.trackingFS.findByPath("original.md")).toBeUndefined();
        expect(overlay.trackingFS.findByPath("renamed.md")).toBeUndefined();
        expect(overlay.proposedFS.findByPath("original.md")).toBeUndefined();
        expect(overlay.proposedFS.findByPath("renamed.md")).toBeUndefined();
      });
    });
  });

  describe("Complex scenarios", () => {
    describe("GIVEN multiple files with cross-renames", () => {
      let fileA: TFile;
      let fileB: TFile;

      beforeEach(async () => {
        // Create and track two files
        fileA = helpers.addFile("fileA.md", "Content A");
        fileB = helpers.addFile("fileB.md", "Content B");
        await overlay.modify(fileA, "Content A");
        await overlay.modify(fileB, "Content B");

        // AI renames A to temp, B to A's path
        await overlay.rename(fileA, "temp.md");
        await overlay.rename(fileB, "fileA.md");

        // Vault renames A to B's original path
        await vault.rename(fileA, "fileB.md");
      });

      it("SHOULD handle complex rename conflicts correctly", async () => {
        const result = await overlay.syncRename("fileA.md", "fileB.md");

        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("fileB.md");

        // FileA content should be at fileB.md (vault rename wins)
        const nodeBPath = overlay.proposedFS.findByPath("fileB.md");
        expect(getText(nodeBPath)).toBe("Content A");

        // FileB should be back at fileA.md (AI rename undone)
        const nodeAPath = overlay.proposedFS.findByPath("fileA.md");
        expect(getText(nodeAPath)).toBe("Content B");

        // Temp file should be gone
        expect(overlay.proposedFS.findByPath("temp.md")).toBeUndefined();
      });
    });
  });
});
