import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import { getText } from "$lib/utils/loro.ts";
import type { TFile } from "obsidian";

describe("Sync", () => {
  let overlay: VaultOverlay;

  beforeEach(() => {
    overlay = new VaultOverlay(vault);
  });

  afterEach(async () => {
    await helpers.reset();
  });

  describe("GIVEN file exists in vault and modify in overlay", () => {
    let ideaFile: TFile;

    beforeEach(async () => {
      ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");
      await overlay.modify(ideaFile, "Hello\n\nAI line\n\nGoodbye"); // AI edits
    });

    describe("WHEN modify in vault", () => {
      beforeEach(async () => {
        await vault.modify(ideaFile, "Hello\n\nHuman line\n\nGoodbye"); // Human edit
      });

      it("SHOULD sync vault contents to tracking, and merge proposed", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("Notes/idea.md");

        expect(getText(overlay.trackingFS.findByPath("Notes/idea.md"))).toEqual(
          "Hello\n\nHuman line\n\nGoodbye",
        );
        expect(getText(overlay.proposedFS.findByPath("Notes/idea.md"))).toEqual(
          "Hello\n\nHuman line\n\nAI line\n\nGoodbye",
        );
      });
    });

    describe("WHEN delete in vault", () => {
      beforeEach(async () => {
        await vault.delete(ideaFile); // Human deletes file
      });

      it("SHOULD sync vault delete to tracking, and proposed deleted", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);

        // File SHOULD be deleted from tracking
        expect(overlay.trackingFS.findByPath("Notes/idea.md")).toBeUndefined();

        // Proposed changes should be deleted
        expect(overlay.proposedFS.findByPath("Notes/idea.md")).toBeUndefined();

        // Should have no changes
        const changes = overlay.getFileChanges();
        expect(changes).toHaveLength(0);
      });
    });
  });

  describe("GIVEN file does not exist in vault, and create in overlay", () => {
    beforeEach(async () => {
      // AI creates a new file that doesn't exist in vault
      await overlay.create("Notes/new-file.md", "AI created content");
    });

    describe("WHEN create in vault", () => {
      beforeEach(async () => {
        // Human creates same file in vault with different content
        await vault.create("Notes/new-file.md", "Human created content");
      });

      it("SHOULD sync create and proposed becomes modify ", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("Notes/new-file.md");

        expect(
          getText(overlay.trackingFS.findByPath("Notes/new-file.md")),
        ).toEqual("Human created content");
        expect(
          getText(overlay.proposedFS.findByPath("Notes/new-file.md")),
        ).toEqual("AI created content");

        const changes = overlay.getFileChanges();

        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({
          type: "modify",
        });
      });
    });
  });

  describe("GIVEN file exists in vault and rename in overlay", () => {
    let originalFile: TFile;

    beforeEach(async () => {
      originalFile = helpers.addFile("Notes/original.md", "Hello\n\nGoodbye");
      // AI renames the file
      await overlay.rename(originalFile, "Notes/renamed.md");
    });

    describe("WHEN modify in vault", () => {
      beforeEach(async () => {
        // Human modifies original file in vault
        await vault.modify(originalFile, "Hello\n\nHuman edit\n\nGoodbye");
      });

      it("SHOULD sync modify to tracking, merge to renamed file in proposed", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("Notes/original.md");

        // Original path in tracking SHOULD have human changes
        expect(
          getText(overlay.trackingFS.findByPath("Notes/original.md")),
        ).toEqual("Hello\n\nHuman edit\n\nGoodbye");

        // Renamed file in proposed SHOULD have merged content
        expect(
          getText(overlay.proposedFS.findByPath("Notes/renamed.md")),
        ).toEqual("Hello\n\nHuman edit\n\nGoodbye");

        // Should still show as a rename change
        const changes = overlay.getFileChanges();
        expect(
          changes.some(
            (c) => c.type === "rename" && c.path === "Notes/renamed.md",
          ),
        ).toBe(true);
      });
    });

    describe("WHEN delete in vault", () => {
      beforeEach(async () => {
        // Human deletes original file in vault
        await vault.delete(originalFile);
      });

      it("SHOULD sync delete to tracking, delete renamed file in proposed", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);

        // Original file SHOULD be deleted from tracking
        expect(
          overlay.trackingFS.findByPath("Notes/original.md"),
        ).toBeUndefined();

        // Renamed file SHOULD be deleted from proposed
        expect(
          overlay.proposedFS.findByPath("Notes/renamed.md"),
        ).toBeUndefined();

        // Should now show as a `create` change (since original was deleted)
        const changes = overlay.getFileChanges();
        expect(changes).toHaveLength(0);
      });
    });

    describe("WHEN rename in vault, and renamed event not received by overlay", () => {
      beforeEach(async () => {
        // Human renames original file to different name in vault
        await vault.rename(originalFile, "Notes/human-renamed.md");
      });

      it("SHOULD sync delete to tracking, delete renamed file in proposed", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);

        // Tracking SHOULD be deleted
        expect(overlay.trackingFS.findByPath("Notes/idea.md")).toBeUndefined();
        // Overlay SHOULD still have `rename`
        expect(
          overlay.proposedFS.findByPath("Notes/renamed.md"),
        ).toBeUndefined();

        // Should show as create (AI's rename) since tracking path changed
        const changes = overlay.getFileChanges();
        expect(changes).toHaveLength(0);
      });
    });
  });

  describe("GIVEN file exists in vault and delete in overlay", () => {
    let targetFile: TFile;

    beforeEach(async () => {
      targetFile = helpers.addFile("Notes/target.md", "Hello\n\nGoodbye");
      // AI deletes the file
      await overlay.delete(targetFile);
    });

    describe("WHEN modify in vault", () => {
      beforeEach(async () => {
        // Human modifies the file in vault (unaware of AI deletion)
        await vault.modify(targetFile, "Hello\n\nHuman edit\n\nGoodbye");
      });

      it("SHOULD sync modify to tracking, retain delete in proposed", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("Notes/target.md");

        // Tracking SHOULD have human changes
        expect(
          getText(overlay.trackingFS.findByPath("Notes/target.md")),
        ).toEqual("Hello\n\nHuman edit\n\nGoodbye");

        // File SHOULD be restored in proposed with human changes
        expect(
          overlay.proposedFS.findByPath("Notes/target.md"),
        ).toBeUndefined();

        // Should no longer show as deleted
        const changes = overlay.getFileChanges();
        expect(
          changes.some(
            (c) => c.type === "delete" && c.path === "Notes/target.md",
          ),
        ).toBe(true);
      });
    });

    describe("WHEN delete in vault", () => {
      beforeEach(async () => {
        // Human also deletes the file in vault
        await vault.delete(targetFile);
      });

      it("SHOULD sync delete to tracking, retain delete in proposed", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);

        // File SHOULD be deleted from tracking
        expect(
          overlay.trackingFS.findByPath("Notes/target.md"),
        ).toBeUndefined();

        // File SHOULD remain deleted in proposed
        expect(
          overlay.proposedFS.findByPath("Notes/target.md"),
        ).toBeUndefined();

        // Should have no pending changes since both agree on deletion
        expect(overlay.changes).toHaveLength(0);
      });
    });

    describe("WHEN rename in vault AND not rename event not tracked", () => {
      beforeEach(async () => {
        // Human renames the file in vault (unaware of AI deletion)
        await vault.rename(targetFile, "Notes/renamed-target.md");
      });

      it("SHOULD sync as delete to tracking, retain delete in proposed", async () => {
        const result = await overlay.syncAll();
        expect(result).toHaveLength(1);

        // Original path SHOULD be gone from tracking
        expect(
          overlay.trackingFS.findByPath("Notes/target.md"),
        ).toBeUndefined();

        // New path NOT tracked, since rename event not tracked
        expect(
          overlay.trackingFS.findByPath("Notes/renamed-target.md"),
        ).toBeUndefined();

        // File SHOULD remain deleted in proposed
        expect(
          overlay.proposedFS.findByPath("Notes/renamed-target.md"),
        ).toBeUndefined();

        // Should still show as deleted
        const changes = overlay.getFileChanges();
        expect(changes.some((c) => c.type === "delete")).toBe(true);
      });
    });
  });

  // ^ Roll-up test cases below, to fill out the possible combinations

  describe("syncPath", () => {
    it("syncs vault edits into proposed without losing AI edits", async () => {});

    // note: preferred behaviour may to be retain proposed edits, and treat the staged file as a create
    it("merges vault delete into proposed, losing AI edits", async () => {
      const ideaFile = helpers.addFile("Notes/idea.md", "Hello\n\nGoodbye");

      await overlay.modify(ideaFile, "Hello\n\nAI line\n\nGoodbye");

      await vault.delete(ideaFile);

      const trackingNode = overlay.trackingFS.findByPath("Notes/idea.md");
      await overlay.syncDelete("Notes/idea.md");

      const proposedNode = overlay.proposedFS.findById(trackingNode.id);
      expect(trackingNode.isDeleted()).toEqual(true);
      expect(proposedNode.isDeleted()).toEqual(true);
    });

    it("human edits and syncs vault file without losing overlay edits", async () => {
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
    });

    it("SHOULD handle syncPath for files with large content", async () => {
      // Create large file in vault
      const largeContent = "x".repeat(60000);
      await vault.create("large-vault-file.md", largeContent);

      await overlay.syncPath("large-vault-file.md");

      const file = overlay.getFileByPath("large-vault-file.md");
      const content = await overlay.read(file);
      expect(content).toBe(largeContent);
    });

    it("SHOULD handle syncPath for folders", async () => {
      // Create folder in vault
      await vault.createFolder("vault-folder");

      await overlay.syncPath("vault-folder");

      const folder = overlay.getFolderByPath("vault-folder");
      expect(folder).toBeTruthy();
    });

    it("SHOULD throw error for invalid file types in syncPath", async () => {
      // Mock an invalid file type
      const originalGetAbstractFileByPath = vault.getAbstractFileByPath;
      vault.getAbstractFileByPath = () => ({ path: "invalid" }) as any;

      await expect(overlay.syncPath("invalid")).rejects.toThrow(
        "invalid is not a file or folder",
      );

      // Restore original method
      vault.getAbstractFileByPath = originalGetAbstractFileByPath;
    });

    it("SHOULD update existing tracking node text during syncPath", async () => {
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

  it("SHOULD not sync when no changes ", async () => {
    const file = helpers.addFile("test.md", "content");
    await overlay.syncPath("test.md");

    // No changes made
    const result = await overlay.syncAll();
    expect(result).toHaveLength(0);
  });

  it("SHOULD exclude trash folder paths from sync consideration", async () => {
    // Create file in trash (SHOULD be ignored)
    await vault.createFolder(".overlay-trash");
    await vault.create(".overlay-trash/deleted.md", "content");

    const result = await overlay.syncAll();

    // Should not sync trash contents
    expect(result).toHaveLength(0);
  });

  it("SHOULD return correct count of synced files", async () => {
    const file1 = helpers.addFile("file1.md", "content1");
    const file2 = helpers.addFile("file2.md", "content2");
    await overlay.syncPath("file1.md");
    await overlay.syncPath("file2.md");

    await vault.modify(file1, "modified1");
    await vault.modify(file2, "modified2");

    const result = await overlay.syncAll();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.path)).toEqual(["file1.md", "file2.md"]);
  });
});
