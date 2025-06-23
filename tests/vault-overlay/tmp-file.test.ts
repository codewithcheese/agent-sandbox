import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { vault, helpers } from "../mocks/obsidian.ts";
import { type Vault } from "obsidian";

describe("VaultOverlay .overlay-tmp Directory", () => {
  let overlay: VaultOverlay;

  beforeEach(async () => {
    helpers.reset();
    overlay = new VaultOverlay(vault as unknown as Vault);
  });

  afterEach(async () => {
    await overlay.destroy();
  });

  describe("Directory Hiding", () => {
    it("should not show .overlay-tmp in root folder children", async () => {
      const rootFolder = overlay.getFolderByPath("/");
      expect(rootFolder).toBeDefined();
      
      const children = rootFolder!.children;
      const childNames = children.map(child => child.name);
      
      expect(childNames).not.toContain(".overlay-tmp");
      expect(childNames).not.toContain(".overlay-trash"); // Verify trash is also hidden
    });

    it("should not show .overlay-tmp in folder listings even when files exist inside", async () => {
      // Create a file in .overlay-tmp
      await overlay.create(".overlay-tmp/test-file.txt", "test content");
      
      const rootFolder = overlay.getFolderByPath("/");
      const children = rootFolder!.children;
      const childNames = children.map(child => child.name);
      
      expect(childNames).not.toContain(".overlay-tmp");
    });

    it("should not include .overlay-tmp in tracked paths", async () => {
      // Create a file in .overlay-tmp
      await overlay.create(".overlay-tmp/state-file.json", '{"test": true}');
      
      const changes = overlay.getFileChanges();
      const changePaths = changes.map(change => change.path);
      
      // Should not see .overlay-tmp directory itself or its contents in changes
      expect(changePaths).not.toContain(".overlay-tmp");
      expect(changePaths).not.toContain(".overlay-tmp/state-file.json");
    });

    it("should not include .overlay-tmp files in getAllTrackedPaths", async () => {
      // Create files in .overlay-tmp
      await overlay.create(".overlay-tmp/read-state.json", '{"lastRead": {}}');
      await overlay.create(".overlay-tmp/nested/config.json", '{"config": true}');
      
      // Access the private method via any to test it
      const getAllTrackedPaths = (overlay as any).getAllTrackedPaths.bind(overlay);
      const trackedPaths = getAllTrackedPaths((overlay as any).proposedDoc);
      
      // These should NOT be in tracked paths
      expect(trackedPaths).not.toContain(".overlay-tmp");
      expect(trackedPaths).not.toContain(".overlay-tmp/read-state.json");
      expect(trackedPaths).not.toContain(".overlay-tmp/nested");
      expect(trackedPaths).not.toContain(".overlay-tmp/nested/config.json");
      
      // But regular files should still be tracked
      await overlay.create("regular-file.txt", "regular content");
      const updatedTrackedPaths = getAllTrackedPaths((overlay as any).proposedDoc);
      expect(updatedTrackedPaths).toContain("regular-file.txt");
    });
  });

  describe("Direct Access", () => {
    it("should allow direct access to .overlay-tmp directory", async () => {
      const tmpFolder = overlay.getFolderByPath(".overlay-tmp");
      expect(tmpFolder).toBeDefined();
      expect(tmpFolder!.name).toBe(".overlay-tmp");
      expect(tmpFolder!.path).toBe(".overlay-tmp");
    });

    it("should allow creating files in .overlay-tmp", async () => {
      const filePath = ".overlay-tmp/test-file.txt";
      const content = "This is a test file in overlay-tmp";
      
      await overlay.create(filePath, content);
      
      const file = overlay.getFileByPath(filePath);
      expect(file).toBeDefined();
      expect(file!.path).toBe(filePath);
      
      const readContent = await overlay.read(file!);
      expect(readContent).toBe(content);
    });

    it("should allow modifying files in .overlay-tmp", async () => {
      const filePath = ".overlay-tmp/modifiable-file.txt";
      const originalContent = "Original content";
      const modifiedContent = "Modified content";
      
      await overlay.create(filePath, originalContent);
      const file = overlay.getFileByPath(filePath);
      
      await overlay.modify(file!, modifiedContent);
      
      const readContent = await overlay.read(file!);
      expect(readContent).toBe(modifiedContent);
    });

    it("should allow creating nested directories in .overlay-tmp", async () => {
      const nestedPath = ".overlay-tmp/nested/deep/file.json";
      const content = '{"nested": "data"}';
      
      await overlay.create(nestedPath, content);
      
      const file = overlay.getFileByPath(nestedPath);
      expect(file).toBeDefined();
      
      const readContent = await overlay.read(file!);
      expect(readContent).toBe(content);
    });

    it("should list children of .overlay-tmp when accessed directly", async () => {
      // Create multiple files in .overlay-tmp
      await overlay.create(".overlay-tmp/file1.txt", "content1");
      await overlay.create(".overlay-tmp/file2.txt", "content2");
      await overlay.create(".overlay-tmp/subdir/file3.txt", "content3");
      
      const tmpFolder = overlay.getFolderByPath(".overlay-tmp");
      const children = tmpFolder!.children;
      const childNames = children.map(child => child.name);
      
      expect(childNames).toContain("file1.txt");
      expect(childNames).toContain("file2.txt");
      expect(childNames).toContain("subdir");
      expect(children).toHaveLength(3);
    });
  });

  describe("ReadState Integration", () => {
    it("should allow ReadState to create and access files in .overlay-tmp", async () => {
      const readStatePath = ".overlay-tmp/read-state.json";
      const stateData = '{"lastRead": {"file1.txt": 1234567890}}';
      
      // Simulate what ReadState does
      await overlay.create(readStatePath, stateData);
      
      const file = overlay.getFileByPath(readStatePath);
      expect(file).toBeDefined();
      
      const content = await overlay.read(file!);
      expect(content).toBe(stateData);
      
      // Verify it's not visible in root children
      const rootFolder = overlay.getFolderByPath("/");
      const childNames = rootFolder!.children.map(child => child.name);
      expect(childNames).not.toContain(".overlay-tmp");
    });
  });

  describe("Comparison with Trash Behavior", () => {
    it("should behave similarly to .overlay-trash (hidden but accessible)", async () => {
      // Both directories should be hidden from root listing
      const rootFolder = overlay.getFolderByPath("/");
      const childNames = rootFolder!.children.map(child => child.name);
      
      expect(childNames).not.toContain(".overlay-tmp");
      expect(childNames).not.toContain(".overlay-trash");
      
      // Both should be directly accessible
      const tmpFolder = overlay.getFolderByPath(".overlay-tmp");
      const trashFolder = overlay.getFolderByPath(".overlay-trash");
      
      expect(tmpFolder).toBeDefined();
      expect(trashFolder).toBeDefined();
      expect(tmpFolder!.name).toBe(".overlay-tmp");
      expect(trashFolder!.name).toBe(".overlay-trash");
    });
  });
});