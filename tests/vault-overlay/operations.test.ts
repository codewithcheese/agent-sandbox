import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { vault, helpers, MockTFile } from "../mocks/obsidian.ts";
import type { TFile, Vault, TAbstractFile } from "obsidian";
import { nanoid } from "nanoid";

describe("VaultOverlayGit", () => {
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

  it("should initialize the git repo once per chatId only", async () => {
    // create and initialize the vault overlay again
    vaultOverlay = new VaultOverlay(vault as unknown as Vault);
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
  });

  describe("Create File Test", () => {
    it("should create a file in the version control system but not in the actual vault", async () => {
      // Arrange
      const filePath = "/test-file.md";
      const fileContent = "# Test Content";

      // Act
      const file = await vaultOverlay.create(filePath, fileContent);

      // Assert
      // Verify the file object is returned correctly
      expect(file).toBeTruthy();
      expect(file.path).toBe(filePath);

      // Verify the file exists in the version control system
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

      // Test path ending with a slash (would be a folder)
      await expect(
        vaultOverlay.create("/invalid-file/", "Content"),
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
    it("should modify a file in the version control system but not in the actual vault", async () => {
      // Arrange - Create a file in the actual vault
      const filePath = "/file-to-modify.md";
      const originalContent = "# Original Content";
      const modifiedContent = "# Modified Content";

      // Add the file to the mock vault
      const file = helpers.addFile(filePath, originalContent);

      // Act - Modify the file through the overlay
      await vaultOverlay.modify(file, modifiedContent);

      // Assert
      // Verify the file was modified in the version control system
      const contentFromVC = await vaultOverlay.read(file);
      expect(contentFromVC).toBe(modifiedContent);

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

      // Assert - The file should be created in the version control system
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
      // Verify the file has the second modification in the version control system
      const contentFromVC = await vaultOverlay.read(file);
      expect(contentFromVC).toBe(secondModification);

      // Verify the original content is still in the mock filesystem
      const contentFromVault = await vault.read(file);
      expect(contentFromVault).toBe(originalContent);
    });
  });

  describe("Rename File Test", () => {
    it("should create and rename a file in the version control system but not in the actual vault", async () => {
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
        `Source ${nonExistentPath} does not exist.`,
      );
    });

    it("should throw an error when the new path already exists", async () => {
      // Arrange
      const filePath = "/test-rename-existing.md";
      const existingPath = "/existing-file.md";
      const content = "# Test content for rename";

      // Create files in version control through the overlay
      const sourceFile = await vaultOverlay.create(filePath, content);
      await vaultOverlay.create(existingPath, "Existing content");

      // Act & Assert
      await expect(
        vaultOverlay.rename(sourceFile, existingPath),
      ).rejects.toThrow("Destination /existing-file.md already exists.");
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
      // Verify the file is tracked as deleted in the version control system
      const stagingNode = vaultOverlay.findNode("staging", file.path);
      expect(stagingNode.data.get("isDeleted")).toEqual(true);

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

      // Verify the file exists in the version control system
      const contentFromVC = await vaultOverlay.read(file);
      expect(contentFromVC).toBe(fileContent);

      // Act - Delete the file through the overlay
      await vaultOverlay.delete(file);

      // Assert - The file should be deleted from the version control system
      await expect(vaultOverlay.read(file)).rejects.toThrow();

      // Verify the vault's delete method was not called
      expect(vault.delete).not.toHaveBeenCalled();
    });
  });
});
