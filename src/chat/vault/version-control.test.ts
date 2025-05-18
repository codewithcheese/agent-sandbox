import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VersionControl } from "./version-control.ts";
import debug from "debug";

debug.enable("*");
debug.log = console.log.bind(console);

describe("Version Control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initializeRepo", () => {
    it("should initialize a repository and return true", async () => {
      debug("Hello world");
      const versionControl = new VersionControl();
      try {
        const result = await versionControl.init();
        expect(result).toBe(true);
      } finally {
        await versionControl.dispose();
      }
    });
  });

  describe("stageTurn", () => {
    it("should stage changes for a conversation turn and return a commit SHA", async () => {
      const versionControl = new VersionControl();
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
      const versionControl = new VersionControl();
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
