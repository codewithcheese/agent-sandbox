import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { vault, helpers } from "../mocks/obsidian.ts";
import { Vault } from "obsidian";
import debug from "debug";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";

debug.enable("*");
debug.log = console.log.bind(console);

describe("Vault Overlay Tracking", () => {
  let overlay: VaultOverlay;
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock vault state before each test
    helpers.reset();
    overlay = new VaultOverlay(vault as unknown as Vault);
  });

  afterEach(() => {
    overlay.destroy();
    vi.resetAllMocks();
  });

  describe(
    "getFileChanges",
    () => {
      it("should return a list of file changes between main and proposed branches", async () => {
        // Add files to the mock vault first
        helpers.addFile("modified-file.txt", "Original content");
        helpers.addFile("to-be-deleted.txt", "This will be deleted");
        helpers.addFile("before-rename.txt", "This will be renamed");

        // Test add, modify, delete on proposed
        const modifyFile = overlay.getFileByPath("modified-file.txt");
        const deleteFile = overlay.getFileByPath("to-be-deleted.txt");
        const renameFile = overlay.getFileByPath("before-rename.txt");
        await overlay.create("added-file.txt", "This is a new file");
        await overlay.modify(modifyFile, "Modified content");
        await overlay.delete(deleteFile);
        await overlay.rename(renameFile, "after-rename.txt");

        // Get the file changes between tracking and proposed
        const changes = overlay.getFileChanges();
        console.log("Final changes:", JSON.stringify(changes, null, 2));
        expect(changes).toEqual([
          {
            id: "6@1",
            path: "modified-file.txt",
            type: "modified",
          },
          {
            id: "25@1",
            path: "to-be-deleted.txt",
            type: "deleted",
          },
          {
            id: "48@1",
            path: "after-rename.txt",
            type: "modified",
          },
          {
            id: "0@2",
            path: "added-file.txt",
            type: "added",
          },
        ]);

        // Clean up
        await overlay.destroy();
      });
    },
    { timeout: 30_000 },
  );
});
