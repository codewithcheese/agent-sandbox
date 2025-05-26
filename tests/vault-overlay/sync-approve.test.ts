import { beforeEach, describe, expect, it } from "vitest";
import { LoroText, LoroTreeNode } from "loro-crdt";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";

function text(node: LoroTreeNode) {
  return (node.data.get("text") as LoroText).toString();
}

describe("VaultOverlay sync & approve", () => {
  let overlay: VaultOverlay;

  beforeEach(() => {
    overlay = new VaultOverlay(vault);
  });

  it("accepts an AI modified file and keeps other AI changes in-tact", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello");

    await overlay.modify(ideaFile, "Hello\n\nAI line");

    await overlay.create("Notes/draft.md", "Work in progress");

    const approvedText = "Hello\n\nAI line\n\nApproved";
    overlay.approveModify("Notes/idea.md", approvedText);

    const trackingText = (
      overlay.findNode("tracking", "Notes/idea.md").data.get("text") as LoroText
    ).toString();
    expect(trackingText).toBe(approvedText);

    const proposedText = (
      overlay.findNode("proposed", "Notes/idea.md").data.get("text") as LoroText
    ).toString();
    expect(proposedText).toBe(approvedText);

    const draftNode = overlay.findNode("proposed", "Notes/draft.md");
    expect(draftNode).toBeDefined();
    const draftText = (draftNode.data.get("text") as LoroText).toString();
    expect(draftText).toBe("Work in progress");
  });

  it("accepts an AI created file", async () => {
    await overlay.create("Notes/draft.md", "Draft from AI");

    overlay.approveModify("Notes/draft.md", "Draft approved by Human");

    const proposedNode = overlay.findNode("proposed", "Notes/draft.md");
    expect(text(proposedNode)).not.toContain("Draft from AI");
    expect(text(proposedNode)).toEqual("Draft approved by Human");

    const trackingNode = overlay.findNode("tracking", "Notes/draft.md");
    expect(text(trackingNode)).not.toContain("Draft from AI");
    expect(text(trackingNode)).toEqual("Draft approved by Human");
  });

  it("syncs vault edits into proposed without losing AI edits", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    // AI edits
    await overlay.modify(ideaFile, "Hello\n\nAI line\n\nGoodbye");

    // human edits same file in vault and syncs
    await vault.modify(ideaFile, "Hello\n\nHuman line\n\nGoodbye");
    await overlay.syncPath("Notes/idea.md");

    /* assertions */
    const mergedText = (
      overlay.findNode("proposed", "Notes/idea.md").data.get("text") as LoroText
    ).toString();

    expect(mergedText).toEqual("Hello\n\nHuman line\n\nAI line\n\nGoodbye");
  });

  /* ───────── delete ───────── */

  it("accepts an AI delete", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    await overlay.delete(ideaFile);

    // expect path is tracked before delete is accepted
    const trackingNode = overlay.findNode("tracking", "Notes/idea.md");
    expect(trackingNode.isDeleted()).toEqual(false);
    expect(trackingNode).toBeDefined();
    // expect proposed node is marked as deleted
    const proposedNode = overlay.findNodeById("proposed", trackingNode.id);
    expect(proposedNode).toBeDefined();
    expect(proposedNode.isDeleted()).toEqual(false);
    expect(proposedNode.data.get("deletedFrom")).toEqual("Notes/idea.md");

    // user approves deletion
    overlay.approveDelete("Notes/idea.md");

    // expect path is no longer tracked
    expect(overlay.findNode("tracking", "Notes/idea.md")).not.toBeDefined();
    expect(trackingNode.isDeleted()).toEqual(true);
    expect(overlay.findNode("proposed", "Notes/idea.md")).not.toBeDefined();
    expect(trackingNode.isDeleted()).toEqual(true);
  });

  // todo: preferred behaviour may to be retain proposed edits, and treat the staged file as a create
  it("merges vault delete into proposed, losing AI edits", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    await overlay.modify(ideaFile, "Hello\n\nAI line\n\nGoodbye");

    await overlay.syncDelete("Notes/idea.md");

    const trackingNode = overlay.findNode("tracking", "Notes/idea.md");
    const proposedNode = overlay.findDeletedNode("Notes/idea.md");
    expect(trackingNode).not.toBeDefined();
    expect(proposedNode).not.toBeDefined();
  });

  it("user accepts an AI rename without losing vault edits", async () => {
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

    // user approves rename and contents
    overlay.approveRename(ideaFile.path, renameFile.path);
    // todo: test approve modify before and after rename

    const trackingNode = overlay.findNode("tracking", "Notes/renamed.md");
    const proposedNode = overlay.findNode("proposed", "Notes/renamed.md");
    expect(trackingNode.id).toEqual(proposedNode.id);
    expect(trackingNode.data.get("name")).toEqual(
      proposedNode.data.get("name"),
    );

    const oldPathTrackingNode = overlay.findNode("tracking", "Notes/idea.md");
    const oldPathProposedNode = overlay.findNode("proposed", "Nodes/idea.md");
    expect(oldPathTrackingNode).not.toBeDefined();
    expect(oldPathProposedNode).not.toBeDefined();
  });

  it("should handle syncPath for files with large content", async () => {
    // Create large file in vault
    const largeContent = "x".repeat(60000);
    vault.create("large-vault-file.md", largeContent);

    await overlay.syncPath("large-vault-file.md");

    const file = overlay.getFileByPath("large-vault-file.md");
    const content = await overlay.read(file);
    expect(content).toBe(largeContent);
  });

  it("should handle syncPath for folders", async () => {
    // Create folder in vault
    await vault.createFolder("vault-folder");

    await overlay.syncPath("vault-folder");

    const folder = overlay.getFolderByPath("vault-folder");
    expect(folder).toBeTruthy();
  });

  it("should throw error for invalid file types in syncPath", async () => {
    // Mock an invalid file type
    const originalGetAbstractFileByPath = vault.getAbstractFileByPath;
    vault.getAbstractFileByPath = () => ({ path: "invalid" }) as any;

    await expect(overlay.syncPath("invalid")).rejects.toThrow(
      "invalid is not a file or folder",
    );

    // Restore original method
    vault.getAbstractFileByPath = originalGetAbstractFileByPath;
  });

  it("should update existing tracking node text during syncPath", async () => {
    // Create file in tracking with different content
    overlay.createTextFile("tracking", "test.md", "old content");

    // Create same file in vault with new content
    vault.create("test.md", "new content");

    await overlay.syncPath("test.md");

    // Verify tracking was updated
    const trackingNode = overlay.findNode("tracking", "test.md");
    const text = trackingNode.data.get("text").toString();
    expect(text).toBe("new content");
  });

  describe("Approve Modify Validation", () => {
    it("should throw error when trying to approve modify on a directory with contents", () => {
      // Create a directory in proposed
      overlay.createNode("proposed", "test-folder", { isDirectory: true });

      // Try to approve modify on the directory with contents - should throw error
      expect(() => {
        overlay.approveModify("test-folder", "some content");
      }).toThrow(
        "Cannot approve modify to folder when contents are provided: test-folder",
      );
    });

    it("should create tracking node for directory when it doesn't exist", () => {
      // Create a directory in proposed only (no tracking node)
      overlay.createNode("proposed", "new-folder", { isDirectory: true });

      // Verify no tracking node exists yet
      expect(overlay.findNode("tracking", "new-folder")).toBeUndefined();

      // Approve modify should create the tracking node as a directory
      overlay.approveModify("new-folder");

      // Verify tracking node was created as a directory
      const trackingNode = overlay.findNode("tracking", "new-folder");
      expect(trackingNode).toBeTruthy();
      expect(trackingNode.data.get("isDirectory")).toBe(true);
    });
  });
});
