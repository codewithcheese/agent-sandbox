import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { vault, helpers } from "../../../tests/mocks/obsidian";
import { Vault } from "obsidian";
import debug from "debug";
import { VaultOverlay } from "../vault-overlay.svelte.ts";

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

        // Test add, modify, delete on staging
        const modifyFile = overlay.getFileByPath("modified-file.txt");
        const deleteFile = overlay.getFileByPath("to-be-deleted.txt");
        await overlay.create("added-file.txt", "This is a new file");
        await overlay.modify(modifyFile, "Modified content");
        await overlay.delete(deleteFile);

        // Get the file changes between master and staging
        const changes = overlay.getFileChanges();
        console.log("Final changes:", JSON.stringify(changes, null, 2));

        // Verify the changes include the expected files with correct statuses
        expect(changes).toContainEqual({
          path: "/added-file.txt",
          type: "added",
        });
        expect(changes).toContainEqual({
          path: "/modified-file.txt",
          type: "modified",
        });
        expect(changes).toContainEqual({
          path: "/to-be-deleted.txt",
          type: "deleted",
        });

        // Clean up
        await overlay.destroy();
      });
    },
    { timeout: 30_000 },
  );

  describe("fileExists", () => {
    it("should correctly check if a file exists in version control", async () => {
      // Create a test file in version control
      const testFilePath = "/file-exists-test.txt";
      await overlay.create(testFilePath, "File exists test content");

      // Check if the file exists
      const exists = overlay.fileIsTracked(testFilePath);
      expect(exists).toBe("added");

      // Check if a non-existent file exists
      const nonExistentPath = "/non-existent-file.txt";
      const nonExistentExists = overlay.fileIsTracked(nonExistentPath);
      expect(nonExistentExists).toBe(false);
    });
  });

  describe("importFileToMain", () => {
    it("should import a file from the vault to version control", async () => {
      // Add a file to the mock vault
      const testFilePath = "/import-test-file.txt";
      const testContent = "Import test content";
      helpers.addFile(testFilePath, testContent);

      // Import the file from vault to version control
      // @ts-expect-error calling private method
      await overlay.syncPath(testFilePath);

      // Verify the file was imported correctly
      const testFile = overlay.getFileByPath(testFilePath);
      expect(testFile).not.toBeNull();
      const contents = await overlay.read(testFile);
      expect(contents).toEqual(testContent);
    });
  });
});
