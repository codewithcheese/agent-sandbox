import { beforeEach, describe, expect, it } from "vitest";
import { LoroText, LoroTreeNode } from "loro-crdt/base64";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";

describe("Sync", () => {
  let overlay: VaultOverlay;

  beforeEach(() => {
    overlay = new VaultOverlay(vault);
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
      overlay.proposedFS
        .findByPath("Notes/idea.md")
        .data.get("text") as LoroText
    ).toString();

    expect(mergedText).toEqual("Hello\n\nHuman line\n\nAI line\n\nGoodbye");
  });

  // note: preferred behaviour may to be retain proposed edits, and treat the staged file as a create
  it("merges vault delete into proposed, losing AI edits", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    await overlay.modify(ideaFile, "Hello\n\nAI line\n\nGoodbye");

    const trackingNode = overlay.trackingFS.findByPath("Notes/idea.md");
    await overlay.syncDelete("Notes/idea.md");

    const proposedNode = overlay.proposedFS.findById(trackingNode.id);
    expect(trackingNode.isDeleted()).toEqual(true);
    expect(proposedNode.isDeleted()).toEqual(true);
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
    overlay.trackingFS.createNode("test.md", { text: "old content" });

    // Create same file in vault with new content
    await vault.create("test.md", "new content");

    await overlay.syncPath("test.md");

    // Verify tracking was updated
    const trackingNode = overlay.trackingFS.findByPath("test.md");
    const text = trackingNode.data.get("text").toString();
    expect(text).toBe("new content");
  });
});
