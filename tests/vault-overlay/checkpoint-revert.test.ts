import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { VaultState } from "../../src/chat/vault-state/vault-state.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import type { TFile } from "obsidian";

describe("checkpoint/revert", () => {
  describe("VaultState.rollback", () => {
    let state: VaultState;

    beforeEach(() => {
      state = new VaultState("proposed");
    });

    describe("GIVEN CREATE then rollback", () => {
      it("SHOULD remove the created file", () => {
        const checkpoint = state.checkpoint();
        state.createAtPath("test.md", { isDirectory: false, text: "content" });

        expect(state.findByPath("test.md")).toBeTruthy();

        state.rollback(checkpoint);

        expect(state.findByPath("test.md")).toBeUndefined();
      });
    });

    describe("GIVEN MODIFY then rollback", () => {
      it("SHOULD restore original content", () => {
        state.createAtPath("test.md", { isDirectory: false, text: "original" });
        const checkpoint = state.checkpoint();

        const node = state.findByPath("test.md")!;
        node.text = "modified";
        expect(node.text).toBe("modified");

        state.rollback(checkpoint);

        const restored = state.findByPath("test.md")!;
        expect(restored.text).toBe("original");
      });
    });

    describe("GIVEN DELETE then rollback", () => {
      it("SHOULD restore the deleted file", () => {
        state.createAtPath("test.md", { isDirectory: false, text: "content" });
        const checkpoint = state.checkpoint();

        const node = state.findByPath("test.md")!;
        node.delete();
        expect(state.findByPath("test.md")).toBeUndefined();

        state.rollback(checkpoint);

        const restored = state.findByPath("test.md")!;
        expect(restored).toBeTruthy();
        expect(restored.text).toBe("content");
      });
    });

    describe("GIVEN RENAME then rollback", () => {
      it("SHOULD restore original name", () => {
        state.createAtPath("original.md", { isDirectory: false, text: "content" });
        const checkpoint = state.checkpoint();

        const node = state.findByPath("original.md")!;
        node.rename("renamed.md");
        expect(state.findByPath("renamed.md")).toBeTruthy();
        expect(state.findByPath("original.md")).toBeUndefined();

        state.rollback(checkpoint);

        expect(state.findByPath("original.md")).toBeTruthy();
        expect(state.findByPath("renamed.md")).toBeUndefined();
      });
    });

    describe("GIVEN MOVE then rollback", () => {
      it("SHOULD restore original parent", () => {
        state.createAtPath("folder-a/test.md", { isDirectory: false, text: "content" });
        state.createAtPath("folder-b", { isDirectory: true });
        const checkpoint = state.checkpoint();

        const node = state.findByPath("folder-a/test.md")!;
        const newParent = state.findByPath("folder-b")!;
        node.move(newParent);
        expect(state.findByPath("folder-b/test.md")).toBeTruthy();
        expect(state.findByPath("folder-a/test.md")).toBeUndefined();

        state.rollback(checkpoint);

        expect(state.findByPath("folder-a/test.md")).toBeTruthy();
        expect(state.findByPath("folder-b/test.md")).toBeUndefined();
      });
    });

    describe("GIVEN multiple operations then rollback", () => {
      it("SHOULD undo all operations after checkpoint", () => {
        state.createAtPath("file1.md", { isDirectory: false, text: "one" });
        const checkpoint = state.checkpoint();

        // Multiple operations after checkpoint
        state.createAtPath("file2.md", { isDirectory: false, text: "two" });
        const node1 = state.findByPath("file1.md")!;
        node1.text = "modified";
        state.createAtPath("file3.md", { isDirectory: false, text: "three" });

        expect(state.findByPath("file2.md")).toBeTruthy();
        expect(state.findByPath("file3.md")).toBeTruthy();
        expect(state.findByPath("file1.md")!.text).toBe("modified");

        state.rollback(checkpoint);

        expect(state.findByPath("file1.md")!.text).toBe("one");
        expect(state.findByPath("file2.md")).toBeUndefined();
        expect(state.findByPath("file3.md")).toBeUndefined();
      });
    });

    describe("GIVEN multiple checkpoints", () => {
      it("SHOULD allow rollback to any checkpoint", () => {
        state.createAtPath("file1.md", { isDirectory: false, text: "one" });
        const checkpoint1 = state.checkpoint();

        state.createAtPath("file2.md", { isDirectory: false, text: "two" });
        const checkpoint2 = state.checkpoint();

        state.createAtPath("file3.md", { isDirectory: false, text: "three" });

        // Rollback to checkpoint2 - only file3 should be removed
        state.rollback(checkpoint2);
        expect(state.findByPath("file1.md")).toBeTruthy();
        expect(state.findByPath("file2.md")).toBeTruthy();
        expect(state.findByPath("file3.md")).toBeUndefined();

        // Rollback to checkpoint1 - file2 should also be removed
        state.rollback(checkpoint1);
        expect(state.findByPath("file1.md")).toBeTruthy();
        expect(state.findByPath("file2.md")).toBeUndefined();
      });
    });

    describe("GIVEN checkpoint at 0", () => {
      it("SHOULD revert to empty state", () => {
        const checkpoint = state.checkpoint(); // 0 - no operations yet

        state.createAtPath("file1.md", { isDirectory: false, text: "one" });
        state.createAtPath("file2.md", { isDirectory: false, text: "two" });

        state.rollback(checkpoint);

        expect(state.findByPath("file1.md")).toBeUndefined();
        expect(state.findByPath("file2.md")).toBeUndefined();
        // Infrastructure folders should still exist
        expect(state.findByPath(".overlay-trash")).toBeTruthy();
        expect(state.findByPath(".overlay-tmp")).toBeTruthy();
      });
    });

    describe("GIVEN rollback to current position", () => {
      it("SHOULD be a no-op", () => {
        state.createAtPath("test.md", { isDirectory: false, text: "content" });
        const checkpoint = state.checkpoint();

        state.rollback(checkpoint);

        expect(state.findByPath("test.md")).toBeTruthy();
        expect(state.findByPath("test.md")!.text).toBe("content");
      });
    });

    describe("GIVEN invalid checkpoint", () => {
      it("SHOULD throw for negative checkpoint", () => {
        expect(() => state.rollback(-1)).toThrow("Invalid checkpoint");
      });

      it("SHOULD throw for checkpoint beyond log length", () => {
        state.createAtPath("test.md", { isDirectory: false, text: "content" });
        const logLength = state.getLogLength();

        expect(() => state.rollback(logLength + 1)).toThrow("Invalid checkpoint");
      });
    });

    describe("GIVEN nested folder operations", () => {
      it("SHOULD correctly restore folder hierarchy", () => {
        state.createAtPath("a/b/c/file.md", { isDirectory: false, text: "deep" });
        const checkpoint = state.checkpoint();

        // Delete parent folder (cascades to children)
        const folderB = state.findByPath("a/b")!;
        folderB.delete();

        expect(state.findByPath("a/b")).toBeUndefined();
        expect(state.findByPath("a/b/c")).toBeUndefined();
        expect(state.findByPath("a/b/c/file.md")).toBeUndefined();

        state.rollback(checkpoint);

        expect(state.findByPath("a/b")).toBeTruthy();
        expect(state.findByPath("a/b/c")).toBeTruthy();
        expect(state.findByPath("a/b/c/file.md")).toBeTruthy();
        expect(state.findByPath("a/b/c/file.md")!.text).toBe("deep");
      });
    });
  });

  describe("VaultOverlay.revert", () => {
    let overlay: VaultOverlay;

    beforeEach(() => {
      overlay = new VaultOverlay(vault);
    });

    afterEach(async () => {
      await helpers.reset();
    });

    describe("GIVEN AI modifications then revert", () => {
      let existingFile: TFile;

      beforeEach(async () => {
        // Setup: file exists in vault
        existingFile = helpers.addFile("existing.md", "vault content");
        await overlay.modify(existingFile, "AI modified content");
      });

      it("SHOULD only affect proposed state", async () => {
        const checkpoint = overlay.proposedDoc.checkpoint();

        // AI makes more changes
        await overlay.create("new-file.md", "new content");
        await overlay.modify(existingFile, "more AI changes");

        // Verify changes exist
        expect(overlay.proposedDoc.findByPath("new-file.md")).toBeTruthy();
        expect(overlay.proposedDoc.findByPath("existing.md")!.text).toBe("more AI changes");

        // Revert
        overlay.revert(checkpoint);

        // New file should be gone
        expect(overlay.proposedDoc.findByPath("new-file.md")).toBeUndefined();
        // Existing file should be back to "AI modified content" (not vault content)
        expect(overlay.proposedDoc.findByPath("existing.md")!.text).toBe("AI modified content");

        // Tracking should be unchanged throughout
        expect(overlay.trackingDoc.findByPath("existing.md")!.text).toBe("vault content");
      });
    });

    describe("GIVEN AI create, rename, modify sequence then revert", () => {
      it("SHOULD undo all operations in sequence", async () => {
        const checkpoint = overlay.proposedDoc.checkpoint();

        // Complex sequence of operations
        await overlay.create("step1.md", "step 1");
        const file1 = overlay.getFileByPath("step1.md");
        await overlay.rename(file1, "step2.md");
        const file2 = overlay.getFileByPath("step2.md");
        await overlay.modify(file2, "step 2 modified");
        await overlay.create("another.md", "another file");

        // Verify state before revert
        expect(overlay.proposedDoc.findByPath("step1.md")).toBeUndefined();
        expect(overlay.proposedDoc.findByPath("step2.md")!.text).toBe("step 2 modified");
        expect(overlay.proposedDoc.findByPath("another.md")).toBeTruthy();

        overlay.revert(checkpoint);

        // Everything should be undone
        expect(overlay.proposedDoc.findByPath("step1.md")).toBeUndefined();
        expect(overlay.proposedDoc.findByPath("step2.md")).toBeUndefined();
        expect(overlay.proposedDoc.findByPath("another.md")).toBeUndefined();
      });
    });

    describe("GIVEN revert updates changes list", () => {
      it("SHOULD recalculate getFileChanges after revert", async () => {
        const checkpoint = overlay.proposedDoc.checkpoint();

        await overlay.create("new.md", "content");
        expect(overlay.getFileChanges().length).toBe(1);
        expect(overlay.getFileChanges()[0].type).toBe("create");

        overlay.revert(checkpoint);

        // revert() calls computeChanges() which updates the changes list
        expect(overlay.getFileChanges().length).toBe(0);
      });
    });

    describe("GIVEN AI delete then revert", () => {
      let existingFile: TFile;

      beforeEach(async () => {
        existingFile = helpers.addFile("to-delete.md", "will be deleted");
        await overlay.modify(existingFile, "will be deleted"); // sync to overlay
      });

      it("SHOULD restore deleted file in proposed", async () => {
        const checkpoint = overlay.proposedDoc.checkpoint();

        await overlay.delete(existingFile);

        // File should be trashed
        expect(overlay.proposedDoc.findByPath("to-delete.md")).toBeUndefined();
        expect(overlay.proposedDoc.findTrashed("to-delete.md")).toBeTruthy();

        overlay.revert(checkpoint);

        // File should be restored
        expect(overlay.proposedDoc.findByPath("to-delete.md")).toBeTruthy();
        expect(overlay.proposedDoc.findByPath("to-delete.md")!.text).toBe("will be deleted");
        expect(overlay.proposedDoc.findTrashed("to-delete.md")).toBeUndefined();
      });
    });

    describe("GIVEN partial revert with multiple checkpoints", () => {
      it("SHOULD allow incremental undo", async () => {
        await overlay.create("file1.md", "one");
        const checkpoint1 = overlay.proposedDoc.checkpoint();

        await overlay.create("file2.md", "two");
        const checkpoint2 = overlay.proposedDoc.checkpoint();

        await overlay.create("file3.md", "three");

        expect(overlay.getFileChanges().length).toBe(3);

        // Partial revert to checkpoint2
        overlay.revert(checkpoint2);
        expect(overlay.getFileChanges().length).toBe(2);
        expect(overlay.proposedDoc.findByPath("file3.md")).toBeUndefined();
        expect(overlay.proposedDoc.findByPath("file2.md")).toBeTruthy();

        // Further revert to checkpoint1
        overlay.revert(checkpoint1);
        expect(overlay.getFileChanges().length).toBe(1);
        expect(overlay.proposedDoc.findByPath("file2.md")).toBeUndefined();
        expect(overlay.proposedDoc.findByPath("file1.md")).toBeTruthy();
      });
    });
  });

  describe("Integration: approve rollback on error", () => {
    let overlay: VaultOverlay;

    beforeEach(() => {
      overlay = new VaultOverlay(vault);
    });

    afterEach(async () => {
      await helpers.reset();
    });

    it("SHOULD rollback both states if approval fails", async () => {
      // Create a file in overlay
      await overlay.create("valid.md", "valid content");

      // Capture state before approve
      const proposedBefore = overlay.proposedDoc.findByPath("valid.md")!.text;

      // Try to approve with a non-existent file (should fail)
      await expect(
        overlay.approve([
          { type: "create", path: "valid.md" },
          { type: "create", path: "nonexistent.md" }, // This will fail
        ])
      ).rejects.toThrow();

      // State should be rolled back - valid.md should still be in proposed only
      expect(overlay.proposedDoc.findByPath("valid.md")).toBeTruthy();
      expect(overlay.proposedDoc.findByPath("valid.md")!.text).toBe(proposedBefore);
      // And not written to tracking (approval was rolled back)
      expect(overlay.trackingDoc.findByPath("valid.md")).toBeUndefined();
    });
  });
});
