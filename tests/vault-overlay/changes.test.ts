import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { vault, helpers } from "../mocks/obsidian.ts";
import { Vault } from "obsidian";
import debug from "debug";
import { VaultOverlaySvelte } from "../../src/chat/vault-overlay.svelte.ts";

debug.enable("*");
debug.log = console.log.bind(console);

describe("Vault Overlay Tracking", () => {
  let overlay: VaultOverlaySvelte;
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock vault state before each test
    helpers.reset();
    overlay = new VaultOverlaySvelte(vault as unknown as Vault);
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
            type: "modify",
            path: "modified-file.txt",
            info: {
              isDirectory: false,
            },
          },
          {
            type: "delete",
            path: "to-be-deleted.txt",
            info: {
              isDirectory: false,
            },
          },
          {
            type: "rename",
            path: "after-rename.txt",
            info: {
              oldPath: "before-rename.txt",
              isDirectory: false,
            },
          },
          {
            type: "create",
            path: "added-file.txt",
            info: {
              isDirectory: false,
            },
          },
        ]);

        // Clean up
        await overlay.destroy();
      });
    },
    { timeout: 30_000 },
  );
});
