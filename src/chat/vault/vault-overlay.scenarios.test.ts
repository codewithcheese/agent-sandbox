import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VaultOverlay } from "./vault-overlay";
import { vault, helpers, MockTFile } from "../../../tests/mocks/obsidian";
import type { TFile, Vault, TAbstractFile } from "obsidian";
import { nanoid } from "nanoid";

/**
 * This test suite focuses on realistic scenarios that might occur during
 * AI agent interactions with an Obsidian vault. Each scenario represents
 * a complete workflow that might happen during a conversation.
 */
describe("VaultOverlay Scenarios", () => {
  let vaultOverlay: VaultOverlay;

  beforeEach(async () => {
    // Reset the mock vault state before each test
    helpers.reset();

    // Initialize version control
    vaultOverlay = new VaultOverlay(nanoid(), vault as unknown as Vault);
    await vaultOverlay.init();
  });

  afterEach(async () => {
    await vaultOverlay.destroy();
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
      const relatedNoteContent =
        "# Project X Research\n\nFindings from initial research phase.";
      await vaultOverlay.create(relatedNotePath, relatedNoteContent);

      // 5. Decide to reorganize - create a dedicated folder for this project
      await vaultOverlay.createFolder("/Notes/Projects/ProjectX/");

      // 6. Move the notes to the new folder
      const newNotePath = "/Notes/Projects/ProjectX/Overview.md";
      const newRelatedNotePath = "/Notes/Projects/ProjectX/Research.md";

      await vaultOverlay.rename(noteFile, newNotePath);

      const relatedFile = await vaultOverlay.getFileByPath(relatedNotePath);
      await vaultOverlay.rename(relatedFile, newRelatedNotePath);

      await vaultOverlay.commit("first commit");

      // Verify the final state
      const newNoteStatus = await vaultOverlay.fileIsTracked(newNotePath);
      expect(newNoteStatus).toBe("added");

      const movedNote = await vaultOverlay.getFileByPath(newNotePath);
      const finalNewNoteContent = await vaultOverlay.read(movedNote);
      expect(finalNewNoteContent).toBe(updatedContent);

      // Original paths should no longer exist
      await expect(vaultOverlay.read(noteFile)).rejects.toThrow(
        "File not found: /Notes/Projects/ProjectX.md",
      );
      await expect(vaultOverlay.read(relatedFile)).rejects.toThrow(
        "File not found: /Notes/Projects/ProjectX-Research.md",
      );

      // Check file changes
      const changes = await vaultOverlay.getFileChanges();
      console.log("File changes:", JSON.stringify(changes, null, 2));
      expect(changes.find((c) => c.path === notePath)).not.toBeDefined();
      expect(changes.find((c) => c.path === relatedNotePath)).not.toBeDefined();
      expect(
        changes.some((c) => c.path === newNotePath && c.type === "added"),
      ).toBe(true);
      expect(
        changes.some(
          (c) => c.path === newRelatedNotePath && c.type === "added",
        ),
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

      await vaultOverlay.commit("first commit");

      // Verify the final state
      const newExistingFile = await vaultOverlay.getFileByPath(newExistingPath);
      const finalExistingContent = await vaultOverlay.read(newExistingFile);
      expect(finalExistingContent).toBe(updatedExistingContent);

      const newAnotherFile = await vaultOverlay.getFileByPath(newAnotherPath);
      const finalAnotherContent = await vaultOverlay.read(newAnotherFile);
      expect(finalAnotherContent).toBe(anotherContent);

      const indexFile = await vaultOverlay.getFileByPath(indexPath);
      const finalIndexContent = await vaultOverlay.read(indexFile);
      expect(finalIndexContent).toBe(indexContent);

      // Check file changes
      const changes = await vaultOverlay.getFileChanges();
      expect(
        changes.some((c) => c.path === newExistingPath && c.type === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === newAnotherPath && c.type === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === indexPath && c.type === "added"),
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
      const fileA = await vaultOverlay.getFileByPath(fileInFolderA);
      await expect(vaultOverlay.rename(fileA, fileInFolderB)).rejects.toThrow(
        "Destination /FolderB/same-name.md already exists.",
      );

      // 4. Create a file with a very long name
      const longNamePath =
        "/This-is-a-very-long-file-name-that-tests-the-limits-of-file-naming-conventions-in-the-system-and-ensures-it-works-correctly-with-extended-names.md";
      await vaultOverlay.create(longNamePath, "# Long Name Test");

      // 5. Verify all files exist with correct content
      const specialFile = await vaultOverlay.getFileByPath(specialCharPath);
      const specialFileContent = await vaultOverlay.read(specialFile);
      expect(specialFileContent).toBe(specialContent);

      const folderAFile = await vaultOverlay.getFileByPath(fileInFolderA);
      const folderAContent = await vaultOverlay.read(folderAFile);
      expect(folderAContent).toBe("# File in Folder A");

      const folderBFile = await vaultOverlay.getFileByPath(fileInFolderB);
      const folderBContent = await vaultOverlay.read(folderBFile);
      expect(folderBContent).toBe("# File in Folder B");

      const longNameFile = await vaultOverlay.getFileByPath(longNamePath);
      const longNameContent = await vaultOverlay.read(longNameFile);
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
      const readmeFile = await vaultOverlay.getFileByPath(readmePath);
      const updatedReadme =
        initialReadme +
        "\n\n## Documentation\n\n- [Installation](docs/installation.md)\n- [Usage](docs/usage.md)\n- [API](docs/api.md)";
      await vaultOverlay.modify(readmeFile, updatedReadme);

      // 5. Decide to reorganize the docs
      await vaultOverlay.createFolder("/Project/docs/guides/");

      // 6. Move usage to guides folder
      const usageFile = await vaultOverlay.getFileByPath(usagePath);
      const newUsagePath = "/Project/docs/guides/usage.md";
      await vaultOverlay.rename(usageFile, newUsagePath);

      // 7. Update the README again to reflect the new structure
      const finalReadme = updatedReadme.replace(
        "[Usage](docs/usage.md)",
        "[Usage](docs/guides/usage.md)",
      );
      await vaultOverlay.modify(readmeFile, finalReadme);

      // 8. Delete the API docs as they're not needed anymore
      const apiFile = await vaultOverlay.getFileByPath(apiPath);
      await vaultOverlay.delete(apiFile);

      await vaultOverlay.commit("first commit");

      // Verify the final state
      const readmeContent = await vaultOverlay.read(readmeFile);
      expect(readmeContent).toBe(finalReadme);

      const installFile = await vaultOverlay.getFileByPath(installPath);
      const installContent = await vaultOverlay.read(installFile);
      expect(installContent).toBe(
        "# Installation\n\nInstallation instructions.",
      );

      const newUsageFile = await vaultOverlay.getFileByPath(newUsagePath);
      const usageContent = await vaultOverlay.read(newUsageFile);
      expect(usageContent).toBe("# Usage\n\nUsage instructions.");

      // API file should be deleted
      expect(await vaultOverlay.getFileByPath(apiPath)).toEqual(null);

      // Check file changes
      const changes = await vaultOverlay.getFileChanges();
      expect(
        changes.some((c) => c.path === readmePath && c.type === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === installPath && c.type === "added"),
      ).toBe(true);
      expect(
        changes.some((c) => c.path === newUsagePath && c.type === "added"),
      ).toBe(true);
      // todo: to properly check deleted, the file should exist in the vault
      expect(
        changes.some((c) => c.path === apiPath && c.type === "deleted"),
      ).toBe(false);
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

      const textFile = await vaultOverlay.getFileByPath(textPath);
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
      const textContent = await vaultOverlay.read(textFile);
      expect(textContent).toBe("# Text content");
    });
  });
});
