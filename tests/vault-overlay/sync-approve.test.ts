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

    const masterText = (
      overlay.findNode("master", "Notes/idea.md").data.get("text") as LoroText
    ).toString();
    expect(masterText).toBe(approvedText);

    const stagingText = (
      overlay.findNode("staging", "Notes/idea.md").data.get("text") as LoroText
    ).toString();
    expect(stagingText).toBe(approvedText);

    const draftNode = overlay.findNode("staging", "Notes/draft.md");
    expect(draftNode).toBeDefined();
    const draftText = (draftNode.data.get("text") as LoroText).toString();
    expect(draftText).toBe("Work in progress");
  });

  it("accepts an AI created file", async () => {
    await overlay.create("Notes/draft.md", "Draft from AI");

    overlay.approveModify("Notes/draft.md", "Draft approved by Human");

    const stagingNode = overlay.findNode("staging", "Notes/draft.md");
    expect(text(stagingNode)).not.toContain("Draft from AI");
    expect(text(stagingNode)).toEqual("Draft approved by Human");

    const masterNode = overlay.findNode("master", "Notes/draft.md");
    expect(text(masterNode)).not.toContain("Draft from AI");
    expect(text(masterNode)).toEqual("Draft approved by Human");
  });

  it("syncs vault edits into staging without losing AI edits", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    // AI edits
    await overlay.modify(ideaFile, "Hello\n\nAI line\n\nGoodbye");

    // human edits same file in vault and syncs
    await vault.modify(ideaFile, "Hello\n\nHuman line\n\nGoodbye");
    await overlay.syncPath("Notes/idea.md");

    /* assertions */
    const mergedText = (
      overlay.findNode("staging", "Notes/idea.md").data.get("text") as LoroText
    ).toString();

    expect(mergedText).toEqual("Hello\n\nHuman line\n\nAI line\n\nGoodbye");
  });

  /* ───────── delete ───────── */

  it("accepts an AI delete", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    await overlay.delete(ideaFile);

    // expect path is tracked before delete is accepted
    const masterNode = overlay.findNode("master", "Notes/idea.md");
    const stagingNode = overlay.findNode("staging", "Notes/idea.md");
    expect(masterNode).toBeDefined();
    // expect staging node is marked as deleted
    expect(stagingNode.data.get("isDeleted")).toEqual(true);
    expect(stagingNode).toBeDefined();

    // user approves deletion
    overlay.approveDelete("Notes/idea.md");

    // expect path is no longer tracked
    expect(overlay.findNode("master", "Notes/idea.md")).not.toBeDefined();
    expect(overlay.findNode("staging", "Notes/idea.md")).not.toBeDefined();
  });

  // todo: preferred behaviour may to be retain staging edits, and treat the staged file as a create
  it("merges vault delete into staging, losing AI edits", async () => {
    const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

    await overlay.modify(ideaFile, "Hello\n\nAI line\n\nGoodbye");

    await overlay.syncDelete("Notes/idea.md");

    const masterNode = overlay.findNode("master", "Notes/idea.md");
    const stagingNode = overlay.findNode("staging", "Notes/idea.md");
    expect(masterNode).not.toBeDefined();
    expect(stagingNode).not.toBeDefined();
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

    const masterNode = overlay.findNode("master", "Notes/renamed.md");
    const stagingNode = overlay.findNode("staging", "Notes/renamed.md");
    expect(masterNode.id).toEqual(stagingNode.id);
    expect(masterNode.data.get("name")).toEqual(stagingNode.data.get("name"));

    const oldPathMasterNode = overlay.findNode("master", "Notes/idea.md");
    const oldPathStagingNode = overlay.findNode("staging", "Nodes/idea.md");
    expect(oldPathMasterNode).not.toBeDefined();
    expect(oldPathStagingNode).not.toBeDefined();
  });
});
