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
    console.log("Tracking node:", trackingNode.id);
    const proposedNode = overlay.findNodeById("proposed", trackingNode.id);
    console.log("Proposed node:", trackingNode.id);
    expect(trackingNode).toBeDefined();
    // expect proposed node is marked as deleted
    expect(proposedNode).toBeDefined();
    expect(proposedNode.data.get("deletedFrom")).toEqual("Notes/idea.md");

    // user approves deletion
    overlay.approveDelete("Notes/idea.md");

    console.log(
      "Tracking node:",
      overlay.findNode("proposed", "Notes/idea.md").id,
    );
    // expect path is no longer tracked
    expect(overlay.findNodeById("tracking", proposedNode.id)).not.toBeDefined();
    expect(overlay.findNodeById("proposed", proposedNode.id)).not.toBeDefined();
    expect(overlay.findDeletedNode("Notes/idea.md")).not.toBeDefined();
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
});
