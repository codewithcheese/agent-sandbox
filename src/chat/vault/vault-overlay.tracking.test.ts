import "fake-indexeddb/auto";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  vitest,
} from "vitest";
import { vault, helpers } from "../../../tests/mocks/obsidian";
import { Vault } from "obsidian";
import debug from "debug";
import { VaultOverlay } from "./vault-overlay.ts";

debug.enable("*");
debug.log = console.log.bind(console);

describe("Vault Overlay Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock vault state before each test
    helpers.reset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initializeRepo", () => {
    it("should initialize a repository and return true", async () => {
      debug("Hello world");
      const overlay = new VaultOverlay(vault as unknown as Vault);
      try {
        await overlay.init();
        expect(overlay.state).toEqual({
          type: "ready",
          branch: "staging",
        });
      } finally {
        await overlay.destroy();
      }
    });
  });

  describe(
    "getFileChanges",
    () => {
      it("should return a list of file changes between main and staging branches", async () => {
        // Add files to the mock vault first
        helpers.addFile("/modified-file.txt", "Original content");
        helpers.addFile("/to-be-deleted.txt", "This will be deleted");

        // Initialize version control
        const overlay = new VaultOverlay(vault as unknown as Vault);
        await overlay.init();

        // Import and commit files to master branch
        // await overlay.importFileToMain("/modified-file.txt");
        // await overlay.importFileToMain("/to-be-deleted.txt");

        // Switch to staging branch for our changes
        // We'll use commitTurn later which will handle the branch switching for us

        // Test add, modify, delete on staging branch
        const modifyFile = await overlay.getFileByPath("/modified-file.txt");
        const deleteFile = await overlay.getFileByPath("/to-be-deleted.txt");
        await overlay.create("/added-file.txt", "This is a new file");
        await overlay.modify(modifyFile, "Modified content");
        await overlay.delete(deleteFile);

        // Commit the changes to staging
        await overlay.commit("test-message-id");

        // Get the file changes between master and staging
        const changes = await overlay.getFileChanges();
        console.log("Final changes:", JSON.stringify(changes, null, 2));

        // Verify the changes include the expected files with correct statuses
        expect(changes).toContainEqual({
          path: "/added-file.txt",
          status: "added",
        });
        expect(changes).toContainEqual({
          path: "/modified-file.txt",
          status: "modified",
        });
        expect(changes).toContainEqual({
          path: "/to-be-deleted.txt",
          status: "deleted",
        });

        // Clean up
        await overlay.destroy();
      });
    },
    { timeout: 30_000 },
  );

  describe("fileExists", () => {
    it("should correctly check if a file exists in version control", async () => {
      // Initialize version control
      const overlay = new VaultOverlay(vault as unknown as Vault);
      await overlay.init();

      // Create a test file in version control
      const testFilePath = "/file-exists-test.txt";
      await overlay.create(testFilePath, "File exists test content");

      // Check if the file exists
      const exists = await overlay.fileIsTracked(testFilePath);
      expect(exists).toBe(true);

      // Check if a non-existent file exists
      const nonExistentPath = "/non-existent-file.txt";
      const nonExistentExists = await overlay.fileIsTracked(nonExistentPath);
      expect(nonExistentExists).toBe(false);
    });
  });

  describe("importFileToMain", () => {
    it("should import a file from the vault to version control", async () => {
      // Add a file to the mock vault
      const testFilePath = "/import-test-file.txt";
      const testContent = "Import test content";
      helpers.addFile(testFilePath, testContent);

      // Initialize version control
      const versionControl = new VaultOverlay(vault as unknown as Vault);
      await versionControl.init();

      // Import the file from vault to version control
      // @ts-expect-error calling private method
      await versionControl.importFileToMaster(testFilePath);

      // Verify the file was imported correctly
      const testFile = await versionControl.getFileByPath(testFilePath);
      expect(testFile).not.toBeNull();
      const contents = await versionControl.read(testFile);
      expect(contents).toEqual(testContent);
    });
  });

  describe("stageTurn", () => {
    it("should stage changes for a conversation turn and return a commit SHA", async () => {
      const overlay = new VaultOverlay(vault as unknown as Vault);
      await overlay.init();

      // Create a test file
      const messageId = "test-message-id";
      console.log("Writing test file...");
      await overlay.create("/test-file.txt", "Test content");

      // Stage the change
      const sha = await overlay.commit(messageId);
      console.log("Commit SHA:", sha);

      // Verify the SHA is returned
      expect(sha).toBeTruthy();
      expect(typeof sha).toBe("string");

      // Verify the file was created
      const testFile = await overlay.getFileByPath("/test-file.txt");
      const contents = await overlay.read(testFile);
      expect(contents).toEqual("Test content");
    });

    it("should handle multiple changes in a single turn", async () => {
      const versionControl = new VaultOverlay(vault as unknown as Vault);
      await versionControl.init();

      // Create test files
      const messageId = "test-message-id-2";
      await versionControl.create("/test-file1.txt", "Content for file 1");
      await versionControl.create("/test-file2.txt", "Content for file 2");

      // Stage the changes
      const sha = await versionControl.commit(messageId);

      // Verify the SHA is returned
      expect(sha).toBeTruthy();
      expect(typeof sha).toBe("string");

      // Verify the files were created
      const testFile1 = await versionControl.getFileByPath("/test-file1.txt");
      const contents1 = await versionControl.read(testFile1);
      expect(contents1).toEqual("Content for file 1");

      const testFile2 = await versionControl.getFileByPath("/test-file2.txt");
      const contents2 = await versionControl.read(testFile2);
      expect(contents2).toEqual("Content for file 2");
    });
  });
});
