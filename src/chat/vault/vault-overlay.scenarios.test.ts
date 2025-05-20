import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VaultOverlay } from "./vault-overlay";
import { VaultOverlay } from "./version-control";
import { vault, helpers, MockTFile } from "../../../tests/mocks/obsidian";
import type { TFile, Vault, TAbstractFile } from "obsidian";

/**
 * This test suite focuses on realistic scenarios that might occur during
 * AI agent interactions with an Obsidian vault. Each scenario represents
 * a complete workflow that might happen during a conversation.
 */
describe("VaultOverlay Scenarios", () => {
  let versionControl: VaultOverlay;
  let vaultOverlay: VaultOverlay;

  beforeEach(async () => {
    // Reset the mock vault state before each test
    helpers.reset();

    // Initialize version control
    versionControl = new VaultOverlay(vault as unknown as Vault);
    await versionControl.init();

    // Create the vault overlay with the mock vault
    vaultOverlay = new VaultOverlay(vault as unknown as Vault, versionControl);
  });

  afterEach(async () => {
    await versionControl.destroy();
  });

  describe("Scenario 1: Note-taking workflow", () => {
    it("should handle creating a new note, adding content, and organizing it", async () => {
      // 1. Create a folder structure for notes
      await vaultOverlay.createFolder("/Notes/");
      await vaultOverlay.createFolder("/Notes/Projects/");

      // 2. Create a new note
      const notePath = "/Notes/Projects/ProjectX.md";
      const initialContent = "# Project X\n\nInitial project notes.";
      const noteFile = await vaultOverlay.create(notePath, initialContent);

      // 3. Later in the conversation, update the note with more content
      const updatedContent =
        "# Project X\n\nInitial project notes.\n\n## Tasks\n- [ ] Research\n- [ ] Planning\n- [ ] Implementation";
      await vaultOverlay.modify(noteFile, updatedContent);

      // 4. Create a related note
      const relatedNotePath = "/Notes/Projects/ProjectX-Research.md";
      const researchContent =
        "# Project X Research\n\nFindings from initial research phase.";
      await vaultOverlay.create(relatedNotePath, researchContent);

      // 5. Decide to reorganize - create a dedicated folder for this project
      await vaultOverlay.createFolder("/Notes/Projects/ProjectX/");

      // 6. Move the notes to the new folder
      const newNotePath = "/Notes/Projects/ProjectX/Overview.md";
      const newResearchPath = "/Notes/Projects/ProjectX/Research.md";

      await vaultOverlay.rename(noteFile, newNotePath);

      const researchFile = vaultOverlay.getFileByPath(relatedNotePath);
      await vaultOverlay.rename(researchFile, newResearchPath);

      // Verify the final state
      // Both files should exist in version control with correct content
      const overviewContent = await versionControl.readFile(newNotePath);
      expect(overviewContent).toBe(updatedContent);

      const finalResearchContent =
        await versionControl.readFile(newResearchPath);
      expect(finalResearchContent).toBe(researchContent);

      // Original paths should no longer exist
      await expect(versionControl.readFile(notePath)).rejects.toThrow();
      await expect(versionControl.readFile(relatedNotePath)).rejects.toThrow();

      // Check file changes
      const changes = await versionControl.getFileChanges();
      expect(
        changes.some((c) => c.path === newNotePath && c.status === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === newResearchPath && c.status === "added"),
      ).toBe(true);
    });
  });

  describe("Scenario 2: Working with existing vault content", () => {
    it("should handle importing, modifying, and organizing existing vault files", async () => {
      // 1. Setup existing files in the vault
      const existingNotePath = "/ExistingNote.md";
      const existingContent =
        "# Existing Note\n\nThis is a note that already exists in the vault.";
      helpers.addFile(existingNotePath, existingContent);

      const anotherNotePath = "/AnotherNote.md";
      const anotherContent = "# Another Note\n\nThis is another existing note.";
      helpers.addFile(anotherNotePath, anotherContent);

      // 2. AI agent reads an existing note (which triggers import)
      const existingFile = vault.getFileByPath(existingNotePath) as TFile;
      expect(existingFile).not.toBeNull();

      // 3. Modify the existing note
      const updatedExistingContent =
        existingContent +
        "\n\n## Updates\nAdded new section with important information.";
      await vaultOverlay.modify(existingFile, updatedExistingContent);

      // 4. Create a new folder to organize content
      await vaultOverlay.createFolder("/Organized/");

      // 5. Move the existing notes to the new folder
      const newExistingPath = "/Organized/ExistingNote.md";
      await vaultOverlay.rename(existingFile, newExistingPath);

      const anotherFile = vault.getFileByPath(anotherNotePath) as TFile;
      const newAnotherPath = "/Organized/AnotherNote.md";
      await vaultOverlay.rename(anotherFile, newAnotherPath);

      // 6. Create a new index file referencing the other files
      const indexPath = "/Organized/Index.md";
      const indexContent = "# Index\n\n- [[ExistingNote]]\n- [[AnotherNote]]";
      await vaultOverlay.create(indexPath, indexContent);

      // Verify the final state
      const finalExistingContent =
        await versionControl.readFile(newExistingPath);
      expect(finalExistingContent).toBe(updatedExistingContent);

      const finalAnotherContent = await versionControl.readFile(newAnotherPath);
      expect(finalAnotherContent).toBe(anotherContent);

      const finalIndexContent = await versionControl.readFile(indexPath);
      expect(finalIndexContent).toBe(indexContent);

      // Check file changes
      const changes = await versionControl.getFileChanges();
      expect(
        changes.some((c) => c.path === newExistingPath && c.status === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === newAnotherPath && c.status === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === indexPath && c.status === "added"),
      ).toBe(true);
    });
  });

  describe("Scenario 3: Handling conflicts and edge cases", () => {
    it("should handle file name conflicts and special characters", async () => {
      // 1. Create files with special characters in names
      const specialCharPath = "/Special-Chars-!@#$%^&()_+.md";
      const specialContent = "# Special Characters Test";
      await vaultOverlay.create(specialCharPath, specialContent);

      // 2. Create files with same name in different folders
      await vaultOverlay.createFolder("/FolderA/");
      await vaultOverlay.createFolder("/FolderB/");

      const fileInFolderA = "/FolderA/same-name.md";
      const fileInFolderB = "/FolderB/same-name.md";

      await vaultOverlay.create(fileInFolderA, "# File in Folder A");
      await vaultOverlay.create(fileInFolderB, "# File in Folder B");

      // 3. Try to rename a file to an existing path
      const fileA = vaultOverlay.getFileByPath(fileInFolderA) as TFile;
      await expect(vaultOverlay.rename(fileA, fileInFolderB)).rejects.toThrow(
        "Destination file already exists",
      );

      // 4. Create a file with a very long name
      const longNamePath =
        "/This-is-a-very-long-file-name-that-tests-the-limits-of-file-naming-conventions-in-the-system-and-ensures-it-works-correctly-with-extended-names.md";
      await vaultOverlay.create(longNamePath, "# Long Name Test");

      // 5. Verify all files exist with correct content
      const specialFileContent = await versionControl.readFile(specialCharPath);
      expect(specialFileContent).toBe(specialContent);

      const folderAContent = await versionControl.readFile(fileInFolderA);
      expect(folderAContent).toBe("# File in Folder A");

      const folderBContent = await versionControl.readFile(fileInFolderB);
      expect(folderBContent).toBe("# File in Folder B");

      const longNameContent = await versionControl.readFile(longNamePath);
      expect(longNameContent).toBe("# Long Name Test");
    });
  });

  describe("Scenario 4: Complex document editing workflow", () => {
    it("should handle a complex document creation and editing workflow", async () => {
      // 1. Create a project structure
      await vaultOverlay.createFolder("/Project/");
      await vaultOverlay.createFolder("/Project/docs/");
      await vaultOverlay.createFolder("/Project/src/");
      await vaultOverlay.createFolder("/Project/assets/");

      // 2. Create initial README
      const readmePath = "/Project/README.md";
      const initialReadme = "# Project\n\nInitial project setup.";
      await vaultOverlay.create(readmePath, initialReadme);

      // 3. Create multiple documentation files
      const installPath = "/Project/docs/installation.md";
      const usagePath = "/Project/docs/usage.md";
      const apiPath = "/Project/docs/api.md";

      await vaultOverlay.create(
        installPath,
        "# Installation\n\nInstallation instructions.",
      );
      await vaultOverlay.create(usagePath, "# Usage\n\nUsage instructions.");
      await vaultOverlay.create(apiPath, "# API\n\nAPI documentation.");

      // 4. Update README to reference the docs
      const readmeFile = vaultOverlay.getFileByPath(readmePath) as TFile;
      const updatedReadme =
        initialReadme +
        "\n\n## Documentation\n\n- [Installation](docs/installation.md)\n- [Usage](docs/usage.md)\n- [API](docs/api.md)";
      await vaultOverlay.modify(readmeFile, updatedReadme);

      // 5. Decide to reorganize the docs
      await vaultOverlay.createFolder("/Project/docs/guides/");

      // 6. Move usage to guides folder
      const usageFile = vaultOverlay.getFileByPath(usagePath) as TFile;
      const newUsagePath = "/Project/docs/guides/usage.md";
      await vaultOverlay.rename(usageFile, newUsagePath);

      // 7. Update the README again to reflect the new structure
      const finalReadme = updatedReadme.replace(
        "[Usage](docs/usage.md)",
        "[Usage](docs/guides/usage.md)",
      );
      await vaultOverlay.modify(readmeFile, finalReadme);

      // 8. Delete the API docs as they're not needed anymore
      const apiFile = vaultOverlay.getFileByPath(apiPath) as TFile;
      await vaultOverlay.delete(apiFile);

      // Verify the final state
      const readmeContent = await versionControl.readFile(readmePath);
      expect(readmeContent).toBe(finalReadme);

      const installContent = await versionControl.readFile(installPath);
      expect(installContent).toBe(
        "# Installation\n\nInstallation instructions.",
      );

      const usageContent = await versionControl.readFile(newUsagePath);
      expect(usageContent).toBe("# Usage\n\nUsage instructions.");

      // API file should be deleted
      await expect(versionControl.readFile(apiPath)).rejects.toThrow();

      // Check file changes
      const changes = await versionControl.getFileChanges();
      expect(
        changes.some((c) => c.path === readmePath && c.status === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === installPath && c.status === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === newUsagePath && c.status === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === apiPath && c.status === "deleted"),
      ).toBe(true);
    });
  });

  describe("Scenario 5: Handling binary files and limitations", () => {
    it("should handle unsupported operations appropriately", async () => {
      // 1. Create a text file successfully
      const textPath = "/text-file.md";
      await vaultOverlay.create(textPath, "# Text content");

      // 2. Try binary operations which should fail
      const binPath = "/binary-file.bin";
      const binaryData = new ArrayBuffer(10);

      // These operations should throw errors as they're not supported
      await expect(
        vaultOverlay.createBinary(binPath, binaryData),
      ).rejects.toThrow("createBinary not supported");

      const textFile = vaultOverlay.getFileByPath(textPath) as TFile;
      await expect(
        vaultOverlay.modifyBinary(textFile, binaryData),
      ).rejects.toThrow("modifyBinary not supported");
      await expect(vaultOverlay.readBinary(textFile)).rejects.toThrow(
        "readBinary not supported",
      );

      // 3. Try other unsupported operations
      await expect(
        vaultOverlay.append(textFile, "Appended content"),
      ).rejects.toThrow("append not supported");
      await expect(
        vaultOverlay.process(textFile, (content) => content + " processed"),
      ).rejects.toThrow("process not supported");
      await expect(vaultOverlay.trash(textFile)).rejects.toThrow(
        "trash not supported",
      );

      // 4. Verify the text file still exists and is unaffected
      const textContent = await versionControl.readFile(textPath);
      expect(textContent).toBe("# Text content");
    });
  });
});
