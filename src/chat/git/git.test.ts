import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GitManager } from "./git";
import debug from "debug";

debug.enable("*");
debug.log = console.log.bind(console);

describe("git", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initializeRepo", () => {
    it("should initialize a repository and return true", async () => {
      debug("Hello world");
      const gitManager = new GitManager();
      try {
        const result = await gitManager.init();
        expect(result).toBe(true);
      } finally {
        await gitManager.dispose();
      }
    });
  });

  describe("stageTurn", () => {
    it("should stage changes for a conversation turn and return a commit SHA", async () => {
      const gitManager = new GitManager();
      await gitManager.init();

      // Create a test file
      const messageId = "test-message-id";
      console.log("Writing test file...");
      await gitManager.writeFile("/test-file.txt", "Test content");

      // Stage the change
      const sha = await gitManager.commitTurn(messageId);
      console.log("Commit SHA:", sha);

      // Verify the SHA is returned
      expect(sha).toBeTruthy();
      expect(typeof sha).toBe("string");

      // Verify the file was created
      const contents = await gitManager.readFile("/test-file.txt");
      expect(contents).toEqual("Test content");
    });

    it("should handle multiple changes in a single turn", async () => {
      const gitManager = new GitManager();
      await gitManager.init();

      // Create test files
      const messageId = "test-message-id-2";
      await gitManager.writeFile("/test-file1.txt", "Content for file 1");
      await gitManager.writeFile("/test-file2.txt", "Content for file 2");

      // Stage the changes
      const sha = await gitManager.commitTurn(messageId);

      // Verify the SHA is returned
      expect(sha).toBeTruthy();
      expect(typeof sha).toBe("string");

      // Verify the files were created
      const contents1 = await gitManager.readFile("/test-file1.txt");
      expect(contents1).toEqual("Content for file 1");

      const contents2 = await gitManager.readFile("/test-file2.txt");
      expect(contents2).toEqual("Content for file 2");
    });
  });

  describe("dropTurn", () => {
    it("should drop changes for a conversation turn", async () => {
      const gitManager = new GitManager();
      await gitManager.init();

      // First, stage some changes
      const messageId = "message-to-drop";
      await gitManager.writeFile("/file-to-drop.txt", "Content to drop");

      await gitManager.commitTurn(messageId);

      // Verify the file exists before dropping
      const contentBefore = await gitManager.readFile("/file-to-drop.txt");
      expect(contentBefore).toEqual("Content to drop");

      // Now drop the turn
      const result = await gitManager.dropTurn(messageId);

      // We should get either a SHA or false
      expect(result).toBeTruthy();
    });
  });

  describe("approveChanges", () => {
    it("should approve changes by merging staging branch into main", async () => {
      const gitManager = new GitManager();
      await gitManager.init();

      // First, stage some changes
      const messageId = "message-to-approve";
      await gitManager.writeFile("/file-to-approve.txt", "Content to approve");

      await gitManager.commitTurn(messageId);

      // Now approve the changes
      const result = await gitManager.approveChanges();

      // Should return true on successful merge
      expect(result).toBe(true);
    });
  });
});
