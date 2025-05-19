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
import { VersionControl } from "./version-control.ts";
import { vault, helpers } from "../../../tests/mocks/obsidian";
import { Vault } from "obsidian";
import debug from "debug";

debug.enable("*");
debug.log = console.log.bind(console);

describe("Version Control", () => {
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
      const versionControl = new VersionControl(vault as unknown as Vault);
      try {
        await versionControl.init();
        expect(versionControl.state).toEqual({
          type: "ready",
          branch: "staging",
        });
      } finally {
        await versionControl.dispose();
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
        const versionControl = new VersionControl(vault as unknown as Vault);
        await versionControl.init();

        // Import and commit files to master branch
        // await versionControl.importFileToMain("/modified-file.txt");
        // await versionControl.importFileToMain("/to-be-deleted.txt");

        // Switch to staging branch for our changes
        // We'll use commitTurn later which will handle the branch switching for us

        // Test add, modify, delete on staging branch
        await versionControl.writeFile("/added-file.txt", "This is a new file");
        await versionControl.writeFile(
          "/modified-file.txt",
          "Modified content",
        );
        await versionControl.deleteFile("/to-be-deleted.txt");

        // Commit the changes to staging
        await versionControl.commit("test-message-id");

        // Get the file changes between master and staging
        const changes = await versionControl.getFileChanges();
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
        await versionControl.dispose();
      });
    },
    { timeout: 30_000 },
  );

  describe("fileExists", () => {
    it("should correctly check if a file exists in version control", async () => {
      // Initialize version control
      const versionControl = new VersionControl(vault as unknown as Vault);
      await versionControl.init();

      // Create a test file in version control
      const testFilePath = "/file-exists-test.txt";
      await versionControl.writeFile(testFilePath, "File exists test content");

      // Check if the file exists
      const exists = await versionControl.fileExists(testFilePath);
      expect(exists).toBe(true);

      // Check if a non-existent file exists
      const nonExistentPath = "/non-existent-file.txt";
      const nonExistentExists =
        await versionControl.fileExists(nonExistentPath);
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
      const versionControl = new VersionControl(vault as unknown as Vault);
      await versionControl.init();

      // Import the file from vault to version control
      await versionControl.importFileToMaster(testFilePath);

      // Verify the file was imported correctly
      const contents = await versionControl.readFile(testFilePath);
      expect(contents).toEqual(testContent);
    });
  });

  describe("stageTurn", () => {
    it("should stage changes for a conversation turn and return a commit SHA", async () => {
      // Add a file to the mock vault
      helpers.addFile("/test-file.txt", "Test content in vault");

      const versionControl = new VersionControl(vault as unknown as Vault);
      await versionControl.init();

      // Create a test file
      const messageId = "test-message-id";
      console.log("Writing test file...");
      await versionControl.writeFile("/test-file.txt", "Test content");

      // Stage the change
      const sha = await versionControl.commit(messageId);
      console.log("Commit SHA:", sha);

      // Verify the SHA is returned
      expect(sha).toBeTruthy();
      expect(typeof sha).toBe("string");

      // Verify the file was created
      const contents = await versionControl.readFile("/test-file.txt");
      expect(contents).toEqual("Test content");
    });

    it("should handle multiple changes in a single turn", async () => {
      // Add files to the mock vault
      helpers.addFile("/test-file-1.txt", "Test content 1 in vault");
      helpers.addFile("/test-file-2.txt", "Test content 2 in vault");

      const versionControl = new VersionControl(vault as unknown as Vault);
      await versionControl.init();

      // Create test files
      const messageId = "test-message-id-2";
      await versionControl.writeFile("/test-file1.txt", "Content for file 1");
      await versionControl.writeFile("/test-file2.txt", "Content for file 2");

      // Stage the changes
      const sha = await versionControl.commit(messageId);

      // Verify the SHA is returned
      expect(sha).toBeTruthy();
      expect(typeof sha).toBe("string");

      // Verify the files were created
      const contents1 = await versionControl.readFile("/test-file1.txt");
      expect(contents1).toEqual("Content for file 1");

      const contents2 = await versionControl.readFile("/test-file2.txt");
      expect(contents2).toEqual("Content for file 2");
    });
  });
});
