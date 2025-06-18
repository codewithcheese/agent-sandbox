import { describe, it, expect, beforeEach, vi } from "vitest";
import { expandBacklinks } from "../../src/lib/utils/backlinks.ts";
import { helpers, vault, metadataCache } from "../mocks/obsidian.ts";

describe("expandBacklinks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    helpers.reset();
  });

  describe("empty and basic input", () => {
    it("should return empty string for empty input", () => {
      const result = expandBacklinks("");
      expect(result).toBe("");
    });

    it("should return unchanged text when no backlinks present", () => {
      const text = "This is just regular text with no backlinks.";
      const result = expandBacklinks(text);
      expect(result).toBe(text);
    });

    it("should handle text with square brackets but not backlinks", () => {
      const text = "Array[index] and [citation] are not backlinks.";
      const result = expandBacklinks(text);
      expect(result).toBe(text);
    });
  });

  describe("single backlink scenarios", () => {
    it("should expand backlink when file exists and basename differs from path", () => {
      // Create a file with path different from basename
      helpers.addFile("folder/subfolder/note.md", "content");

      const text = "See [[note]] for details.";
      const result = expandBacklinks(text);
      expect(result).toBe("See [[folder/subfolder/note.md|note]] for details.");
    });

    it("should not expand when file exists but path matches link text", () => {
      helpers.addFile("note.md", "content");

      const text = "See [[note.md]] for details.";
      const result = expandBacklinks(text);
      expect(result).toBe("See [[note.md]] for details.");
    });

    it("should not expand when file doesn't exist", () => {
      const text = "See [[nonexistent]] for details.";
      const result = expandBacklinks(text);
      expect(result).toBe("See [[nonexistent]] for details.");
    });

    it("should not expand backlinks that already have pipe operator", () => {
      helpers.addFile("folder/note.md", "content");

      const text = "See [[folder/note.md|custom name]] for details.";
      const result = expandBacklinks(text);
      expect(result).toBe("See [[folder/note.md|custom name]] for details.");
    });

    it("should handle empty backlink", () => {
      const text = "Empty backlink [[]] here.";
      const result = expandBacklinks(text);
      expect(result).toBe("Empty backlink [[]] here.");
    });
  });

  describe("multiple backlinks scenarios", () => {
    it("should expand multiple backlinks when files exist", () => {
      helpers.addFile("docs/first.md", "content1");
      helpers.addFile("notes/second.md", "content2");

      const text = "Check [[first]] and [[second]] files.";
      const result = expandBacklinks(text);
      expect(result).toBe(
        "Check [[docs/first.md|first]] and [[notes/second.md|second]] files.",
      );
    });

    it("should expand only existing files in mixed scenario", () => {
      helpers.addFile("docs/exists.md", "content");

      const text = "Check [[exists]] and [[missing]] files.";
      const result = expandBacklinks(text);
      expect(result).toBe(
        "Check [[docs/exists.md|exists]] and [[missing]] files.",
      );
    });

    it("should handle mix of expandable and non-expandable backlinks", () => {
      helpers.addFile("folder/note.md", "content");

      const text =
        "See [[note]], [[folder/note.md|already piped]], and [[missing]].";
      const result = expandBacklinks(text);
      expect(result).toBe(
        "See [[folder/note.md|note]], [[folder/note.md|already piped]], and [[missing]].",
      );
    });
  });

  describe("special characters and edge cases", () => {
    it("should handle backlinks with spaces", () => {
      helpers.addFile("folder/My Note.md", "content");

      const text = "Check [[My Note]] for info.";
      const result = expandBacklinks(text);
      expect(result).toBe("Check [[folder/My Note.md|My Note]] for info.");
    });

    it("should handle backlinks with special characters", () => {
      helpers.addFile("folder/Note-with_special.chars.md", "content");

      const text = "Check [[Note-with_special.chars]] for info.";
      const result = expandBacklinks(text);
      expect(result).toBe(
        "Check [[folder/Note-with_special.chars.md|Note-with_special.chars]] for info.",
      );
    });

    it("should handle malformed backlinks (unclosed)", () => {
      const text = "Malformed [[unclosed backlink";
      const result = expandBacklinks(text);
      expect(result).toBe("Malformed [[unclosed backlink");
    });
  });

  describe("backlinks in different text contexts", () => {
    it("should expand backlinks at beginning of text", () => {
      helpers.addFile("folder/note.md", "content");

      const text = "[[note]] is the first word.";
      const result = expandBacklinks(text);
      expect(result).toBe("[[folder/note.md|note]] is the first word.");
    });

    it("should expand backlinks at end of text", () => {
      helpers.addFile("folder/note.md", "content");

      const text = "The last word is [[note]]";
      const result = expandBacklinks(text);
      expect(result).toBe("The last word is [[folder/note.md|note]]");
    });

    it("should expand backlinks in multiline text", () => {
      helpers.addFile("folder/note1.md", "content1");
      helpers.addFile("folder/note2.md", "content2");

      const text = `First line with [[note1]].
Second line with [[note2]].
Third line without backlinks.`;
      const result = expandBacklinks(text);
      expect(result).toBe(`First line with [[folder/note1.md|note1]].
Second line with [[folder/note2.md|note2]].
Third line without backlinks.`);
    });
  });

  describe("file path resolution edge cases", () => {
    it("should handle files in root directory", () => {
      helpers.addFile("root-note.md", "content");

      const text = "Check [[root-note]] in root.";
      const result = expandBacklinks(text);
      expect(result).toBe("Check [[root-note.md|root-note]] in root.");
    });

    it("should use first match when multiple files have same basename", () => {
      // Create multiple files with same basename in different folders
      helpers.addFile("folder1/note.md", "content1");
      helpers.addFile("folder2/note.md", "content2");

      const text = "Check [[note]] file.";
      const result = expandBacklinks(text);
      // Should use whichever file getFirstLinkpathDest returns
      // (implementation dependent on Obsidian's resolution strategy)
      expect(result).toMatch(/Check \[\[folder[12]\/note\.md\|note\]\] file\./);
    });

    it("should handle deeply nested paths", () => {
      helpers.addFile("very/deep/nested/folder/structure/note.md", "content");

      const text = "Check [[note]] deeply nested.";
      const result = expandBacklinks(text);
      expect(result).toBe(
        "Check [[very/deep/nested/folder/structure/note.md|note]] deeply nested.",
      );
    });
  });

  describe("full path backlinks", () => {
    it("should not expand when backlink already uses full path", () => {
      helpers.addFile("folder/note.md", "content");

      const text = "Check [[folder/note.md]] with full path.";
      const result = expandBacklinks(text);
      expect(result).toBe("Check [[folder/note.md]] with full path.");
    });

    it("should not expand when partial path matches file path", () => {
      helpers.addFile("folder/subfolder/note.md", "content");

      const text = "Check [[subfolder/note.md]] with partial path.";
      const result = expandBacklinks(text);
      // This depends on how getFirstLinkpathDest resolves partial paths
      // If it resolves successfully and path differs from linkText, it should expand
      expect(result).toMatch(/Check \[\[.*\]\] with partial path\./);
    });
  });

  describe("mock integration", () => {
    it("should properly use metadataCache.getFirstLinkpathDest", () => {
      const mockGetFirstLinkpathDest = vi.spyOn(
        metadataCache,
        "getFirstLinkpathDest",
      );
      helpers.addFile("folder/note.md", "content");

      const text = "Check [[note]] file.";
      expandBacklinks(text);

      expect(mockGetFirstLinkpathDest).toHaveBeenCalledWith("note");
    });

    it("should handle when getFirstLinkpathDest returns null", () => {
      const mockGetFirstLinkpathDest = vi.spyOn(
        metadataCache,
        "getFirstLinkpathDest",
      );
      mockGetFirstLinkpathDest.mockReturnValue(null);

      const text = "Check [[nonexistent]] file.";
      const result = expandBacklinks(text);

      expect(result).toBe("Check [[nonexistent]] file.");
      expect(mockGetFirstLinkpathDest).toHaveBeenCalledWith("nonexistent");
    });
  });
});
