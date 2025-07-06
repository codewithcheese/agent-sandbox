import { describe, it, expect, beforeEach } from "vitest";
import { VaultOverlay } from "../src/chat/vault-overlay.svelte.ts";
import { MetadataCacheOverlay } from "../src/chat/metadata-cache-overlay.ts";
import {
  vault,
  helpers,
  metadataCache as metadataCacheMock,
  MockTFile,
} from "./mocks/obsidian.ts";

describe("MetadataCacheOverlay", () => {
  let vaultOverlay: VaultOverlay;
  let metadataCache: MetadataCacheOverlay;

  beforeEach(() => {
    helpers.reset();
    vaultOverlay = new VaultOverlay(vault);
    metadataCache = new MetadataCacheOverlay(
      vaultOverlay,
      metadataCacheMock as any,
    );
  });

  describe("getFileCache", () => {
    it("should return vault metadata when no proposed changes", async () => {
      // Create a file in vault with frontmatter
      const content = `---
title: Test File
tags: [test]
---

# Test Content`;

      const file = helpers.addFile("/test.md", content);

      const result = metadataCache.getFileCache(file);
      expect(result?.frontmatter).toEqual({
        title: "Test File",
        tags: ["test"],
      });
    });

    it("should return proposed metadata when file is modified in overlay", async () => {
      // Create file in vault
      const originalContent = `---
title: Original
---

Original content`;

      const file = helpers.addFile("/test.md", originalContent);

      // Modify in overlay
      const proposedContent = `---
title: Modified by AI
author: AI Assistant
---

Modified content`;

      await vaultOverlay.modify(file, proposedContent);

      const result = metadataCache.getFileCache(file);
      expect(result?.frontmatter).toEqual({
        title: "Modified by AI",
        author: "AI Assistant",
      });
    });

    it("should return null for non-existent files", () => {
      const file = new MockTFile("/non-existent.md");
      const result = metadataCache.getFileCache(file);
      expect(result).toBeNull();
    });

    it("should handle binary files in proposed state", async () => {
      // Create binary file in overlay only (doesn't exist in vault)
      const buffer = new ArrayBuffer(100);
      const file = await vaultOverlay.createBinary("/image.png", buffer);
      
      const result = metadataCache.getFileCache(file);
      expect(result).toEqual({ frontmatter: {} });
    });
  });

  describe("getFirstLinkpathDest", () => {
    it("should resolve links to vault files when no proposed changes", () => {
      const file = helpers.addFile("/target.md", "# Target");

      const result = metadataCache.getFirstLinkpathDest("target", "/source.md");
      expect(result?.path).toBe("target.md");
    });

    it("should resolve links to proposed files", async () => {
      // Create file in overlay only
      await vaultOverlay.create("/proposed-file.md", "# Proposed Content");

      const result = metadataCache.getFirstLinkpathDest(
        "proposed-file",
        "/source.md",
      );
      expect(result?.path).toBe("proposed-file.md");
    });

    it("should resolve basename links to proposed files", async () => {
      // Create file in overlay with nested path
      await vaultOverlay.create("/folder/nested-file.md", "# Nested Content");

      const result = metadataCache.getFirstLinkpathDest(
        "nested-file",
        "/source.md",
      );
      expect(result?.path).toBe("folder/nested-file.md");
    });

    it("should handle links with display text", async () => {
      await vaultOverlay.create("/target.md", "# Target");

      const result = metadataCache.getFirstLinkpathDest(
        "target|Display Text",
        "/source.md",
      );
      expect(result?.path).toBe("target.md");
    });

    it("should handle links with anchors", async () => {
      await vaultOverlay.create("/target.md", "# Target");

      const result = metadataCache.getFirstLinkpathDest(
        "target#heading",
        "/source.md",
      );
      expect(result?.path).toBe("target.md");
    });

    it("should add .md extension automatically", async () => {
      await vaultOverlay.create("/target.md", "# Target");

      const result = metadataCache.getFirstLinkpathDest("target", "/source.md");
      expect(result?.path).toBe("target.md");
    });

    it("should resolve relative paths", async () => {
      await vaultOverlay.create("/folder/target.md", "# Target");

      const result = metadataCache.getFirstLinkpathDest(
        "target",
        "/folder/source.md",
      );
      expect(result?.path).toBe("folder/target.md");
    });

    it("should not resolve to trashed files", async () => {
      // Create and then delete file in overlay
      const file = await vaultOverlay.create("/target.md", "# Target");
      await vaultOverlay.delete(file);

      const result = metadataCache.getFirstLinkpathDest("target", "/source.md");
      expect(result).toBeNull();
    });

    it("should fall back to vault resolution when not found in proposed", () => {
      // Create file only in vault
      const file = helpers.addFile("/vault-only.md", "# Vault Only");

      const result = metadataCache.getFirstLinkpathDest(
        "vault-only",
        "/source.md",
      );
      expect(result?.path).toBe("vault-only.md");
    });

    it("should resolve basename conflicts deterministically", async () => {
      // Create multiple files with same basename in different folders
      await vaultOverlay.create("/long/path/to/note.md", "# Note 1");
      await vaultOverlay.create("/short/note.md", "# Note 2"); 
      await vaultOverlay.create("/another/path/note.md", "# Note 3");
      
      // Multiple calls should return same result (deterministic)
      const result1 = metadataCache.getFirstLinkpathDest("note", "/source.md");
      const result2 = metadataCache.getFirstLinkpathDest("note", "/source.md");
      const result3 = metadataCache.getFirstLinkpathDest("note", "/source.md");
      
      expect(result1?.path).toBe(result2?.path);
      expect(result2?.path).toBe(result3?.path);
      
      // Should prefer shorter path first, then alphabetical
      expect(result1?.path).toBe("short/note.md");
    });
  });

  describe("getCache", () => {
    it("should return vault metadata for existing vault files", () => {
      const content = `---
title: Test File
tags: [test]
---

# Test Content`;

      helpers.addFile("/test.md", content);

      const result = metadataCache.getCache("/test.md");
      expect(result?.frontmatter).toEqual({
        title: "Test File",
        tags: ["test"],
      });
    });

    it("should return proposed metadata for modified files", async () => {
      const originalContent = `---
title: Original
---

Original content`;

      const file = helpers.addFile("/test.md", originalContent);

      const proposedContent = `---
title: Modified by AI
author: AI Assistant
---

Modified content`;

      await vaultOverlay.modify(file, proposedContent);

      const result = metadataCache.getCache("/test.md");
      expect(result?.frontmatter).toEqual({
        title: "Modified by AI",
        author: "AI Assistant",
      });
    });

    it("should return metadata for proposed-only files", async () => {
      await vaultOverlay.create("/new-file.md", `---
title: New File
---

New content`);

      const result = metadataCache.getCache("/new-file.md");
      expect(result?.frontmatter).toEqual({
        title: "New File",
      });
    });

    it("should return null for non-existent files", () => {
      const result = metadataCache.getCache("/non-existent.md");
      expect(result).toBeNull();
    });

    it("should return empty frontmatter for binary files in proposed state", async () => {
      const buffer = new ArrayBuffer(100);
      await vaultOverlay.createBinary("/image.png", buffer);
      
      const result = metadataCache.getCache("/image.png");
      expect(result).toEqual({ frontmatter: {} });
    });
  });
});
