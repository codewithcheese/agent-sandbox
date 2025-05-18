import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
        const result = await versionControl.init();
        expect(result).toBe(true);
      } finally {
        await versionControl.dispose();
      }
    });
  });

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
      const nonExistentExists = await versionControl.fileExists(nonExistentPath);
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
      await versionControl.importFileToMain(testFilePath);
      
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
      const sha = await versionControl.commitTurn(messageId);
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
      const sha = await versionControl.commitTurn(messageId);

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
