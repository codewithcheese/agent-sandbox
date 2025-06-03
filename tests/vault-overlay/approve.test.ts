import { beforeEach, describe, expect, it } from "vitest";
import { VaultOverlaySvelte } from "../../src/chat/vault-overlay.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import type { TreeFS } from "../../src/chat/tree-fs.ts";
import { getBuffer, getText } from "$lib/utils/loro.ts";

describe("Approve changes", () => {
  let overlay: VaultOverlaySvelte;
  let proposedFS: TreeFS;
  let trackingFS: TreeFS;

  beforeEach(() => {
    overlay = new VaultOverlaySvelte(vault);
    proposedFS = overlay.proposedFS;
    trackingFS = overlay.trackingFS;
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

    const aProposedNode = proposedFS.findDeleted("alpha.md");
    const bProposedNode = proposedFS.findByPath("beta.md");
    const gProposedNode = proposedFS.findDeleted("gamma.md");

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

    // Get folder reference and delete it
    const folder = overlay.getFolderByPath("documents");
    await overlay.delete(folder);
    await overlay.modify(file1, "Modified content 1");

    // Get the deleted folder node ID and approve
    const deletedFolderNode = proposedFS.findDeleted("documents");
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
    const docsDeletedNode = proposedFS.findDeleted("docs");
    const tempDeletedNode = proposedFS.findDeleted("temp");

    overlay.approve([{ id: docsDeletedNode.id }, { id: tempDeletedNode.id }]);

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
    expect(text(projectTrackingNode)).toBe("Main project"); // Original content

    // Check proposed state
    expect(
      proposedFS.findById(docsDeletedNode.id).data.get("deletedFrom"),
    ).toEqual("docs");
    expect(
      proposedFS.findById(tempDeletedNode.id).data.get("deletedFrom"),
    ).toEqual("temp");
    expect(proposedFS.findDeleted("archive").isDeleted()).toEqual(false);
    expect(proposedFS.findByPath("projects/main.js")).toBeDefined(); // Still exists in proposed
  });

  it("should approve create file", async () => {
    // Create file in overlay (proposed state only)
    await overlay.create("new-document.md", "Initial content");

    // Verify it exists in proposed but not tracking before approval
    const proposedNode = proposedFS.findByPath("new-document.md");
    expect(proposedNode).toBeDefined();
    expect(text(proposedNode)).toEqual("Initial content");
    expect(trackingFS.findByPath("new-document.md")).toBeUndefined();

    // Approve the creation
    overlay.approve([{ id: proposedNode.id }]);

    // Verify it now exists in tracking with correct content
    const trackingNode = trackingFS.findByPath("new-document.md");
    expect(trackingNode).toBeDefined();
    expect(text(trackingNode)).toEqual("Initial content");
    expect(text(trackingNode)).toEqual(text(proposedNode));
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
    overlay.approve([{ id: proposedNode.id }]);

    // Verify it now exists in tracking with correct content
    const trackingNode = trackingFS.findByPath("test/image.jpg");
    expect(trackingNode).toBeDefined();
    expect(getBuffer(proposedNode)).toEqual(data);
    expect(getBuffer(trackingNode)).toEqual(getBuffer(proposedNode));
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
    const pNode = overlay.proposedFS.findByPath("Notes/renamed.md");
    overlay.approve([{ id: pNode.id }]);

    const trackingNode = overlay.trackingFS.findByPath("Notes/renamed.md");
    const proposedNode = overlay.proposedFS.findByPath("Notes/renamed.md");
    expect(trackingNode.id).toEqual(proposedNode.id);
    expect(trackingNode.data.get("name")).toEqual(
      proposedNode.data.get("name"),
    );

    const oldPathTrackingNode = overlay.trackingFS.findByPath("Notes/idea.md");
    const oldPathProposedNode = overlay.proposedFS.findByPath("Nodes/idea.md");
    expect(oldPathTrackingNode).not.toBeDefined();
    expect(oldPathProposedNode).not.toBeDefined();
  });

  it("should approve create folder");

  it("should throw error when trying to approve a folder with contents", () => {});

  it("should approve move file", () => {});

  it("should approve rename file", () => {});

  it("should approve move folder", () => {});

  it("should approve rename folder", () => {});

  it("should approve created, renamed, modified, deleted");

  it("should approve created, renamed, modified");

  it("should approve created, renamed");

  it("should approve renamed, modified, deleted");

  it("should approve renamed, modified");

  it("should approve modified, deleted");
});
