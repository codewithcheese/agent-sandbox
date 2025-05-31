import { describe, it, expect, beforeEach } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { helpers, vault } from "../mocks/obsidian.ts";

describe("VaultOverlay Path Resolution", () => {
  beforeEach(() => {
    helpers.reset();
  });

  describe("File Path Resolution", () => {
    it("should handle files from vault when not tracked", () => {
      const overlay = new VaultOverlay(vault);

      // Create file directly in vault
      vault.create("vault-only.md", "vault content");

      const file = overlay.getFileByPath("vault-only.md");
      expect(file).toBeTruthy();
      expect(file.vault).toBe(overlay);
    });
  });

  describe("Folder Path Resolution", () => {
    it("should return null when proposed node is not a directory", async () => {
      const overlay = new VaultOverlay(vault);
      await overlay.create("file.md", "content");

      // Try to get file as folder
      const folder = overlay.getFolderByPath("file.md");
      expect(folder).toBeNull();
    });

    it("should sync folder from vault when not tracked", () => {
      vault.createFolder("vault-folder");

      const overlay = new VaultOverlay(vault);

      const folder = overlay.getFolderByPath("vault-folder");
      expect(folder).toBeTruthy();
    });
  });

  describe("Abstract File Path Resolution", () => {
    it("should handle abstract files from vault when not tracked", () => {
      const overlay = new VaultOverlay(vault);

      // Create file directly in vault
      vault.create("vault-file.md", "vault content");

      const abstractFile = overlay.getAbstractFileByPath("vault-file.md");
      expect(abstractFile).toBeTruthy();
      expect(abstractFile.vault).toBe(overlay);
    });
  });

  describe("Find Node", () => {
    it("should handle root path variations", () => {
      const overlay = new VaultOverlay(vault);

      const root1 = overlay.proposedFS.findByPath(".");
      const root2 = overlay.proposedFS.findByPath("/");
      const root3 = overlay.proposedFS.findByPath("");
      const root4 = overlay.proposedFS.findByPath("./");

      expect(root1).toBeTruthy();
      expect(root2).toBeTruthy();
      expect(root3).toBeTruthy();
      expect(root4).toBeTruthy();

      // All should be the same root node
      expect(root1.id).toBe(root2.id);
      expect(root2.id).toBe(root3.id);
      expect(root3.id).toBe(root4.id);
    });

    it("should handle paths with empty segments", () => {
      const overlay = new VaultOverlay(vault);

      // Create node with normal path
      overlay.proposedFS.createNode("folder/file.md", {
        isDirectory: false,
        text: "content",
      });

      // Find with path containing empty segments
      const node1 = overlay.proposedFS.findByPath("folder//file.md");
      const node2 = overlay.proposedFS.findByPath("/folder/file.md");
      const node3 = overlay.proposedFS.findByPath("folder/file.md/");

      expect(node1).toBeTruthy();
      expect(node2).toBeTruthy();
      expect(node3).toBeTruthy();
    });
  });
});
