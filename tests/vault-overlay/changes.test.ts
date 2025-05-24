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
      it("should return a list of file changes between main and staging branches", async () => {
        // Add files to the mock vault first
        helpers.addFile("modified-file.txt", "Original content");
        helpers.addFile("to-be-deleted.txt", "This will be deleted");
        helpers.addFile("before-rename.txt", "This will be renamed");

        // Test add, modify, delete on staging
        const modifyFile = overlay.getFileByPath("modified-file.txt");
        const deleteFile = overlay.getFileByPath("to-be-deleted.txt");
        const renameFile = overlay.getFileByPath("before-rename.txt");
        await overlay.create("added-file.txt", "This is a new file");
        await overlay.modify(modifyFile, "Modified content");
        await overlay.delete(deleteFile);
        await overlay.rename(renameFile, "after-rename.txt");

        // Get the file changes between master and staging
        const changes = overlay.getFileChanges();
        console.log("Final changes:", JSON.stringify(changes, null, 2));
        expect(changes).toEqual([
          {
            path: "/modified-file.txt",
            type: "modified",
          },
          {
            path: "/to-be-deleted.txt",
            type: "deleted",
          },
          {
            path: "/after-rename.txt",
            type: "modified",
          },
          {
            path: "/added-file.txt",
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
