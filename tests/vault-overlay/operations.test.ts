import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { vault, helpers, MockTFile } from "../mocks/obsidian.ts";
import { TFile, type Vault, type TAbstractFile, TFolder } from "obsidian";

describe("VaultOverlay", () => {
  let overlay: VaultOverlay;

  beforeEach(async () => {
    // Reset the mock vault state before each test
    helpers.reset();

    // Create the vault overlay with the mock vault
    overlay = new VaultOverlay(vault as unknown as Vault);
  });

  afterEach(async () => {
    await overlay.destroy();
  });

  describe("Read File Test", () => {
    it("should read file not in overlay", async () => {
      const file = helpers.addFile("/test-file.md", "Original content");
      const contents = await overlay.read(file);
      expect(contents).toEqual("Original content");
    });

    it("should read file modified in overlay", async () => {
      const file = helpers.addFile("/test-file.md", "Original content");
      await overlay.modify(file, "Modified content");
      const contents = await overlay.read(file);
      expect(contents).toEqual("Modified content");
    });

    it("should throw when reading file deleted in overlay", async () => {
      const file = helpers.addFile("/test-file.md", "Original content");
      await overlay.delete(file);
      await expect(() => overlay.read(file)).rejects.toThrow();
    });

    it("should read from vault when file not tracked", async () => {
      // Create file in vault
      helpers.addFile("vault-file.md", "vault content");
      const vaultFile = vault.getFileByPath("vault-file.md");

      const content = await overlay.read(vaultFile);
      expect(content).toBe("vault content");
    });
  });

  describe("Create File Test", () => {
    it("should create a file in the overlay but not in the actual vault", async () => {
      // Arrange
      const filePath = "test-file.md";
      const fileContent = "# Test Content";

      // Act
      const file = await overlay.create(filePath, fileContent);

      // Assert
      // Verify the file object is returned correctly
      expect(file).toBeTruthy();
      expect(file.path).toBe(filePath);

      // Verify the file exists in the overlay
      const contentFromVC = await overlay.read(file);
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
        overlay.create("/../outside-vault.md", "Content"),
      ).rejects.toThrow();
    });

    it("should throw an error when creating a file that already exists", async () => {
      // Arrange - Create a file in the mock vault
      const filePath = "/existing-file.md";
      helpers.addFile(filePath, "Original content");

      // Act & Assert - Try to create the file again through the overlay
      await expect(overlay.create(filePath, "New content")).rejects.toThrow(
        "File already exists",
      );
    });

    it("should not throw an error when parent folder does not exist", async () => {
      await overlay.create("/non-existent-folder/file.md", "Content");
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
      await overlay.modify(file, modifiedContent);

      // Assert
      // Verify the file was modified in the overlay
      const contents = await overlay.read(file);
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
      await overlay.modify(nonExistentFile, newContent);

      // Assert - The file should be created in the overlay
      const contentFromVC = await overlay.read(nonExistentFile);
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
      await overlay.modify(file, firstModification);
      await overlay.modify(file, secondModification);

      // Assert
      // Verify the file has the second modification in the overlay
      const contentFromVC = await overlay.read(file);
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
      await overlay.modify(vaultFile, "modified content");

      const content = await overlay.read(vaultFile);
      expect(content).toBe("modified content");
    });

    it("should handle large text content using updateByLine", async () => {
      // Create large content (>50,000 characters)
      const largeContent = "x".repeat(60000);

      await overlay.create("large-file.md", "initial");
      const file = overlay.getFileByPath("large-file.md");

      await overlay.modify(file, largeContent);

      const content = await overlay.read(file);
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
      const file = await overlay.create(filePath, content);

      // Act
      await overlay.rename(file, newPath);

      // Assert
      // File should be renamed in version control
      const newFile = overlay.getFileByPath(newPath);
      const newContent = await overlay.read(newFile);
      expect(newContent).toEqual(content);

      // Original file should no longer exist in version control
      await expect(overlay.read(file)).rejects.toThrow();

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
      await expect(overlay.rename(mockFile, newPath)).rejects.toThrow(
        `Cannot rename file not found in vault: /non-existent-file.md`,
      );
    });

    it("should throw an error when the new path already exists in overlay", async () => {
      // Arrange
      const newFilePath = "/new-file.md";
      const existingPath = "/existing-file.md";
      const content = "# Test content for rename";

      // Create files in the overlay
      const sourceFile = await overlay.create(newFilePath, content);
      await overlay.create(existingPath, "Existing content");

      // Act & Assert
      await expect(overlay.rename(sourceFile, existingPath)).rejects.toThrow(
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
      const sourceFile = await overlay.create(newFilePath, content);

      // Act & Assert
      await expect(overlay.rename(sourceFile, existingPath)).rejects.toThrow(
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
      const existingFile = overlay.getFileByPath(existingPath);
      await overlay.rename(existingFile, renamedExistingPath);

      // Create file in the overlay
      const sourceFile = await overlay.create(newFilePath, content);

      // Act & Assert
      await expect(
        overlay.rename(sourceFile, existingPath),
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
      const oldFile = overlay.getFileByPath(oldPath);
      expect(oldFile).not.toBeNull();

      // Act
      await overlay.rename(oldFile, newPath);

      // Assert
      // File should be renamed in version control
      const newFile = overlay.getFileByPath(newPath);
      const newContent = await overlay.read(newFile);
      expect(newContent).toEqual(content);

      // Original file should no longer exist in version control
      await expect(overlay.read(oldFile)).rejects.toThrow();
    });

    it("should not get file using old path after rename file created in overlay", async () => {
      // Arrange
      const ogPath = "/file.md";
      const newPath = "/existing-file.md";
      const content = "# Test content";

      // Create and rename in the overlay
      const ogFile = await overlay.create(ogPath, content);
      await overlay.rename(ogFile, newPath);

      // Expect not to get old path
      expect(overlay.getFileByPath(ogPath)).toBeNull();
    });

    it("should not get file using old path after rename file created in vault", async () => {
      // Arrange
      const ogPath = "/file.md";
      const newPath = "/existing-file.md";
      const content = "# Test content";

      // Create in vault and rename in the overlay
      const ogFile = helpers.addFile(ogPath, content);
      await overlay.rename(ogFile, newPath);

      // Expect not to get old path
      expect(overlay.getFileByPath(ogPath)).toBeNull();
    });

    it("should reject rename with directory traversal", async () => {
      await overlay.create("test.md", "content");
      const file = overlay.getFileByPath("test.md");

      await expect(overlay.rename(file, "../outside.md")).rejects.toThrow(
        "Path is outside the vault",
      );
      await expect(overlay.rename(file, "folder/../test.md")).rejects.toThrow(
        "Path is outside the vault",
      );
    });

    it("should reject rename of deleted file", async () => {
      await overlay.create("test.md", "content");
      const file = overlay.getFileByPath("test.md");
      await overlay.delete(file);

      await expect(overlay.rename(file, "renamed.md")).rejects.toThrow(
        "Cannot rename file that was deleted",
      );
    });

    it("should reject rename to path existing in vault", async () => {
      // Create file in vault
      helpers.addFile("vault-file.md", "vault content");

      // Create file in overlay
      await overlay.create("overlay-file.md", "overlay content");
      const overlayFile = overlay.getFileByPath("overlay-file.md");

      await expect(
        overlay.rename(overlayFile, "vault-file.md"),
      ).rejects.toThrow("Cannot rename to path that already exists");
    });

    it("should sync file before rename when not in overlay", async () => {
      // Create file in vault
      helpers.addFile("vault-file.md", "vault content");

      const vaultFile = vault.getFileByPath("vault-file.md");

      // Rename should sync first
      await overlay.rename(vaultFile, "renamed-vault-file.md");

      const renamedFile = overlay.getFileByPath("renamed-vault-file.md");
      expect(renamedFile).toBeTruthy();
      expect(await overlay.read(renamedFile)).toBe("vault content");
    });

    it("should create parent directories when renaming", async () => {
      await overlay.create("test.md", "content");
      const file = overlay.getFileByPath("test.md");

      await overlay.rename(file, "new/nested/path/test.md");

      const renamedFile = overlay.getFileByPath("new/nested/path/test.md");
      expect(renamedFile).toBeTruthy();

      const parentFolder = overlay.getFolderByPath("new/nested/path");
      expect(parentFolder).toBeTruthy();
    });

    it("should handle rename within same parent (name change only)", async () => {
      await overlay.create("folder/test.md", "content");
      const file = overlay.getFileByPath("folder/test.md");

      await overlay.rename(file, "folder/renamed.md");

      const renamedFile = overlay.getFileByPath("folder/renamed.md");
      expect(renamedFile).toBeTruthy();
      const renamedNode = overlay.proposedFS.findByPath("folder/renamed.md");
      expect(renamedNode).toBeTruthy();
      expect(renamedNode.data.get("name")).toBe("renamed.md");

      const oldFile = overlay.getFileByPath("folder/test.md");
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
      await overlay.delete(file);

      // Assert
      // Verify the file is tracked as deleted in the overlay
      const proposedNode = overlay.proposedFS.findDeleted(file.path);
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
      await expect(overlay.delete(nonExistentFile)).rejects.toThrow();

      // Verify the vault's delete method was not called
      expect(vault.delete).not.toHaveBeenCalled();
    });

    it("should handle deleting a file that was previously created through the overlay", async () => {
      // Arrange - Create a file through the overlay (not in the actual vault)
      const filePath = "/overlay-file-to-delete.md";
      const fileContent = "# Overlay File to Delete";

      // Create the file through the overlay
      const file = await overlay.create(filePath, fileContent);

      // Verify the file exists in the overlay
      const contentFromVC = await overlay.read(file);
      expect(contentFromVC).toBe(fileContent);

      // Act - Delete the file through the overlay
      await overlay.delete(file);

      // Assert - The file should be deleted from the overlay
      await expect(overlay.read(file)).rejects.toThrow();

      // Verify the vault's delete method was not called
      expect(vault.delete).not.toHaveBeenCalled();
    });

    it("should return early when trying to delete already deleted file", async () => {
      // Create and delete a file
      await overlay.create("test.md", "content");
      const file = overlay.getFileByPath("test.md");
      await overlay.delete(file);

      // Try to delete again - should return early
      await overlay.delete(file);

      // Verify file is still in deleted state
      const deletedNode = overlay.proposedFS.findDeleted("test.md");
      expect(deletedNode).toBeTruthy();
    });

    it("should sync file before deletion when not in overlay", async () => {
      // Create file directly in vault (not in overlay)
      helpers.addFile("vault-file.md", "vault content");
      const vaultFile = vault.getFileByPath("vault-file.md");

      // Delete should sync first, then delete
      await overlay.delete(vaultFile);

      // Verify file was synced and then deleted
      const deletedNode = overlay.proposedFS.findDeleted("vault-file.md");
      expect(deletedNode).toBeTruthy();
    });
  });

  describe("Node Creation", () => {
    it("should throw error when creating node that already exists", () => {
      // Create node
      overlay.proposedFS.createNode("test.md", {
        isDirectory: false,
        text: "content",
      });

      // Try to create same node again
      expect(() => {
        overlay.proposedFS.createNode("test.md", {
          isDirectory: false,
          text: "content",
        });
      }).toThrow("Node already exists: test.md");
    });

    it("should create intermediate directories when creating nested paths", () => {
      const node = overlay.proposedFS.createNode("deep/nested/path/file.md", {
        isDirectory: false,
        text: "content",
      });

      expect(node).toBeTruthy();

      // Verify intermediate directories were created
      const deepFolder = overlay.proposedFS.findByPath("deep");
      const nestedFolder = overlay.proposedFS.findByPath("deep/nested");
      const pathFolder = overlay.proposedFS.findByPath("deep/nested/path");

      expect(deepFolder).toBeTruthy();
      expect(nestedFolder).toBeTruthy();
      expect(pathFolder).toBeTruthy();
    });
  });

  describe("Trash Operations", () => {
    it("should move file to trash folder when deleted", async () => {
      await overlay.create("test.md", "content");
      const file = overlay.getFileByPath("test.md");
      await overlay.delete(file);

      const deletedNode = overlay.proposedFS.findDeleted("test.md");
      expect(deletedNode).toBeDefined();

      expect(deletedNode.parent().data.get("name")).toEqual(".overlay-trash");
    });

    it("should restore deleted file when creating with same path", async () => {
      // Create and delete a file
      await overlay.create("test.md", "original content");
      const file = overlay.getFileByPath("test.md");
      await overlay.delete(file);

      // Verify file is deleted and not accessible
      expect(overlay.getFileByPath("test.md")).toBeNull();
      expect(overlay.proposedFS.isDeleted("test.md")).toBe(true);

      // Create file with same path but different content
      const newFile = await overlay.create("test.md", "new content");
      
      // Should restore the file with new content
      expect(newFile).toBeTruthy();
      expect(newFile.path).toBe("test.md");
      
      const content = await overlay.read(newFile);
      expect(content).toBe("new content");
      
      // Should no longer be marked as deleted
      expect(overlay.proposedFS.isDeleted("test.md")).toBe(false);
      
      // Should be accessible via getFileByPath
      const retrievedFile = overlay.getFileByPath("test.md");
      expect(retrievedFile).toBeTruthy();
      expect(retrievedFile.path).toBe("test.md");
    });
  });

  describe("Folder Children Enumeration", () => {
    it("should list all children including vault and overlay files", async () => {
      // Create files in vault
      helpers.addFile("folder/vault-file1.md", "vault content 1");
      helpers.addFile("folder/vault-file2.md", "vault content 2");

      // Create files in overlay
      await overlay.create("folder/overlay-file1.md", "overlay content 1");
      await overlay.create("folder/overlay-file2.md", "overlay content 2");

      const folder = overlay.getFolderByPath("folder");
      expect(folder).toBeTruthy();

      const children = folder.children;
      expect(children).toHaveLength(4);

      const childPaths = children.map((child) => child.path).sort();
      expect(childPaths).toEqual([
        "folder/overlay-file1.md",
        "folder/overlay-file2.md",
        "folder/vault-file1.md",
        "folder/vault-file2.md",
      ]);
    });

    it("should not show deleted files in folder children", async () => {
      // Create files in vault and overlay
      helpers.addFile("folder/vault-file.md", "vault content");
      await overlay.create("folder/overlay-file.md", "overlay content");

      // Delete the vault file through overlay
      const vaultFile = overlay.getFileByPath("folder/vault-file.md");
      await overlay.delete(vaultFile);

      const folder = overlay.getFolderByPath("folder");
      const children = folder.children;

      // Should only show the overlay file, not the deleted vault file
      expect(children).toHaveLength(1);
      expect(children[0].path).toBe("folder/overlay-file.md");
    });

    it("should not show .overlay-trash in root folder children", async () => {
      // Create some files and delete one to ensure trash folder exists
      await overlay.create("test.md", "content");
      const file = overlay.getFileByPath("test.md");
      await overlay.delete(file);

      // Create some regular files in root
      helpers.addFile("vault-file.md", "vault content");
      await overlay.create("overlay-file.md", "overlay content");

      const rootFolder = overlay.getFolderByPath("/");
      const children = rootFolder.children;

      // Should not include .overlay-trash folder
      const childNames = children.map((child) => child.name);
      expect(childNames).not.toContain(".overlay-trash");
      expect(childNames).toContain("vault-file.md");
      expect(childNames).toContain("overlay-file.md");
    });

    it("should show vault files not yet imported to overlay", async () => {
      // Create files only in vault (not accessed through overlay yet)
      helpers.addFile("folder/untouched-file1.md", "content 1");
      helpers.addFile("folder/untouched-file2.md", "content 2");
      helpers.addFile("folder/untouched-file3.md", "content 3");

      const folder = overlay.getFolderByPath("folder");
      const children = folder.children;

      expect(children).toHaveLength(3);

      const childPaths = children.map((child) => child.path).sort();
      expect(childPaths).toEqual([
        "folder/untouched-file1.md",
        "folder/untouched-file2.md",
        "folder/untouched-file3.md",
      ]);

      // Verify these files still have vault references updated to overlay
      children.forEach((child) => {
        expect(child.vault).toBe(overlay);
      });
    });

    it("should handle mixed scenarios with overlays, vault files, and deletions", async () => {
      // Create files in vault
      helpers.addFile("folder/vault-file1.md", "vault 1");
      helpers.addFile("folder/vault-file2.md", "vault 2");
      helpers.addFile("folder/vault-file3.md", "vault 3");

      // Create files in overlay
      await overlay.create("folder/overlay-file1.md", "overlay 1");
      await overlay.create("folder/overlay-file2.md", "overlay 2");

      // Modify a vault file through overlay
      const vaultFile2 = overlay.getFileByPath("folder/vault-file2.md");
      await overlay.modify(vaultFile2, "modified vault 2");

      // Delete a vault file through overlay
      const vaultFile3 = overlay.getFileByPath("folder/vault-file3.md");
      await overlay.delete(vaultFile3);

      const folder = overlay.getFolderByPath("folder");
      const children = folder.children;

      // Should show: vault-file1 (untouched), vault-file2 (modified), overlay-file1, overlay-file2
      // Should not show: vault-file3 (deleted)
      expect(children).toHaveLength(4);

      const childPaths = children.map((child) => child.path).sort();
      expect(childPaths).toEqual([
        "folder/overlay-file1.md",
        "folder/overlay-file2.md",
        "folder/vault-file1.md",
        "folder/vault-file2.md",
      ]);
    });

    it("should handle nested folder structures", async () => {
      // Create nested structure in vault
      helpers.addFile("parent/child1/vault-file.md", "vault content");
      helpers.addFile("parent/child2/vault-file.md", "vault content");

      // Create nested structure in overlay
      await overlay.create("parent/child1/overlay-file.md", "overlay content");
      await overlay.create("parent/child3/overlay-file.md", "overlay content");

      const parentFolder = overlay.getFolderByPath("parent");
      const parentChildren = parentFolder.children;

      // Should show child1, child2, child3 folders
      expect(parentChildren).toHaveLength(3);

      const childFolderNames = parentChildren
        .filter(
          (child) => child instanceof TFolder || child.name !== child.path,
        )
        .map((child) => child.name)
        .sort();
      expect(childFolderNames).toEqual(["child1", "child2", "child3"]);

      // Check child1 contents
      const child1Folder = overlay.getFolderByPath("parent/child1");
      const child1Children = child1Folder.children;
      expect(child1Children).toHaveLength(2);

      const child1FileNames = child1Children.map((child) => child.name).sort();
      expect(child1FileNames).toEqual(["overlay-file.md", "vault-file.md"]);
    });

    it("should handle empty folders correctly", async () => {
      // Create empty folder in overlay
      await overlay.createFolder("empty-overlay-folder");

      // Create folder with files in vault, then delete all files
      helpers.addFile("empty-vault-folder/file1.md", "content");
      helpers.addFile("empty-vault-folder/file2.md", "content");

      const file1 = overlay.getFileByPath("empty-vault-folder/file1.md");
      const file2 = overlay.getFileByPath("empty-vault-folder/file2.md");
      await overlay.delete(file1);
      await overlay.delete(file2);

      // Test empty overlay folder
      const emptyOverlayFolder = overlay.getFolderByPath(
        "empty-overlay-folder",
      );
      expect(emptyOverlayFolder.children).toHaveLength(0);

      // Test "empty" vault folder (all files deleted)
      const emptyVaultFolder = overlay.getFolderByPath("empty-vault-folder");
      expect(emptyVaultFolder.children).toHaveLength(0);
    });

    it("should maintain consistent behavior between direct file access and folder enumeration", async () => {
      // Create mixed content
      helpers.addFile("folder/vault-file.md", "vault content");
      await overlay.create("folder/overlay-file.md", "overlay content");

      const folder = overlay.getFolderByPath("folder");
      const children = folder.children;

      // Verify each child can be accessed directly
      for (const child of children) {
        const directAccess = overlay.getFileByPath(child.path);
        expect(directAccess).toBeTruthy();
        expect(directAccess.path).toBe(child.path);
        expect(directAccess.name).toBe(child.name);

        if (directAccess instanceof TFile) {
          // Should be able to read the file
          const content = await overlay.read(directAccess);
          expect(content).toBeTruthy();
        }
      }
    });

    it("should handle folder enumeration with renamed files", async () => {
      // Create files
      helpers.addFile("folder/original.md", "content");
      await overlay.create("folder/overlay-original.md", "overlay content");

      // Rename files
      const vaultFile = overlay.getFileByPath("folder/original.md");
      await overlay.rename(vaultFile, "folder/renamed.md");

      const overlayFile = overlay.getFileByPath("folder/overlay-original.md");
      await overlay.rename(overlayFile, "folder/overlay-renamed.md");

      const folder = overlay.getFolderByPath("folder");
      const children = folder.children;

      expect(children).toHaveLength(2);

      const childNames = children.map((child) => child.name).sort();
      expect(childNames).toEqual(["overlay-renamed.md", "renamed.md"]);

      // Verify old names are not accessible
      expect(overlay.getFileByPath("folder/original.md")).toBeNull();
      expect(overlay.getFileByPath("folder/overlay-original.md")).toBeNull();
    });
  });
});
