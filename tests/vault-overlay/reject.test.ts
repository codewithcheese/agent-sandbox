import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VaultOverlay,
  type ProposedChange,
} from "../../src/chat/vault-overlay.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import { VaultState } from "../../src/chat/vault-state/index.ts";

describe("Reject changes", () => {
  let overlay: VaultOverlay;
  let proposedDoc: VaultState;
  let trackingDoc: VaultState;

  beforeEach(() => {
    overlay = new VaultOverlay(vault);
    proposedDoc = overlay.proposedDoc;
    trackingDoc = overlay.trackingDoc;
    // No automatic computeChanges on overlay.changes
  });

  afterEach(async () => {
    await helpers.reset();
  });

  const findChange = (
    changes: ProposedChange[],
    type: ProposedChange["type"],
    path: string,
    oldPath?: string,
  ): ProposedChange | undefined => {
    return changes.find((c) => {
      if (c.type !== type) return false;
      if (type === "rename" && c.type === "rename") {
        // type guard
        return c.path === path && c.info.oldPath === oldPath;
      }
      return c.path === path;
    });
  };

  describe("Reject create", () => {
    it("should remove a created file from proposed", async () => {
      await overlay.create("notes/new-file.md", "New content");

      let changes = overlay.getFileChanges();
      const createChange = findChange(changes, "create", "notes/new-file.md");
      expect(createChange).toBeDefined();
      expect(proposedDoc.findByPath("notes/new-file.md")).toBeDefined();

      await overlay.reject(createChange!);

      expect(proposedDoc.findByPath("notes/new-file.md")).toBeUndefined();
      expect(trackingDoc.findByPath("notes/new-file.md")).toBeUndefined(); // Should not exist in tracking

      changes = overlay.getFileChanges();
      expect(
        findChange(changes, "create", "notes/new-file.md"),
      ).toBeUndefined();
    });

    it("should remove a created folder from proposed", async () => {
      await overlay.createFolder("notes/new-folder");
      await overlay.create("notes/new-folder/item.md", "item");

      let changes = overlay.getFileChanges();
      const createFolderChange = findChange(
        changes,
        "create",
        "notes/new-folder",
      );
      expect(createFolderChange).toBeDefined();
      expect(proposedDoc.findByPath("notes/new-folder")).toBeDefined();
      expect(proposedDoc.findByPath("notes/new-folder/item.md")).toBeDefined();

      await overlay.reject(createFolderChange!);

      expect(proposedDoc.findByPath("notes/new-folder")).toBeUndefined();
      // Rejecting folder creation should also remove its children if they were part of the same "untracked" creation.
      // If item.md was a separate "create" proposal, it would need separate rejection.
      // Current `reject("create")` just deletes the node by ID. If folder is deleted, children are gone.
      expect(proposedDoc.findByPath("notes/new-folder/item.md")).toBeUndefined();

      expect(trackingDoc.findByPath("notes/new-folder")).toBeUndefined();

      changes = overlay.getFileChanges();
      expect(findChange(changes, "create", "notes/new-folder")).toBeUndefined();
    });
  });

  describe("Reject delete", () => {
    beforeEach(async () => {
      helpers.addFile("notes/to-delete.md", "Original Content");
      // Sync path to ensure it's in trackingDoc
      await overlay.syncPath("notes/to-delete.md");
      const file = overlay.getFileByPath("notes/to-delete.md");
      await overlay.delete(file!);
    });

    it("should restore a deleted file in proposed from trash, keeping its (trashed) content", async () => {
      let changes = overlay.getFileChanges();
      const deleteChange = findChange(changes, "delete", "notes/to-delete.md");
      expect(deleteChange).toBeDefined();

      const trashedProposedNode = proposedDoc.findTrashed("notes/to-delete.md");
      expect(trashedProposedNode).toBeDefined();
      // Content in trash should be original content because delete reverts to tracking before trashing
      expect(trashedProposedNode!.text).toEqual("Original Content");

      await overlay.reject(deleteChange!);

      const restoredProposedNode = proposedDoc.findByPath("notes/to-delete.md");
      expect(restoredProposedNode).toBeDefined();
      expect(restoredProposedNode!.isTrashed()).toBe(false);
      expect(restoredProposedNode!.text).toEqual("Original Content"); // Content remains as it was in trash

      const trackingNode = trackingDoc.findByPath("notes/to-delete.md");
      expect(trackingNode).toBeDefined(); // Still exists in tracking
      expect(trackingNode!.text).toEqual("Original Content");

      changes = overlay.getFileChanges();
      expect(
        findChange(changes, "delete", "notes/to-delete.md"),
      ).toBeUndefined();
      // There might be a "modify" change if stats differ, or no change if fully identical
    });

    it("should restore a deleted folder in proposed from trash", async () => {
      helpers.addFolder("notes/folder-to-delete");
      helpers.addFile("notes/folder-to-delete/item.md", "Item inside");
      await overlay.syncPath("notes/folder-to-delete"); // Sync folder
      await overlay.syncPath("notes/folder-to-delete/item.md"); // Sync file

      const folder = overlay.getFolderByPath("notes/folder-to-delete");
      await overlay.delete(folder!);

      let changes = overlay.getFileChanges();
      const deleteChange = findChange(
        changes,
        "delete",
        "notes/folder-to-delete",
      );
      expect(deleteChange).toBeDefined();
      expect(proposedDoc.findTrashed("notes/folder-to-delete")).toBeDefined();

      await overlay.reject(deleteChange!);

      const restoredProposedFolder = proposedDoc.findByPath(
        "notes/folder-to-delete",
      );
      expect(restoredProposedFolder).toBeDefined();
      expect(restoredProposedFolder!.isTrashed()).toBe(false);
      expect(restoredProposedFolder!.isDirectory).toBe(true);

      // Child item should also be "restored" as part of its parent folder being restored
      const restoredProposedItem = proposedDoc.findByPath(
        "notes/folder-to-delete/item.md",
      );
      expect(restoredProposedItem).toBeDefined();
      expect(restoredProposedItem!.text).toEqual("Item inside");

      const trackingFolder = trackingDoc.findByPath("notes/folder-to-delete");
      expect(trackingFolder).toBeDefined();

      changes = overlay.getFileChanges();
      expect(
        findChange(changes, "delete", "notes/folder-to-delete"),
      ).toBeUndefined();
    });
  });

  describe("Reject modify", () => {
    beforeEach(async () => {
      helpers.addFile("notes/to-modify.md", "Original Content");
      await overlay.syncPath("notes/to-modify.md");
      const file = overlay.getFileByPath("notes/to-modify.md");
      await overlay.modify(file!, "Proposed New Content");
    });

    it("should revert content of a modified file in proposed to tracking state", async () => {
      let changes = overlay.getFileChanges();
      const modifyChange = findChange(changes, "modify", "notes/to-modify.md");
      expect(modifyChange).toBeDefined();
      expect(proposedDoc.findByPath("notes/to-modify.md")?.text).toEqual(
        "Proposed New Content",
      );

      await overlay.reject(modifyChange!);

      const proposedNodeAfterReject =
        proposedDoc.findByPath("notes/to-modify.md");
      expect(proposedNodeAfterReject).toBeDefined();
      expect(proposedNodeAfterReject!.text).toEqual("Original Content"); // Reverted

      const trackingNode = trackingDoc.findByPath("notes/to-modify.md");
      expect(trackingNode!.text).toEqual("Original Content"); // Unchanged

      changes = overlay.getFileChanges();
      expect(
        findChange(changes, "modify", "notes/to-modify.md"),
      ).toBeUndefined();
    });
  });

  describe("Reject rename", () => {
    beforeEach(async () => {
      helpers.addFile("notes/original-name.md", "Content");
      await overlay.syncPath("notes/original-name.md");
      const file = overlay.getFileByPath("notes/original-name.md");
      await overlay.rename(file!, "notes/proposed-new-name.md");
    });

    it("should revert path of a renamed file in proposed to tracking state, keeping its content", async () => {
      // Optional: modify content after rename to test content preservation
      const renamedFile = overlay.getFileByPath("notes/proposed-new-name.md");
      await overlay.modify(renamedFile!, "Modified Content After Rename");

      let changes = overlay.getFileChanges();
      const renameChange = findChange(
        changes,
        "rename",
        "notes/proposed-new-name.md",
        "notes/original-name.md",
      );
      expect(renameChange).toBeDefined();
      expect(proposedDoc.findByPath("notes/proposed-new-name.md")).toBeDefined();
      expect(
        proposedDoc.findByPath("notes/proposed-new-name.md")?.text,
      ).toEqual("Modified Content After Rename");
      expect(proposedDoc.findByPath("notes/original-name.md")).toBeUndefined();

      await overlay.reject(renameChange!);

      const proposedNodeAfterReject = proposedDoc.findByPath(
        "notes/original-name.md",
      );
      expect(proposedNodeAfterReject).toBeDefined(); // Back to original path
      expect(proposedNodeAfterReject!.name).toEqual("original-name.md");
      expect(proposedNodeAfterReject!.text).toEqual(
        "Modified Content After Rename",
      ); // Content preserved

      expect(
        proposedDoc.findByPath("notes/proposed-new-name.md"),
      ).toBeUndefined(); // New path gone

      const trackingNode = trackingDoc.findByPath("notes/original-name.md");
      expect(trackingNode).toBeDefined(); // Still at original path in tracking
      expect(trackingNode!.text).toEqual("Content"); // Original content in tracking

      changes = overlay.getFileChanges();
      expect(
        findChange(
          changes,
          "rename",
          "notes/proposed-new-name.md",
          "notes/original-name.md",
        ),
      ).toBeUndefined();
      // Now there should be a "modify" change for "notes/original-name.md" because its content differs from tracking
      const modifyChange = findChange(
        changes,
        "modify",
        "notes/original-name.md",
      );
      expect(modifyChange).toBeDefined();
    });

    it("should revert path of a renamed folder in proposed, keeping its children/content", async () => {
      helpers.addFolder("notes/original-folder-name");
      const file = helpers.addFile(
        "notes/original-folder-name/item.md",
        "Folder Item",
      );
      await overlay.syncPath(file.path);

      const folder = overlay.getFolderByPath("notes/original-folder-name");
      await overlay.rename(folder, "notes/proposed-folder-new-name");

      // Optional: Add a new file to the renamed folder to test if it moves with parent
      await overlay.create(
        "notes/proposed-folder-new-name/new-item.md",
        "New Item in Renamed",
      );

      let changes = overlay.getFileChanges();
      const renameChange = findChange(
        changes,
        "rename",
        "notes/proposed-folder-new-name",
        "notes/original-folder-name",
      );
      expect(renameChange).toBeDefined();
      expect(
        proposedDoc.findByPath("notes/proposed-folder-new-name"),
      ).toBeDefined();
      expect(
        proposedDoc.findByPath("notes/proposed-folder-new-name/item.md"),
      ).toBeDefined();
      expect(
        proposedDoc.findByPath("notes/proposed-folder-new-name/new-item.md"),
      ).toBeDefined();

      await overlay.reject(renameChange!);

      const proposedFolderAfterReject = proposedDoc.findByPath(
        "notes/original-folder-name",
      );
      expect(proposedFolderAfterReject).toBeDefined(); // Back to original path
      expect(proposedFolderAfterReject!.name).toEqual(
        "original-folder-name",
      );
      expect(proposedFolderAfterReject!.isDirectory).toBe(true);

      // Children should have moved with the parent
      expect(
        proposedDoc.findByPath("notes/original-folder-name/item.md"),
      ).toBeDefined();
      expect(
        proposedDoc.findByPath("notes/original-folder-name/item.md")?.text,
      ).toEqual("Folder Item");
      expect(
        proposedDoc.findByPath("notes/original-folder-name/new-item.md"),
      ).toBeDefined();
      expect(
        proposedDoc.findByPath("notes/original-folder-name/new-item.md")?.text,
      ).toEqual("New Item in Renamed");

      expect(
        proposedDoc.findByPath("notes/proposed-folder-new-name"),
      ).toBeUndefined(); // New path gone

      changes = overlay.getFileChanges();
      expect(
        findChange(
          changes,
          "rename",
          "notes/proposed-folder-new-name",
          "notes/original-folder-name",
        ),
      ).toBeUndefined();
      // There might be "create" changes for "new-item.md" if it's now considered new relative to tracking's original-folder-name
    });
  });

  describe("Reject combined changes (Rename then Modify)", () => {
    beforeEach(async () => {
      helpers.addFile("notes/combo-original.md", "Original");
      await overlay.syncPath("notes/combo-original.md");
      const file = overlay.getFileByPath("notes/combo-original.md");
      await overlay.rename(file!, "notes/combo-renamed.md");
      const renamedFile = overlay.getFileByPath("notes/combo-renamed.md");
      await overlay.modify(renamedFile!, "Modified After Rename");
    });

    it("rejecting only modify should revert content but keep rename", async () => {
      let changes = overlay.getFileChanges();
      const modifyChange = findChange(
        changes,
        "modify",
        "notes/combo-renamed.md",
      );
      expect(modifyChange).toBeDefined();

      await overlay.reject(modifyChange!);

      const proposedNode = proposedDoc.findByPath("notes/combo-renamed.md");
      expect(proposedNode).toBeDefined();
      expect(proposedNode!.text).toEqual("Original"); // Content reverted
      expect(proposedNode!.name).toEqual("combo-renamed.md"); // Still renamed

      changes = overlay.getFileChanges();
      expect(
        findChange(changes, "modify", "notes/combo-renamed.md"),
      ).toBeUndefined(); // Modify change is gone
      expect(
        findChange(
          changes,
          "rename",
          "notes/combo-renamed.md",
          "notes/combo-original.md",
        ),
      ).toBeDefined(); // Rename change still exists
    });

    it("rejecting only rename should revert path but keep modified content at old path", async () => {
      let changes = overlay.getFileChanges();
      const renameChange = findChange(
        changes,
        "rename",
        "notes/combo-renamed.md",
        "notes/combo-original.md",
      );
      expect(renameChange).toBeDefined();

      await overlay.reject(renameChange!);

      const proposedNode = proposedDoc.findByPath("notes/combo-original.md"); // Back to original path
      expect(proposedNode).toBeDefined();
      expect(proposedNode!.text).toEqual("Modified After Rename"); // Content preserved
      expect(proposedNode!.name).toEqual("combo-original.md");

      expect(proposedDoc.findByPath("notes/combo-renamed.md")).toBeUndefined();

      changes = overlay.getFileChanges();
      expect(
        findChange(
          changes,
          "rename",
          "notes/combo-renamed.md",
          "notes/combo-original.md",
        ),
      ).toBeUndefined(); // Rename change is gone
      // Now there should be a "modify" change for "notes/combo-original.md"
      expect(
        findChange(changes, "modify", "notes/combo-original.md"),
      ).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("rejecting create for a file that was then deleted (hard delete)", async () => {
      // 1. Create in overlay (not in tracking)
      await overlay.create("notes/ephemeral.md", "Ephemeral content");
      const createdNode = proposedDoc.findByPath("notes/ephemeral.md");
      expect(createdNode).toBeDefined();

      let changes = overlay.getFileChanges();
      const createChange = findChange(changes, "create", "notes/ephemeral.md");
      expect(createChange).toBeDefined();

      // 2. Delete it (since it's not in tracking, it's a hard delete from proposed)
      await overlay.delete(overlay.getFileByPath("notes/ephemeral.md")!); // This will hard delete from proposed
      expect(proposedDoc.findByPath("notes/ephemeral.md")).toBeUndefined(); // Gone

      // Now, try to reject the original "create" change.
      // The `reject` method's initial `findChange` will fail because the "create" proposal is gone
      // (it's now a non-existent file, so no proposal).
      // This tests the invariant in `reject` that the change must still be valid.
      await expect(overlay.reject(createChange!)).rejects.toThrow(
        /Cannot reject create on notes\/ephemeral.md. No matching change found./,
      );
    });

    it("rejecting delete for a file that was created then deleted (hard delete)", async () => {
      // 1. Create in overlay
      await overlay.create("notes/newly-created.md", "content");
      // 2. Delete it (hard delete as it's not in tracking)
      await overlay.delete(overlay.getFileByPath("notes/newly-created.md")!);

      // At this point, there are NO changes. The file never existed in tracking.
      let changes = overlay.getFileChanges();
      expect(changes.length).toBe(0);
    });

    it("should throw error when trying to reject a change that no longer exists", async () => {
      await overlay.create("notes/temp-file.md", "Temporary");
      let changes = overlay.getFileChanges();
      const firstCreateChange = findChange(
        changes,
        "create",
        "notes/temp-file.md",
      );
      expect(firstCreateChange).toBeDefined();

      // Perform another operation that might clear/change the proposals
      await overlay.approve([{ type: "create", path: "notes/temp-file.md" }]); // Approve it

      // Now the original 'createChange' object is stale.
      changes = overlay.getFileChanges();
      expect(
        findChange(changes, "create", "notes/temp-file.md"),
      ).toBeUndefined(); // No longer a "create" proposal

      await expect(overlay.reject(firstCreateChange!)).rejects.toThrow(
        /Cannot reject create on notes\/temp-file.md. No matching change found./,
      );
    });
  });
});
