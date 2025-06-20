import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import type { TreeFS } from "../../src/chat/tree-fs.ts";
import { getBuffer, getText } from "$lib/utils/loro.ts";
import { TFile, TFolder } from "obsidian";
import type { LoroTreeNode } from "loro-crdt/base64";

describe("Approve changes", () => {
  let overlay: VaultOverlay;
  let proposedFS: TreeFS;
  let trackingFS: TreeFS;

  beforeEach(() => {
    overlay = new VaultOverlay(vault);
    proposedFS = overlay.proposedFS;
    trackingFS = overlay.trackingFS;
  });

  afterEach(async () => {
    await helpers.reset();
  });

  describe("approve modify only file", () => {
    beforeEach(async () => {
      helpers.addFile("notes/test.md", "Hello\n\nGoodbye");

      const file = overlay.getFileByPath("notes/test.md");
      await overlay.modify(file, "Hello\n\nProposed\n\nGoodbye");
    });

    it("should approve modify with current contents", async () => {
      await overlay.approve([{ path: "notes/test.md", type: "modify" }]);

      // expect tracking to equal proposed contents after approve
      const trackingNode = trackingFS.findByPath("notes/test.md");
      expect(getText(trackingNode)).toEqual("Hello\n\nProposed\n\nGoodbye");

      // expect tracking and proposed to be the same
      const proposedNode = proposedFS.findByPath("notes/test.md");
      expect(trackingNode.id).toEqual(proposedNode.id);
      expect(getText(trackingNode)).toEqual(getText(proposedNode));

      // expect file in vault to match proposed contents
      const file = vault.getFileByPath("notes/test.md");
      expect(file).not.toBeNull();
      expect(await vault.read(file)).toEqual("Hello\n\nProposed\n\nGoodbye");
    });

    it("should approve modify with new contents", async () => {
      // approve with new contents
      await overlay.approve([
        {
          type: "modify",
          path: "notes/test.md",
          override: { text: "Hello\n\nEdited\n\nGoodbye" },
        },
      ]);

      // expect tracking to equal proposed contents after approve
      const trackingNode = trackingFS.findByPath("notes/test.md");
      expect(getText(trackingNode)).toEqual("Hello\n\nEdited\n\nGoodbye");

      const proposedNode = proposedFS.findByPath("notes/test.md");
      expect(trackingNode.id).toEqual(proposedNode.id);
      // expect tracking and proposed to be different
      expect(getText(trackingNode)).not.toEqual(getText(proposedNode));

      const file = vault.getFileByPath("notes/test.md");
      expect(file).not.toBeNull();
      expect(await vault.read(file)).toEqual("Hello\n\nEdited\n\nGoodbye");
    });
  });

  it("should approve modify subset of files", async () => {
    helpers.addFile("something/one.md", "Original\n\nOne");
    helpers.addFile("another/two.md", "Original\n\nTwo");
    helpers.addFile("another/three.md", "Original\n\nThree");

    const file1 = overlay.getFileByPath("something/one.md");
    await overlay.modify(file1, "Original\n\nProposed\n\nGoodbye");

    // modify in different order from approval to test for change order dependence
    const file3 = overlay.getFileByPath("another/three.md");
    await overlay.modify(file3, "Hello\n\nDenied\n\nGoodbye");

    const file2 = overlay.getFileByPath("another/two.md");
    await overlay.modify(file2, "Thank you");

    await overlay.approve([
      { path: "something/one.md", type: "modify" },
      { path: "another/two.md", type: "modify" },
    ]);

    expect(getText(trackingFS.findByPath("something/one.md"))).toEqual(
      "Original\n\nProposed\n\nGoodbye",
    );
    expect(getText(trackingFS.findByPath("another/two.md"))).toEqual(
      "Thank you",
    );
    expect(getText(trackingFS.findByPath("another/three.md"))).toEqual(
      "Original\n\nThree",
    );

    expect(await vault.read(file1)).toEqual("Original\n\nProposed\n\nGoodbye");
    expect(await vault.read(file2)).toEqual("Thank you");
    // expect file3 not modified
    expect(await vault.read(file3)).toEqual("Original\n\nThree");
  });

  it("should approve delete file", async () => {
    helpers.addFile("notes/test.md", "Hello\n\nGoodbye");

    const file = overlay.getFileByPath("notes/test.md");
    await overlay.delete(file);

    const tNode = trackingFS.findByPath("notes/test.md");
    const pNode = proposedFS.findById(tNode.id);

    expect(pNode.data.get("deletedFrom")).toEqual("notes/test.md");

    await overlay.approve([{ path: "notes/test.md", type: "delete" }]);

    expect(tNode.isDeleted()).toEqual(true);
    expect(pNode.isDeleted()).toEqual(true);
    expect(vault.getFileByPath("notes/test.md")).toBeNull();
  });

  it("should approve delete subset of files", async () => {
    helpers.addFile("alpha.md", "Alpha content");
    helpers.addFile("beta.md", "Beta content");
    helpers.addFile("gamma.md", "Gamma content");

    const aFile = overlay.getFileByPath("alpha.md");
    const bFile = overlay.getFileByPath("beta.md");
    const gFile = overlay.getFileByPath("gamma.md");

    await overlay.delete(aFile);
    await overlay.modify(bFile, "Beta content\n\nModified");
    await overlay.delete(gFile);

    const aProposedNode = proposedFS.findTrashed("alpha.md");
    const bProposedNode = proposedFS.findByPath("beta.md");
    const gProposedNode = proposedFS.findTrashed("gamma.md");

    await overlay.approve([
      { path: "alpha.md", type: "delete" },
      { path: "gamma.md", type: "delete" },
    ]);

    const aTrackingNode = trackingFS.findById(aProposedNode.id);
    const bTrackingNode = trackingFS.findByPath("beta.md");
    const gTrackingNode = trackingFS.findById(gProposedNode.id);

    expect(aTrackingNode.isDeleted()).toBe(true);
    expect(getText(bTrackingNode)).toBe("Beta content");
    expect(bTrackingNode.isDeleted()).toBe(false);
    expect(gTrackingNode.isDeleted()).toBe(true);

    // Check proposedFS state as well
    expect(aProposedNode.isDeleted()).toBe(true); // Approved deletions should be marked as deleted
    expect(gProposedNode.isDeleted()).toBe(true); // Approved deletions should be marked as deleted
    expect(bProposedNode.isDeleted()).toBe(false); // Non-approved items should remain unchanged

    // Check vault state
    expect(vault.getFileByPath("alpha.md")).toBeNull();
    expect(vault.getFileByPath("beta.md")).not.toBeNull();
    expect(vault.getFileByPath("gamma.md")).toBeNull();
  });

  it("should approve delete folder", async () => {
    // Setup: Create a folder with some files
    helpers.addFolder("documents");
    const file1 = helpers.addFile("documents/file1.md", "Content 1");
    helpers.addFile("documents/file2.md", "Content 2");

    await overlay.modify(file1, "Modified content 1");

    // Get folder reference and delete it
    const folder = overlay.getFolderByPath("documents");
    await overlay.delete(folder);

    // Get the deleted folder node ID and approve
    const deletedFolderNode = proposedFS.findTrashed("documents");
    await overlay.approve([{ path: "documents", type: "delete" }]);

    // Assert that the folder is marked as deleted in tracking
    const trackingFolderNode = trackingFS.findById(deletedFolderNode.id);
    expect(trackingFolderNode.isDeleted()).toBe(true);
    expect(deletedFolderNode.isDeleted()).toBe(true);

    expect(trackingFS.findByPath("documents/file1.md")).not.toBeDefined();
    expect(proposedFS.findByPath("documents/file1.md")).not.toBeDefined();
    // Assert that the folder is deleted in vault
    expect(vault.getFolderByPath("documents")).toBeNull();
  });

  it("should approve delete subset of folders", async () => {
    // Setup: Create multiple folders with content
    helpers.addFolder("docs");
    helpers.addFile("docs/readme.md", "Docs readme");
    helpers.addFile("docs/guide.md", "User guide");

    helpers.addFolder("temp");
    helpers.addFile("temp/cache.txt", "Temp cache");

    helpers.addFolder("archive");
    helpers.addFile("archive/old.md", "Old content");

    helpers.addFolder("projects");
    helpers.addFile("projects/main.js", "Main project");

    // Mixed operations
    const docsFolder = overlay.getFolderByPath("docs");
    const tempFolder = overlay.getFolderByPath("temp");
    const archiveFolder = overlay.getFolderByPath("archive");
    const projectFile = overlay.getFileByPath("projects/main.js");

    await overlay.delete(docsFolder); // Will be approved
    await overlay.delete(tempFolder); // Will be approved
    await overlay.delete(archiveFolder); // Will NOT be approved
    await overlay.modify(projectFile, "Modified project"); // Will NOT be approved

    // Selective approval - only approve docs and temp folder deletions
    const docsDeletedNode = proposedFS.findTrashed("docs");
    const tempDeletedNode = proposedFS.findTrashed("temp");

    await overlay.approve([
      { path: "docs", type: "delete" },
      { path: "temp", type: "delete" },
    ]);

    // Assertions
    const docsTrackingNode = trackingFS.findById(docsDeletedNode.id);
    const tempTrackingNode = trackingFS.findById(tempDeletedNode.id);
    const archiveTrackingNode = trackingFS.findByPath("archive");
    const projectTrackingNode = trackingFS.findByPath("projects/main.js");

    // Approved deletions should be marked as deleted
    expect(docsTrackingNode.isDeleted()).toBe(true);
    expect(tempTrackingNode.isDeleted()).toBe(true);

    // Non-approved items should remain unchanged
    expect(archiveTrackingNode.isDeleted()).toBe(false);
    expect(projectTrackingNode.isDeleted()).toBe(false);
    expect(getText(projectTrackingNode)).toBe("Main project"); // Original content

    // Check proposed state
    expect(docsDeletedNode.isDeleted()).toBe(true);
    expect(tempDeletedNode.isDeleted()).toBe(true);
    expect(proposedFS.findTrashed("archive").isDeleted()).toEqual(false);
    expect(proposedFS.findByPath("projects/main.js")).toBeDefined(); // Still exists in proposed

    // Check vault state - approved deletions should be removed from vault
    expect(vault.getFolderByPath("docs")).toBeNull();
    expect(vault.getFolderByPath("temp")).toBeNull();
    expect(vault.getFolderByPath("archive")).not.toBeNull(); // Not approved, should still exist
    expect(vault.getFileByPath("projects/main.js")).not.toBeNull();
    expect(await vault.read(vault.getFileByPath("projects/main.js"))).toBe(
      "Main project",
    ); // Original content
  });

  it("should approve create file", async () => {
    // Create file in overlay (proposed state only)
    await overlay.create("new-dir/new-document.md", "Initial content");

    // Verify it exists in proposed but not tracking before approval
    const proposedNode = proposedFS.findByPath("new-dir/new-document.md");
    expect(proposedNode).toBeDefined();
    expect(getText(proposedNode)).toEqual("Initial content");
    expect(trackingFS.findByPath("new-dir/new-document.md")).toBeUndefined();

    // Approve the creation
    await overlay.approve([
      { path: "new-dir/new-document.md", type: "create" },
    ]);

    // Verify it now exists in tracking with correct content
    const trackingNode = trackingFS.findByPath("new-dir/new-document.md");
    expect(trackingNode).toBeDefined();
    expect(getText(trackingNode)).toEqual("Initial content");
    expect(getText(trackingNode)).toEqual(getText(proposedNode));

    // Check vault state - file should be created in vault
    const vaultFile = vault.getFileByPath("new-dir/new-document.md");
    expect(vaultFile).not.toBeNull();
    expect(await vault.read(vaultFile)).toEqual("Initial content");
  });

  it("should approve create binary file", async () => {
    // Create file in overlay (proposed state only)
    const data = new ArrayBuffer(32);
    await overlay.createBinary("test/image.jpg", data);

    // Verify it exists in proposed but not tracking before approval
    const proposedNode = proposedFS.findByPath("test/image.jpg");
    expect(proposedNode).toBeDefined();
    expect(getBuffer(proposedNode)).toEqual(data);
    expect(trackingFS.findByPath("test/image.jpg")).toBeUndefined();

    // Approve the creation
    await overlay.approve([{ path: "test/image.jpg", type: "create" }]);

    // Verify it now exists in tracking with correct content
    const trackingNode = trackingFS.findByPath("test/image.jpg");
    expect(trackingNode).toBeDefined();
    expect(getBuffer(proposedNode)).toEqual(data);
    expect(getBuffer(trackingNode)).toEqual(getBuffer(proposedNode));

    // Check vault state - binary file should be created in vault
    const vaultFile = vault.getFileByPath("test/image.jpg");
    expect(vaultFile).not.toBeNull();
    expect(await vault.readBinary(vaultFile)).toEqual(data);
  });

  it("should approve rename with synced modifications", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    // AI renames
    await overlay.rename(ideaFile, "Notes/renamed.md");

    // AI modifies renamed file
    const renamedFile = overlay.getFileByPath("Notes/renamed.md");
    await overlay.modify(renamedFile, "Hello\n\nAI line\n\nGoodbye");

    // Human edits original file in vault
    await vault.modify(ideaFile, "Hello\n\nHuman line\n\nGoodbye");
    await overlay.syncPath(ideaFile.path);

    // Renamed file contains both AI and human edits
    const renameFile = overlay.getFileByPath("Notes/renamed.md");
    const updated = await overlay.read(renameFile);
    expect(updated).toEqual("Hello\n\nHuman line\n\nAI line\n\nGoodbye");

    // user approves rename
    await overlay.approve([{ path: "Notes/renamed.md", type: "rename" }]);

    const trackingNode = overlay.trackingFS.findByPath("Notes/renamed.md");
    const proposedNode = overlay.proposedFS.findByPath("Notes/renamed.md");
    expect(trackingNode.id).toEqual(proposedNode.id);
    expect(trackingNode.data.get("name")).toEqual(
      proposedNode.data.get("name"),
    );

    const oldPathTrackingNode = overlay.trackingFS.findByPath("Notes/idea.md");
    const oldPathProposedNode = overlay.proposedFS.findByPath("Notes/idea.md");
    expect(oldPathTrackingNode).not.toBeDefined();
    expect(oldPathProposedNode).not.toBeDefined();

    // Check vault state - file should be renamed in vault
    expect(vault.getFileByPath("Notes/renamed.md")).not.toBeNull();
    expect(vault.getFileByPath("Notes/idea.md")).toBeNull();
    // Only rename was approved so contents should equal human edits
    expect(await vault.read(vault.getFileByPath("Notes/renamed.md"))).toEqual(
      "Hello\n\nHuman line\n\nGoodbye",
    );
  });

  it("should approve create folder", async () => {
    // Create folder in overlay (proposed state only)
    await overlay.createFolder("new-folder");

    // Verify it exists in proposed but not tracking before approval
    const proposedNode = proposedFS.findByPath("new-folder");
    expect(proposedNode).toBeDefined();
    expect(proposedNode.data.get("isDirectory")).toBe(true);
    expect(trackingFS.findByPath("new-folder")).toBeUndefined();

    // Approve the creation
    await overlay.approve([{ path: "new-folder", type: "create" }]);

    // Verify the untracked proposed node is deleted
    expect(proposedNode.isDeleted()).toEqual(true);

    // Verify it now exists in tracking
    const trackingNode = trackingFS.findByPath("new-folder");
    expect(trackingNode).toBeDefined();
    expect(trackingNode.data.get("isDirectory")).toBe(true);

    // Verify a new proposed matches the tracking node
    const newProposedNode = proposedFS.findByPath("new-folder");
    expect(newProposedNode).toBeDefined();
    expect(newProposedNode.id).toEqual(trackingNode.id);

    // Check vault state - folder should be created in vault
    const vaultFolder = vault.getFolderByPath("new-folder");
    expect(vaultFolder).not.toBeNull();
  });

  it("should throw error when trying to approve a folder with contents", async () => {
    // Create a folder with files in overlay
    await overlay.createFolder("test-folder");
    await overlay.create("test-folder/file1.md", "File 1 content");
    await overlay.create("test-folder/file2.md", "File 2 content");

    // Verify folder exists in proposed state
    const proposedFolderNode = proposedFS.findByPath("test-folder");
    expect(proposedFolderNode).toBeDefined();
    expect(proposedFolderNode.data.get("isDirectory")).toBe(true);

    // Try to approve folder with text override - should throw error
    await expect(
      overlay.approve([
        {
          type: "create",
          path: "test-folder",
          override: { text: "This should not work for folders" },
        },
      ]),
    ).rejects.toThrow();

    // Verify folder and files remain in proposed state (not applied to vault)
    expect(proposedFS.findByPath("test-folder")).toBeDefined();
    expect(proposedFS.findByPath("test-folder/file1.md")).toBeDefined();
    expect(proposedFS.findByPath("test-folder/file2.md")).toBeDefined();

    // Verify nothing was created in vault
    expect(vault.getFolderByPath("test-folder")).toBeNull();
    expect(vault.getFileByPath("test-folder/file1.md")).toBeNull();
    expect(vault.getFileByPath("test-folder/file2.md")).toBeNull();
  });

  it("should approve move file", async () => {
    // Create initial folder structure
    helpers.addFolder("folderA");
    helpers.addFolder("folderB");
    const testFile = helpers.addFile("folderA/test.md", "Test file content");

    // Move file from folderA to folderB (same name, different parent)
    await overlay.rename(testFile, "folderB/test.md");

    // Verify file exists in new location in proposed state
    const proposedNode = proposedFS.findByPath("folderB/test.md");
    expect(proposedNode).toBeDefined();
    expect(getText(proposedNode)).toEqual("Test file content");

    // Verify old location is no longer accessible in proposed
    expect(proposedFS.findByPath("folderA/test.md")).not.toBeDefined();

    // Approve the move operation
    await overlay.approve([{ type: "rename", path: "folderB/test.md" }]);

    // Verify file exists in new location in tracking
    const trackingNode = trackingFS.findByPath("folderB/test.md");
    expect(trackingNode).toBeDefined();
    expect(getText(trackingNode)).toEqual("Test file content");
    expect(trackingNode.id).toEqual(proposedNode.id);

    // Verify old location doesn't exist in tracking
    expect(trackingFS.findByPath("folderA/test.md")).toBeUndefined();

    // Check vault state - file should be moved in vault
    expect(vault.getFileByPath("folderB/test.md")).not.toBeNull();
    expect(vault.getFileByPath("folderA/test.md")).toBeNull();
    expect(await vault.read(vault.getFileByPath("folderB/test.md"))).toEqual(
      "Test file content",
    );

    // Verify folders still exist
    expect(vault.getFolderByPath("folderA")).not.toBeNull();
    expect(vault.getFolderByPath("folderB")).not.toBeNull();
  });

  it("should approve rename file", async () => {
    // Create a file in a specific folder
    helpers.addFolder("documents");
    const originalFile = helpers.addFile(
      "documents/original.md",
      "Original file content",
    );

    // Rename file within same folder (same parent, different name)
    await overlay.rename(originalFile, "documents/newname.md");

    // Verify file exists with new name in proposed state
    const proposedNode = proposedFS.findByPath("documents/newname.md");
    expect(proposedNode).toBeDefined();
    expect(getText(proposedNode)).toEqual("Original file content");

    // Verify old name is no longer accessible in proposed
    expect(proposedFS.findByPath("documents/original.md")).not.toBeDefined();

    // Approve the rename operation
    await overlay.approve([
      {
        type: "rename",
        path: "documents/newname.md",
      },
    ]);

    // Verify file exists with new name in tracking
    const trackingNode = trackingFS.findByPath("documents/newname.md");
    expect(trackingNode).toBeDefined();
    expect(getText(trackingNode)).toEqual("Original file content");
    expect(trackingNode.id).toEqual(proposedNode.id);

    // Verify old name doesn't exist in tracking
    expect(trackingFS.findByPath("documents/original.md")).toBeUndefined();

    // Check vault state - file should be renamed in vault
    expect(vault.getFileByPath("documents/newname.md")).not.toBeNull();
    expect(vault.getFileByPath("documents/original.md")).toBeNull();
    expect(
      await vault.read(vault.getFileByPath("documents/newname.md")),
    ).toEqual("Original file content");

    // Verify parent folder still exists and is unchanged
    expect(vault.getFolderByPath("documents")).not.toBeNull();
  });

  it("should approve move to newly created folder", async () => {
    // Setup: Create a file in an existing location
    helpers.addFolder("existing");
    const sourceFile = helpers.addFile(
      "existing/document.md",
      "Document content",
    );

    // AI operations: Create new folder and move file into it
    await overlay.createFolder("new-folder");
    await overlay.rename(sourceFile, "new-folder/document.md");

    // Verify both operations exist in proposed state
    const proposedFolder = proposedFS.findByPath("new-folder");
    const proposedFile = proposedFS.findByPath("new-folder/document.md");
    expect(proposedFolder).toBeDefined();
    expect(proposedFolder.data.get("isDirectory")).toBe(true);
    expect(proposedFile).toBeDefined();
    expect(getText(proposedFile)).toEqual("Document content");

    // Verify old location no longer accessible
    expect(proposedFS.findByPath("existing/document.md")).not.toBeDefined();

    // Verify nothing exists in tracking yet
    expect(trackingFS.findByPath("new-folder")).toBeUndefined();
    expect(trackingFS.findByPath("new-folder/document.md")).toBeUndefined();

    // Approve both operations in same batch
    await overlay.approve([
      { path: "new-folder", type: "create" },
      {
        path: "new-folder/document.md",
        type: "rename",
      },
    ]);

    // Verify both operations succeeded in tracking
    const trackingFolder = trackingFS.findByPath("new-folder");
    const trackingFile = trackingFS.findByPath("new-folder/document.md");
    expect(trackingFolder).toBeDefined();
    expect(trackingFolder.data.get("isDirectory")).toBe(true);
    expect(trackingFile).toBeDefined();
    expect(getText(trackingFile)).toEqual("Document content");

    // Verify old path doesn't exist in tracking
    expect(trackingFS.findByPath("existing/document.md")).toBeUndefined();

    // Verify vault state - both folder and file should exist
    const vaultFolder = vault.getFolderByPath("new-folder");
    const vaultFile = vault.getFileByPath("new-folder/document.md");
    expect(vaultFolder).not.toBeNull();
    expect(vaultFile).not.toBeNull();
    expect(await vault.read(vaultFile)).toEqual("Document content");

    // Verify old path doesn't exist in vault
    expect(vault.getFileByPath("existing/document.md")).toBeNull();

    // Verify source folder still exists but is empty
    expect(vault.getFolderByPath("existing")).not.toBeNull();
  });

  it("should approve move folder", async () => {
    // Create initial folder structure
    helpers.addFolder("parentA");
    helpers.addFolder("parentB");
    const childFolder = helpers.addFolder("parentA/childFolder");
    helpers.addFile("parentA/childFolder/test.md", "Test content");

    // Move folder to different parent
    await overlay.rename(childFolder, "parentB/childFolder");

    // Approve the move operation
    await overlay.approve([
      {
        type: "rename",
        path: "parentB/childFolder",
      },
    ]);

    // Verify folder was moved in vault
    expect(vault.getFolderByPath("parentB/childFolder")).not.toBeNull();
    expect(vault.getFolderByPath("parentA/childFolder")).toBeNull();
    expect(vault.getFileByPath("parentB/childFolder/test.md")).not.toBeNull();
    expect(
      await vault.read(vault.getFileByPath("parentB/childFolder/test.md")),
    ).toEqual("Test content");
  });

  it("should approve rename folder", async () => {
    // Create folder with content
    helpers.addFolder("projects");
    const oldFolder = helpers.addFolder("projects/oldname");
    helpers.addFile("projects/oldname/file.md", "File content");

    // Rename folder within same parent
    await overlay.rename(oldFolder, "projects/newname");

    // Approve the rename operation
    await overlay.approve([{ type: "rename", path: "projects/newname" }]);

    // Verify folder was renamed in vault
    expect(vault.getFolderByPath("projects/newname")).not.toBeNull();
    expect(vault.getFolderByPath("projects/oldname")).toBeNull();
    expect(vault.getFileByPath("projects/newname/file.md")).not.toBeNull();
    expect(
      await vault.read(vault.getFileByPath("projects/newname/file.md")),
    ).toEqual("File content");

    // Verify parent folder unchanged
    expect(vault.getFolderByPath("projects")).not.toBeNull();
  });

  it("should not require rename or modify approval when file was created in overlay", async () => {
    // Setup: Create folder for operations
    helpers.addFolder("docs");

    // AI operations: All applied to the same file through its lifecycle
    // 1. Create a new file
    await overlay.create("docs/lifecycle.md", "Initial content");

    // 2. Rename the created file
    const createdFile = overlay.getFileByPath("docs/lifecycle.md");
    await overlay.rename(createdFile, "docs/renamed-lifecycle.md");

    // 3. Modify the renamed file
    const renamedFile = overlay.getFileByPath("docs/renamed-lifecycle.md");
    await overlay.modify(renamedFile, "Modified content after rename");

    // Verify all operations exist in proposed state for the same file
    const renamedNode = proposedFS.findByPath("docs/renamed-lifecycle.md");

    expect(renamedNode).toBeDefined();
    expect(getText(renamedNode)).toEqual("Modified content after rename");

    // Verify original path no longer accessible
    expect(proposedFS.findByPath("docs/lifecycle.md")).not.toBeDefined();

    // Approve all operations in same batch
    await overlay.approve([
      { path: "docs/renamed-lifecycle.md", type: "create" },
    ]);

    // Verify final state in tracking - file should exist with final content
    const trackingFile = trackingFS.findByPath("docs/renamed-lifecycle.md");
    expect(trackingFile).toBeDefined();
    expect(getText(trackingFile)).toEqual("Modified content after rename");

    const proposedFile = proposedFS.findByPath("docs/renamed-lifecycle.md");
    expect(trackingFile.id).toEqual(proposedFile.id);

    // Verify original path doesn't exist in tracking
    expect(trackingFS.findByPath("docs/lifecycle.md")).toBeUndefined();

    // Verify vault state - file should exist at final location with final content
    const vaultOriginal = vault.getFileByPath("docs/lifecycle.md");
    const vaultRenamed = vault.getFileByPath("docs/renamed-lifecycle.md");

    expect(vaultOriginal).toBeNull();
    expect(vaultRenamed).not.toBeNull();
    expect(await vault.read(vaultRenamed)).toEqual(
      "Modified content after rename",
    );

    // Verify parent folder still exists
    expect(vault.getFolderByPath("docs")).not.toBeNull();
  });

  describe("Given an existing file was modified then renamed", () => {
    let proposedNode: LoroTreeNode;

    beforeEach(async () => {
      helpers.addFolder("notes");
      const originalFile = helpers.addFile(
        "notes/report.md",
        "Original content",
      );

      // AI operations: rename then modify the existing file
      await overlay.rename(originalFile, "notes/renamed-report.md");
      const renamedFile = overlay.getFileByPath("notes/renamed-report.md");
      await overlay.modify(renamedFile, "Modified content");

      // Verify both operations exist in proposed state
      proposedNode = proposedFS.findByPath("notes/renamed-report.md");
      expect(proposedNode).toBeDefined();
      expect(getText(proposedNode)).toEqual("Modified content");

      // Verify old name is no longer accessible in proposed
      expect(proposedFS.findByPath("notes/report.md")).not.toBeDefined();
    });

    describe("When rename is approved before modify", () => {
      it("Then should rename the file and modify the contents at the new path", async () => {
        // Approve rename before modify
        await overlay.approve([
          {
            type: "rename",
            path: "notes/renamed-report.md",
          },
          { type: "modify", path: "notes/renamed-report.md" },
        ]);

        // Verify both operations succeeded in tracking
        const trackingNodeFinal = trackingFS.findByPath(
          "notes/renamed-report.md",
        );
        expect(trackingNodeFinal).toBeDefined();
        expect(getText(trackingNodeFinal)).toEqual("Modified content");
        expect(trackingNodeFinal.id).toEqual(proposedNode.id);

        // Verify old name doesn't exist in tracking
        expect(trackingFS.findByPath("notes/report.md")).toBeUndefined();

        // Check vault state - file should be renamed and modified in vault
        expect(vault.getFileByPath("notes/renamed-report.md")).not.toBeNull();
        expect(vault.getFileByPath("notes/report.md")).toBeNull();
        expect(
          await vault.read(vault.getFileByPath("notes/renamed-report.md")),
        ).toEqual("Modified content");

        // Verify parent folder still exists and is unchanged
        expect(vault.getFolderByPath("notes")).not.toBeNull();
      });
    });

    describe("When modify is approved before renamed", () => {
      it("Then should rename the file and modify the contents at the new path", async () => {
        // Approve modify before renamed
        await overlay.approve([
          { type: "modify", path: "notes/renamed-report.md" },
          {
            type: "rename",
            path: "notes/renamed-report.md",
          },
        ]);

        // Verify both operations succeeded in tracking
        const trackingNodeFinal = trackingFS.findByPath(
          "notes/renamed-report.md",
        );
        expect(trackingNodeFinal).toBeDefined();
        expect(getText(trackingNodeFinal)).toEqual("Modified content");
        expect(trackingNodeFinal.id).toEqual(proposedNode.id);

        // Verify old name doesn't exist in tracking
        expect(trackingFS.findByPath("notes/report.md")).toBeUndefined();

        // Check vault state - file should be renamed and modified in vault
        expect(vault.getFileByPath("notes/renamed-report.md")).not.toBeNull();
        expect(vault.getFileByPath("notes/report.md")).toBeNull();
        expect(
          await vault.read(vault.getFileByPath("notes/renamed-report.md")),
        ).toEqual("Modified content");

        // Verify parent folder still exists and is unchanged
        expect(vault.getFolderByPath("notes")).not.toBeNull();
      });
    });

    describe("When only the modify is approved, not the rename", () => {
      it("Then should modify the file at the original path", async () => {
        // Approve modify only
        await overlay.approve([
          { type: "modify", path: "notes/renamed-report.md" },
        ]);

        // Verify contents were modified and was not renamed
        const trackingNodeFinal = trackingFS.findByPath("notes/report.md");
        expect(trackingNodeFinal).toBeDefined();
        expect(getText(trackingNodeFinal)).toEqual("Modified content");
        expect(trackingNodeFinal.id).toEqual(proposedNode.id);

        // Verify rename not applied to tracking yet
        expect(
          trackingFS.findByPath("notes/renamed-report.md"),
        ).toBeUndefined();

        // Check vault state - file be modified not renamed
        expect(vault.getFileByPath("notes/renamed-report.md")).toBeNull();
        expect(vault.getFileByPath("notes/report.md")).not.toBeNull();
        expect(
          await vault.read(vault.getFileByPath("notes/report.md")),
        ).toEqual("Modified content");

        // Verify parent folder still exists and is unchanged
        expect(vault.getFolderByPath("notes")).not.toBeNull();
      });
    });

    describe("When only the renamed is approved, not the modify", () => {
      it("Then should rename the file without modifying the contents", async () => {
        // Approve modify only
        await overlay.approve([
          {
            type: "rename",
            path: "notes/renamed-report.md",
          },
        ]);

        // Verify both operations succeeded in tracking
        const trackingNodeFinal = trackingFS.findByPath(
          "notes/renamed-report.md",
        );
        expect(trackingNodeFinal).toBeDefined();
        expect(getText(trackingNodeFinal)).toEqual("Original content");
        expect(trackingNodeFinal.id).toEqual(proposedNode.id);

        // Verify old name doesn't exist in tracking
        expect(trackingFS.findByPath("notes/report.md")).toBeUndefined();

        // Check vault state - file should be renamed and modified in vault
        expect(vault.getFileByPath("notes/renamed-report.md")).not.toBeNull();
        expect(vault.getFileByPath("notes/report.md")).toBeNull();
        expect(
          await vault.read(vault.getFileByPath("notes/renamed-report.md")),
        ).toEqual("Original content");

        // Verify parent folder still exists and is unchanged
        expect(vault.getFolderByPath("notes")).not.toBeNull();
      });
    });
  });

  it("when rename and delete, delete approve must use original path", async () => {
    // Setup: Create file in vault that is tracked
    helpers.addFolder("documents");
    const originalFile = helpers.addFile(
      "documents/temp-doc.md",
      "Temporary document content",
    );

    // AI operations: rename then delete the existing file
    await overlay.rename(originalFile, "documents/renamed-temp.md");
    const renamedFile = overlay.getFileByPath("documents/renamed-temp.md");
    await overlay.delete(renamedFile);

    // Verify rename is not proposed
    expect(
      proposedFS.findByPath("documents/renamed-temp.md"),
    ).not.toBeDefined();

    // Verify file is marked as deleted under original name
    const deletedNode = proposedFS.findTrashed("documents/temp-doc.md");
    expect(deletedNode).toBeDefined();
    expect(deletedNode.data.get("deletedFrom")).toEqual(
      "documents/temp-doc.md",
    );

    // Approve only the delete operation - rename becomes irrelevant once file is deleted
    await overlay.approve([{ type: "delete", path: "documents/temp-doc.md" }]);

    // Verify file is deleted in tracking
    const trackingNodeFinal = trackingFS.findByPath("documents/temp-doc.md");
    expect(trackingNodeFinal).toBeUndefined();

    // Verify deleted node is marked as deleted in tracking
    const trackingDeletedNode = trackingFS.findById(deletedNode.id);
    expect(trackingDeletedNode.isDeleted()).toBe(true);

    // Check vault state - file should be deleted
    expect(vault.getFileByPath("documents/temp-doc.md")).toBeNull();

    // Verify parent folder still exists
    expect(vault.getFolderByPath("documents")).not.toBeNull();
  });

  it("when modify and delete, delete approve must use original path", async () => {
    // Setup: Create file in vault that is tracked
    helpers.addFolder("documents");
    const originalFile = helpers.addFile(
      "documents/temp-doc.md",
      "Original content",
    );

    // AI operations: rename then delete the existing file
    await overlay.modify(originalFile, "Modified content");
    await overlay.delete(originalFile);

    // Expect file is marked as deleted
    const deletedNode = proposedFS.findTrashed("documents/temp-doc.md");
    expect(deletedNode).toBeDefined();
    expect(deletedNode.data.get("deletedFrom")).toEqual(
      "documents/temp-doc.md",
    );
    // Expect file text is not modified
    expect(getText(deletedNode)).toEqual("Original content");

    // Approve only the delete operation - rename becomes irrelevant once file is deleted
    await overlay.approve([{ type: "delete", path: "documents/temp-doc.md" }]);

    // Verify file is deleted in tracking
    const trackingNodeFinal = trackingFS.findByPath("documents/temp-doc.md");
    expect(trackingNodeFinal).toBeUndefined();

    // Verify deleted node is marked as deleted in tracking
    const trackingDeletedNode = trackingFS.findById(deletedNode.id);
    expect(trackingDeletedNode.isDeleted()).toBe(true);

    // Check vault state - file should be deleted
    expect(vault.getFileByPath("documents/temp-doc.md")).toBeNull();

    // Verify parent folder still exists
    expect(vault.getFolderByPath("documents")).not.toBeNull();
  });

  it("should throw error when approving non-existent path", async () => {
    await expect(
      overlay.approve([{ path: "completely/bogus/path.md", type: "modify" }]),
    ).rejects.toThrow(
      "Cannot approve modify, no proposal found for: completely/bogus/path.md",
    );
  });

  it("should throw error when approving with invalid operation type", async () => {
    // Setup: Ensure a file exists so path checks don't fail before type check
    await overlay.create("file-for-invalid-op-type.md", "Initial content");

    const approvalWithInvalidType = {
      path: "file-for-invalid-op-type.md",
      type: "publishDocument", // An example of an invalid type
    } as any; // Cast to 'any' to allow the invalid 'type' for testing purposes

    // Action & Assertion: Expect 'approve' to throw an error
    await expect(overlay.approve([approvalWithInvalidType])).rejects.toThrow(
      'Unrecognized operation type: {"path":"file-for-invalid-op-type.md","type":"publishDocument"}',
    );
  });

  it("should throw error when approving modify on deleted file", async () => {
    // Setup: Create a file, then propose its deletion
    const filePath = "file-to-delete-then-modify.md";
    helpers.addFile(filePath, "Original content");
    const file = overlay.getFileByPath(filePath);
    if (!file)
      throw new Error(
        `Test setup failed: ${filePath} not found in overlay initially`,
      );

    await overlay.modify(file, "Modified content");
    await overlay.delete(file);

    // Verify it's in proposed trash
    const trashedNode = proposedFS.findTrashed(filePath);
    expect(trashedNode).toBeDefined();
    if (trashedNode) {
      // Check if trashedNode is defined before accessing its properties
      expect(trashedNode.data.get("deletedFrom")).toEqual(filePath);
    } else {
      throw new Error(
        `Test setup failed: ${filePath} not found in trash after deletion`,
      );
    }

    // Action & Assertion: Attempt to approve a 'modify' on the deleted file's original path
    await expect(
      overlay.approve([
        {
          path: filePath,
          type: "modify",
          override: { text: "This modification should fail" },
        },
      ]),
    ).rejects.toThrow(
      `Cannot approve modify, file was deleted: file-to-delete-then-modify.md`,
    );
  });

  it("should throw error when approving rename on deleted file", async () => {
    // Setup: Create a file, then propose its deletion
    const path = "folder/original-name.md";
    helpers.addFile(path, "Original content");
    const file = overlay.getFileByPath(path);
    if (!file)
      throw new Error(
        `Test setup failed: ${path} not found in overlay initially`,
      );

    await overlay.rename(file, "new-folder/new-name.md");
    const renamedFile = overlay.getFileByPath("new-folder/new-name.md");
    await overlay.delete(renamedFile);

    // Verify it's in proposed trash
    const trashedNode = proposedFS.findTrashed(path);
    expect(trashedNode).toBeDefined();
    expect(trashedNode.data.get("deletedFrom")).toEqual(path);

    // Action & Assertion: Attempt to approve a 'rename' on the deleted file's original path
    await expect(
      overlay.approve([
        {
          type: "rename",
          path: "new-folder/new-name.md",
        },
      ]),
    ).rejects.toThrow(
      `Cannot approve rename, no proposal found for: new-folder/new-name.md`,
    );

    await expect(
      overlay.approve([
        {
          type: "rename",
          path,
        },
      ]),
    ).rejects.toThrow(
      `Cannot approve rename, file was deleted: folder/original-name.md`,
    );
  });

  it("should approve nested folder creation", async () => {
    const nestedFilePath = "alpha/beta/gamma/delta-file.md";
    const nestedFileContent = "This file is nested deeply.";

    await overlay.create(nestedFilePath, nestedFileContent);

    // Action: Approve the creation of the file in a nested structure
    await overlay.approve([
      {
        path: nestedFilePath,
        type: "create" as "create",
        override: { text: nestedFileContent },
      },
    ]);

    // Assertions for vault state
    expect(vault.getAbstractFileByPath("alpha")).toBeInstanceOf(TFolder); // Assumes TFolder is imported
    expect(vault.getAbstractFileByPath("alpha/beta")).toBeInstanceOf(TFolder);
    expect(vault.getAbstractFileByPath("alpha/beta/gamma")).toBeInstanceOf(
      TFolder,
    );
    const vaultFile = vault.getFileByPath(nestedFilePath);
    expect(vaultFile).toBeInstanceOf(TFile); // Assumes TFile is imported
    if (vaultFile) {
      // Type guard for vault.read
      expect(await vault.read(vaultFile)).toEqual(nestedFileContent);
    }

    // Assertions for trackingFS
    expect(trackingFS.findByPath("alpha")).toBeDefined();
    expect(trackingFS.findByPath("alpha/beta")).toBeDefined();
    expect(trackingFS.findByPath("alpha/beta/gamma")).toBeDefined();
    const trackingNode = trackingFS.findByPath(nestedFilePath);
    expect(trackingNode).toBeDefined();
    expect(getText(trackingNode!)).toEqual(nestedFileContent);

    // Assertions for proposedFS (after sync)
    expect(proposedFS.findByPath("alpha")).toBeDefined();
    expect(proposedFS.findByPath("alpha/beta")).toBeDefined();
    expect(proposedFS.findByPath("alpha/beta/gamma")).toBeDefined();
    const proposedNode = proposedFS.findByPath(nestedFilePath);
    expect(proposedNode).toBeDefined();
    expect(getText(proposedNode!)).toEqual(nestedFileContent);
  });

  it("should approve move binary file");

  it("should approve rename binary file", async () => {
    const folderPath = "binary-files-folder-for-rename";
    const originalName = "my-image.png";
    const newName = "my-image-renamed.png";
    const originalPath = `${folderPath}/${originalName}`;
    const renamedPath = `${folderPath}/${newName}`;
    const binaryContent = "fake-binary-data-for-image-rename.png";

    // Setup: Create and approve an initial 'binary' file
    await overlay.create(originalPath, binaryContent);
    await overlay.approve([
      {
        type: "create" as "create",
        path: originalPath,
        override: { text: binaryContent },
      },
    ]);

    // Verify initial state
    const initialVaultFile = vault.getFileByPath(originalPath);
    expect(initialVaultFile).toBeInstanceOf(TFile); // Assumes TFile is imported
    if (initialVaultFile) {
      expect(await vault.read(initialVaultFile)).toEqual(binaryContent);
    }
    expect(getText(trackingFS.findByPath(originalPath)!)).toEqual(
      binaryContent,
    );
    expect(getText(proposedFS.findByPath(originalPath)!)).toEqual(
      binaryContent,
    );

    // Propose the rename
    const fileToRename = overlay.getFileByPath(originalPath);
    if (!fileToRename)
      throw new Error(
        `Test setup failed: ${originalPath} not found before rename`,
      );
    await overlay.rename(fileToRename, renamedPath);

    // Action: Approve the rename
    await overlay.approve([{ type: "rename" as "rename", path: renamedPath }]);

    // Assertions for vault state
    expect(vault.getFileByPath(originalPath)).toBeNull();
    const renamedVaultFile = vault.getFileByPath(renamedPath);
    expect(renamedVaultFile).toBeInstanceOf(TFile);
    if (renamedVaultFile) {
      expect(await vault.read(renamedVaultFile)).toEqual(binaryContent);
    }
    expect(vault.getAbstractFileByPath(folderPath)).toBeInstanceOf(TFolder); // Assumes TFolder is imported

    // Assertions for trackingFS
    expect(trackingFS.findByPath(originalPath)).toBeUndefined();
    const trackingNodeNew = trackingFS.findByPath(renamedPath);
    expect(trackingNodeNew).toBeDefined();
    expect(trackingNodeNew.data.get("isDirectory")).toBe(undefined);
    expect(getText(trackingNodeNew!)).toEqual(binaryContent);

    // Assertions for proposedFS (after sync)
    expect(proposedFS.findByPath(originalPath)).toBeUndefined();
    const proposedNodeNew = proposedFS.findByPath(renamedPath);
    expect(proposedNodeNew).toBeDefined();
    expect(proposedNodeNew.data.get("isDirectory")).toBe(undefined);
    expect(getText(proposedNodeNew!)).toEqual(binaryContent);
  });

  it("should throw error when approving operation on non-existent proposed file", async () => {
    // Test approving a path that was never modified in overlay

    // Add a file to vault but don't modify it in overlay
    helpers.addFile("existing-in-vault.md", "Vault content");

    // Test approving modify on path that exists in vault but not in overlay
    await expect(
      overlay.approve([{ path: "existing-in-vault.md", type: "modify" }]),
    ).rejects.toThrow(
      "Cannot approve modify, no proposal found for: existing-in-vault.md",
    );

    // Test approving delete on path that exists in vault but not in overlay
    await expect(
      overlay.approve([{ path: "existing-in-vault.md", type: "delete" }]),
    ).rejects.toThrow(
      "Cannot approve delete, no proposal found for: existing-in-vault.md",
    );

    // Test approving rename on path that exists in vault but not in overlay
    await expect(
      overlay.approve([
        {
          path: "new-name.md",
          type: "rename",
        },
      ]),
    ).rejects.toThrow(
      "Cannot approve rename, no proposal found for: new-name.md",
    );

    // Test approving operation on completely non-existent path
    await expect(
      overlay.approve([{ path: "never-existed.md", type: "modify" }]),
    ).rejects.toThrow(
      "Cannot approve modify, no proposal found for: never-existed.md",
    );

    // Test approving create on non-existent path (should also fail since create needs proposed node)
    await expect(
      overlay.approve([{ path: "never-created.md", type: "create" }]),
    ).rejects.toThrow(
      "Cannot approve create, no proposal found for: never-created.md",
    );
  });
});
