import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VaultOverlay } from "./vault-overlay";
import { VersionControl } from "./version-control";
import type { TFile, Vault } from "obsidian";
import { vault, helpers, MockTFile } from "../../../tests/mocks/obsidian";

describe("VaultOverlay", () => {
  let versionControl: VersionControl;
  let vaultOverlay: VaultOverlay;

  beforeEach(async () => {
    // Reset the mock vault state before each test
    helpers.reset();

    // Initialize version control
    versionControl = new VersionControl();
    await versionControl.init();

    // Create the vault overlay with the mock vault
    vaultOverlay = new VaultOverlay(vault as unknown as Vault, versionControl);
  });

  afterEach(async () => {
    await versionControl.dispose();
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
      const contentFromVC = await versionControl.readFile(filePath);
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
      ).rejects.toThrow("Path is outside the vault");

      // Test path ending with a slash (would be a folder)
      await expect(
        vaultOverlay.create("/invalid-file/", "Content"),
      ).rejects.toThrow("Invalid file path");
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

    it("should throw an error when parent folder does not exist", async () => {
      // No need to mock folder existence since the mock vault already handles this correctly

      // Try to create a file in a non-existent folder
      await expect(
        vaultOverlay.create("/non-existent-folder/file.md", "Content"),
      ).rejects.toThrow("Parent folder does not exist");
    });
  });

  describe("Modify File Test", () => {
    it("should modify a file in the version control system but not in the actual vault", async () => {
      // Arrange - Create a file in the actual vault
      const filePath = "/file-to-modify.md";
      const originalContent = "# Original Content";
      const modifiedContent = "# Modified Content";

      // Add the file to the mock vault
      const file = helpers.addFile(
        filePath,
        originalContent,
      ) as unknown as TFile;

      // Act - Modify the file through the overlay
      await vaultOverlay.modify(file, modifiedContent);

      // Assert
      // Verify the file was modified in the version control system
      const contentFromVC = await versionControl.readFile(filePath);
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
      const nonExistentFile = new MockTFile(
        nonExistentFilePath,
      ) as unknown as TFile;

      // Act - Modify the non-existent file
      await vaultOverlay.modify(nonExistentFile, newContent);

      // Assert - The file should be created in the version control system
      const contentFromVC = await versionControl.readFile(nonExistentFilePath);
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
      const file = helpers.addFile(
        filePath,
        originalContent,
      ) as unknown as TFile;

      // Act - Modify the file twice through the overlay
      await vaultOverlay.modify(file, firstModification);
      await vaultOverlay.modify(file, secondModification);

      // Assert
      // Verify the file has the second modification in the version control system
      const contentFromVC = await versionControl.readFile(filePath);
      expect(contentFromVC).toBe(secondModification);

      // Verify the original content is still in the mock filesystem
      const contentFromVault = await vault.read(file);
      expect(contentFromVault).toBe(originalContent);
    });
  });

  describe("Delete File Test", () => {
    it("should delete a file in the version control system but not in the actual vault", async () => {
      // Arrange - Create a file in the actual vault
      const filePath = "/file-to-delete.md";
      const fileContent = "# File to Delete";

      // Add the file to the mock vault
      const file = helpers.addFile(
        filePath,
        fileContent,
      ) as unknown as TFile;

      // Act - Delete the file through the overlay
      await vaultOverlay.delete(file);

      // Assert
      // Verify the file is marked as deleted in the version control system
      // This should throw an error when trying to read the deleted file
      await expect(versionControl.readFile(filePath)).rejects.toThrow();

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
      const nonExistentFile = new MockTFile(
        nonExistentFilePath,
      ) as unknown as TFile;

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
      const contentFromVC = await versionControl.readFile(filePath);
      expect(contentFromVC).toBe(fileContent);

      // Act - Delete the file through the overlay
      await vaultOverlay.delete(file);

      // Assert - The file should be deleted from the version control system
      await expect(versionControl.readFile(filePath)).rejects.toThrow();

      // Verify the vault's delete method was not called
      expect(vault.delete).not.toHaveBeenCalled();
    });
  });
});
