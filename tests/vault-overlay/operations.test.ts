import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { vault, helpers, MockTFile } from "../mocks/obsidian.ts";
import type { TFile, Vault, TAbstractFile } from "obsidian";
import { nanoid } from "nanoid";

describe("VaultOverlay", () => {
  let vaultOverlay: VaultOverlay;
  let chatId: string;
  beforeEach(async () => {
    // Reset the mock vault state before each test
    helpers.reset();

    // Create the vault overlay with the mock vault
    chatId = nanoid();
    vaultOverlay = new VaultOverlay(vault as unknown as Vault);
  });

  afterEach(async () => {
    await vaultOverlay.destroy();
  });

  describe("Read File Test", () => {
    it("should read file not in overlay", async () => {
      const file = helpers.addFile("/test-file.md", "Original content");
      const contents = await vaultOverlay.read(file);
      expect(contents).toEqual("Original content");
    });

    it("should read file modified in overlay", async () => {
      const file = helpers.addFile("/test-file.md", "Original content");
      await vaultOverlay.modify(file, "Modified content");
      const contents = await vaultOverlay.read(file);
      expect(contents).toEqual("Modified content");
    });

    it("should throw when reading file deleted in overlay", async () => {
      const file = helpers.addFile("/test-file.md", "Original content");
      await vaultOverlay.delete(file);
      await expect(() => vaultOverlay.read(file)).rejects.toThrow();
    });

    it("should read from vault when file not tracked", async () => {
      // Create file in vault
      helpers.addFile("vault-file.md", "vault content");
      const vaultFile = vault.getFileByPath("vault-file.md");

      const content = await vaultOverlay.read(vaultFile);
      expect(content).toBe("vault content");
    });
  });

  describe("Create File Test", () => {
    it("should create a file in the overlay but not in the actual vault", async () => {
      // Arrange
      const filePath = "test-file.md";
      const fileContent = "# Test Content";

      // Act
      const file = await vaultOverlay.create(filePath, fileContent);

      // Assert
      // Verify the file object is returned correctly
      expect(file).toBeTruthy();
      expect(file.path).toBe(filePath);

      // Verify the file exists in the overlay
      const contentFromVC = await vaultOverlay.read(file);
      expect(contentFromVC).toBe(fileContent);

      // Verify the file was NOT created in the actual vault
      // The mock vault's create method should not have been called
      expect(vault.create).not.toHaveBeenCalled();

      // Verify the file doesn't exist in the mock filesystem
      // Use the vault's getFileByPath method to check if the file exists
      expect(vault.getFileByPath(filePath)).toBeNull();
    });

    it("should throw an error when creating a file with an invalid path", async () => {
      // Test path with directory traversal
      await expect(
        vaultOverlay.create("/../outside-vault.md", "Content"),
      ).rejects.toThrow();
    });

    it("should throw an error when creating a file that already exists", async () => {
      // Arrange - Create a file in the mock vault
      const filePath = "/existing-file.md";
      helpers.addFile(filePath, "Original content");

      // Act & Assert - Try to create the file again through the overlay
      await expect(
        vaultOverlay.create(filePath, "New content"),
      ).rejects.toThrow("File already exists");
    });

    it("should not throw an error when parent folder does not exist", async () => {
      await vaultOverlay.create("/non-existent-folder/file.md", "Content");
    });
  });

  describe("Modify File Test", () => {
    it("should modify a file in the overlay but not in the actual vault", async () => {
      // Arrange - Create a file in the actual vault
      const filePath = "/file-to-modify.md";
      const originalContent = "# Original Content";
      const modifiedContent = "# Modified Content";

      // Add the file to the mock vault
      const file = helpers.addFile(filePath, originalContent);

      // Act - Modify the file through the overlay
      await vaultOverlay.modify(file, modifiedContent);

      // Assert
      // Verify the file was modified in the overlay
      const contents = await vaultOverlay.read(file);
      expect(contents).toBe(modifiedContent);

      // Verify the file was NOT modified in the actual vault
      // The mock vault's modify method should not have been called
      expect(vault.modify).not.toHaveBeenCalled();

      // Verify the original content is still in the mock filesystem
      const fileInVault = vault.getFileByPath(filePath);
      expect(fileInVault).not.toBeNull();
      const contentFromVault = await vault.read(fileInVault!);
      expect(contentFromVault).toBe(originalContent);
    });

    it("should create a new file when modifying a non-existent file", async () => {
      // Create a file object that doesn't exist in either the vault or version control
      const nonExistentFilePath = "/non-existent-file.md";
      const newContent = "# New Content";
      const nonExistentFile = new MockTFile(nonExistentFilePath);

      // Act - Modify the non-existent file
      await vaultOverlay.modify(nonExistentFile, newContent);

      // Assert - The file should be created in the overlay
      const contentFromVC = await vaultOverlay.read(nonExistentFile);
      expect(contentFromVC).toBe(newContent);

      // The file should NOT be created in the actual vault
      expect(vault.getFileByPath(nonExistentFilePath)).toBeNull();
    });

    it("should handle multiple modifications to the same file", async () => {
      // Arrange - Create a file in the actual vault
      const filePath = "/multiple-modifications.md";
      const originalContent = "# Original Content";
      const firstModification = "# First Modification";
      const secondModification = "# Second Modification";

      // Add the file to the mock vault
      const file = helpers.addFile(filePath, originalContent);

      // Act - Modify the file twice through the overlay
      await vaultOverlay.modify(file, firstModification);
      await vaultOverlay.modify(file, secondModification);

      // Assert
      // Verify the file has the second modification in the overlay
      const contentFromVC = await vaultOverlay.read(file);
      expect(contentFromVC).toBe(secondModification);

      // Verify the original content is still in the mock filesystem
      const contentFromVault = await vault.read(file);
      expect(contentFromVault).toBe(originalContent);
    });

    it("should sync file before modify when exists in vault but not overlay", async () => {
      // Create file in vault
      helpers.addFile("vault-file.md", "original content");
      const vaultFile = vault.getFileByPath("vault-file.md");

      // Modify should sync first
      await vaultOverlay.modify(vaultFile, "modified content");

      const content = await vaultOverlay.read(vaultFile);
      expect(content).toBe("modified content");
    });

    it("should handle large text content using updateByLine", async () => {
      // Create large content (>50,000 characters)
      const largeContent = "x".repeat(60000);

      await vaultOverlay.create("large-file.md", "initial");
      const file = vaultOverlay.getFileByPath("large-file.md");

      await vaultOverlay.modify(file, largeContent);

      const content = await vaultOverlay.read(file);
      expect(content).toBe(largeContent);
    });
  });

  describe("Rename File Test", () => {
    it("should create and rename a file in the overlay but not in the actual vault", async () => {
      // Arrange
      const filePath = "/test-rename-file.md";
      const newPath = "/renamed-test-file.md";
      const content = "# Test content for rename";

      // Create a file in version control through the overlay
      const file = await vaultOverlay.create(filePath, content);

      // Act
      await vaultOverlay.rename(file, newPath);

      // Assert
      // File should be renamed in version control
      const newFile = vaultOverlay.getFileByPath(newPath);
      const newContent = await vaultOverlay.read(newFile);
      expect(newContent).toEqual(content);

      // Original file should no longer exist in version control
      await expect(vaultOverlay.read(file)).rejects.toThrow();

      // Original file should still not exist in the vault
      expect(vault.getFileByPath(filePath)).toBeNull();
    });

    it("should throw an error when renaming a non-existent file", async () => {
      // Arrange
      const nonExistentPath = "/non-existent-file.md";
      const newPath = "/new-path.md";

      // Create a mock file object
      const mockFile = {
        path: nonExistentPath,
      } as TAbstractFile;

      // Act & Assert
      await expect(vaultOverlay.rename(mockFile, newPath)).rejects.toThrow(
        `Cannot rename file not found in vault: /non-existent-file.md`,
      );
    });

    it("should throw an error when the new path already exists in overlay", async () => {
      // Arrange
      const newFilePath = "/new-file.md";
      const existingPath = "/existing-file.md";
      const content = "# Test content for rename";

      // Create files in the overlay
      const sourceFile = await vaultOverlay.create(newFilePath, content);
      await vaultOverlay.create(existingPath, "Existing content");

      // Act & Assert
      await expect(
        vaultOverlay.rename(sourceFile, existingPath),
      ).rejects.toThrow(
        "Cannot rename to path that already exists: existing-file.md",
      );
    });

    it("should throw an error when the new path already exists in vault", async () => {
      // Arrange
      const newFilePath = "/new-file.md";
      const existingPath = "/existing-file.md";
      const content = "# Test content for rename";

      helpers.addFile(existingPath, "Existing content");

      // Create file in the overlay
      const sourceFile = await vaultOverlay.create(newFilePath, content);

      // Act & Assert
      await expect(
        vaultOverlay.rename(sourceFile, existingPath),
      ).rejects.toThrow(
        "Cannot rename to path that already exists: existing-file.md",
      );
    });

    it("should allow rename when destination was renamed in overlay", async () => {
      // Arrange
      const newFilePath = "/new-file.md";
      const existingPath = "/existing-file.md";
      const renamedExistingPath = "/renamed-existing-file.md";
      const content = "# Test content";

      helpers.addFile(existingPath, "Existing content");

      // Rename the existing file in the overlay
      const existingFile = vaultOverlay.getFileByPath(existingPath);
      await vaultOverlay.rename(existingFile, renamedExistingPath);

      // Create file in the overlay
      const sourceFile = await vaultOverlay.create(newFilePath, content);

      // Act & Assert
      await expect(
        vaultOverlay.rename(sourceFile, existingPath),
      ).resolves.not.toBeDefined();
    });

    it("should import a file from the vault if it doesn't exist in version control", async () => {
      // Arrange
      const oldPath = "/before.md";
      const newPath = "/after.md";
      const content = "# Test content";

      // Add the file to the vault but to overlay
      helpers.addFile(oldPath, content);

      // Get the file object
      const oldFile = vaultOverlay.getFileByPath(oldPath);
      expect(oldFile).not.toBeNull();

      // Act
      await vaultOverlay.rename(oldFile, newPath);

      // Assert
      // File should be renamed in version control
      const newFile = vaultOverlay.getFileByPath(newPath);
      const newContent = await vaultOverlay.read(newFile);
      expect(newContent).toEqual(content);

      // Original file should no longer exist in version control
      await expect(vaultOverlay.read(oldFile)).rejects.toThrow();
    });

    it("should not get file using old path after rename file created in overlay", async () => {
      // Arrange
      const ogPath = "/file.md";
      const newPath = "/existing-file.md";
      const content = "# Test content";

      // Create and rename in the overlay
      const ogFile = await vaultOverlay.create(ogPath, content);
      await vaultOverlay.rename(ogFile, newPath);

      // Expect not to get old path
      expect(vaultOverlay.getFileByPath(ogPath)).toBeNull();
    });

    it("should not get file using old path after rename file created in vault", async () => {
      // Arrange
      const ogPath = "/file.md";
      const newPath = "/existing-file.md";
      const content = "# Test content";

      // Create in vault and rename in the overlay
      const ogFile = helpers.addFile(ogPath, content);
      await vaultOverlay.rename(ogFile, newPath);

      // Expect not to get old path
      expect(vaultOverlay.getFileByPath(ogPath)).toBeNull();
    });

    it("should reject rename with directory traversal", async () => {
      await vaultOverlay.create("test.md", "content");
      const file = vaultOverlay.getFileByPath("test.md");

      await expect(vaultOverlay.rename(file, "../outside.md")).rejects.toThrow(
        "Path is outside the vault",
      );
      await expect(
        vaultOverlay.rename(file, "folder/../test.md"),
      ).rejects.toThrow("Path is outside the vault");
    });

    it("should reject rename of deleted file", async () => {
      await vaultOverlay.create("test.md", "content");
      const file = vaultOverlay.getFileByPath("test.md");
      await vaultOverlay.delete(file);

      await expect(vaultOverlay.rename(file, "renamed.md")).rejects.toThrow(
        "Cannot rename file that was deleted",
      );
    });

    it("should reject rename to path existing in vault", async () => {
      // Create file in vault
      helpers.addFile("vault-file.md", "vault content");

      // Create file in overlay
      await vaultOverlay.create("overlay-file.md", "overlay content");
      const overlayFile = vaultOverlay.getFileByPath("overlay-file.md");

      await expect(
        vaultOverlay.rename(overlayFile, "vault-file.md"),
      ).rejects.toThrow("Cannot rename to path that already exists");
    });

    it("should sync file before rename when not in overlay", async () => {
      // Create file in vault
      helpers.addFile("vault-file.md", "vault content");

      const vaultFile = vault.getFileByPath("vault-file.md");

      // Rename should sync first
      await vaultOverlay.rename(vaultFile, "renamed-vault-file.md");

      const renamedFile = vaultOverlay.getFileByPath("renamed-vault-file.md");
      expect(renamedFile).toBeTruthy();
      expect(await vaultOverlay.read(renamedFile)).toBe("vault content");
    });

    it("should create parent directories when renaming", async () => {
      await vaultOverlay.create("test.md", "content");
      const file = vaultOverlay.getFileByPath("test.md");

      await vaultOverlay.rename(file, "new/nested/path/test.md");

      const renamedFile = vaultOverlay.getFileByPath("new/nested/path/test.md");
      expect(renamedFile).toBeTruthy();

      const parentFolder = vaultOverlay.getFolderByPath("new/nested/path");
      expect(parentFolder).toBeTruthy();
    });

    it("should handle rename within same parent (name change only)", async () => {
      await vaultOverlay.create("folder/test.md", "content");
      const file = vaultOverlay.getFileByPath("folder/test.md");

      await vaultOverlay.rename(file, "folder/renamed.md");

      const renamedFile = vaultOverlay.getFileByPath("folder/renamed.md");
      expect(renamedFile).toBeTruthy();
      const renamedNode = vaultOverlay.findNode(
        "proposed",
        "folder/renamed.md",
      );
      expect(renamedNode).toBeTruthy();
      expect(renamedNode.data.get("name")).toBe("renamed.md");

      const oldFile = vaultOverlay.getFileByPath("folder/test.md");
      expect(oldFile).toBeNull();
    });
  });

  describe("Delete File Test", () => {
    it("should delete a file in the overlay but not in the actual vault", async () => {
      // Arrange - Create a file in the actual vault
      const filePath = "/file-to-delete.md";
      const fileContent = "# File to Delete";

      // Add the file to the mock vault
      const file = helpers.addFile(filePath, fileContent);

      // Act - Delete the file through the overlay
      await vaultOverlay.delete(file);

      // Assert
      // Verify the file is tracked as deleted in the overlay
      const proposedNode = vaultOverlay.findDeletedNode(file.path);
      expect(proposedNode.data.get("deletedFrom")).toEqual(file.path);

      // Verify the file cannot

      // Verify the file was NOT deleted from the actual vault
      // The mock vault's delete method should not have been called
      expect(vault.delete).not.toHaveBeenCalled();

      // Verify the file still exists in the mock filesystem
      const fileInVault = vault.getFileByPath(filePath);
      expect(fileInVault).not.toBeNull();
      const contentFromVault = await vault.read(fileInVault!);
      expect(contentFromVault).toBe(fileContent);
    });

    it("should throw an error when deleting a non-existent file", async () => {
      // Create a file object that doesn't exist in either the vault or version control
      const nonExistentFilePath = "/non-existent-file-to-delete.md";
      const nonExistentFile = new MockTFile(nonExistentFilePath);

      // Act & Assert - Deleting a non-existent file should throw an error
      await expect(vaultOverlay.delete(nonExistentFile)).rejects.toThrow();

      // Verify the vault's delete method was not called
      expect(vault.delete).not.toHaveBeenCalled();
    });

    it("should handle deleting a file that was previously created through the overlay", async () => {
      // Arrange - Create a file through the overlay (not in the actual vault)
      const filePath = "/overlay-file-to-delete.md";
      const fileContent = "# Overlay File to Delete";

      // Create the file through the overlay
      const file = await vaultOverlay.create(filePath, fileContent);

      // Verify the file exists in the overlay
      const contentFromVC = await vaultOverlay.read(file);
      expect(contentFromVC).toBe(fileContent);

      // Act - Delete the file through the overlay
      await vaultOverlay.delete(file);

      // Assert - The file should be deleted from the overlay
      await expect(vaultOverlay.read(file)).rejects.toThrow();

      // Verify the vault's delete method was not called
      expect(vault.delete).not.toHaveBeenCalled();
    });

    it("should return early when trying to delete already deleted file", async () => {
      // Create and delete a file
      await vaultOverlay.create("test.md", "content");
      const file = vaultOverlay.getFileByPath("test.md");
      await vaultOverlay.delete(file);

      // Try to delete again - should return early
      await vaultOverlay.delete(file);

      // Verify file is still in deleted state
      const deletedNode = vaultOverlay.findDeletedNode("test.md");
      expect(deletedNode).toBeTruthy();
    });

    it("should sync file before deletion when not in overlay", async () => {
      // Create file directly in vault (not in overlay)
      helpers.addFile("vault-file.md", "vault content");
      const vaultFile = vault.getFileByPath("vault-file.md");

      // Delete should sync first, then delete
      await vaultOverlay.delete(vaultFile);

      // Verify file was synced and then deleted
      const deletedNode = vaultOverlay.findDeletedNode("vault-file.md");
      expect(deletedNode).toBeTruthy();
    });
  });

  describe("Node Creation", () => {
    it("should throw error when creating node that already exists", () => {
      // Create node
      vaultOverlay.createNode("proposed", "test.md", {
        isDirectory: false,
        text: "content",
      });

      // Try to create same node again
      expect(() => {
        vaultOverlay.createNode("proposed", "test.md", {
          isDirectory: false,
          text: "content",
        });
      }).toThrow("Node already exists: test.md");
    });

    it("should create intermediate directories when creating nested paths", () => {
      const node = vaultOverlay.createNode("proposed", "deep/nested/path/file.md", {
        isDirectory: false,
        text: "content",
      });

      expect(node).toBeTruthy();

      // Verify intermediate directories were created
      const deepFolder = vaultOverlay.findNode("proposed", "deep");
      const nestedFolder = vaultOverlay.findNode("proposed", "deep/nested");
      const pathFolder = vaultOverlay.findNode("proposed", "deep/nested/path");

      expect(deepFolder).toBeTruthy();
      expect(nestedFolder).toBeTruthy();
      expect(pathFolder).toBeTruthy();
    });
  });

  describe("Trash Operations", () => {
    it("should create trash folder when it doesn't exist", async () => {
      await vaultOverlay.create("test.md", "content");
      const file = vaultOverlay.getFileByPath("test.md");
      await vaultOverlay.delete(file);

      // Verify trash folder was created
      const trashFolder = vaultOverlay.findNode("proposed", ".overlay-trash");
      expect(trashFolder).toBeTruthy();
      expect(trashFolder.data.get("isDirectory")).toBe(true);
    });

    it("should reuse existing trash folder", async () => {
      // Create trash folder manually
      vaultOverlay.createNode("proposed", ".overlay-trash", { isDirectory: true });
      const originalTrashId = vaultOverlay.findNode("proposed", ".overlay-trash").id;

      await vaultOverlay.create("test.md", "content");
      const file = vaultOverlay.getFileByPath("test.md");
      await vaultOverlay.delete(file);

      // Verify same trash folder was used
      const trashFolder = vaultOverlay.findNode("proposed", ".overlay-trash");
      expect(trashFolder.id).toBe(originalTrashId);
    });
  });
});
