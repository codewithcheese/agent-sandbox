import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSystemContent,
  stripFrontmatter,
  unescapeTags,
} from "../src/chat/system.ts";
import type { TFile, Vault, MetadataCache, CachedMetadata } from "obsidian";

// Mock dependencies
const mockVault = {
  read: vi.fn(),
} as unknown as Vault;

const mockMetadataCache = {
  getFileCache: vi.fn(),
} as unknown as MetadataCache;

const mockFile = {
  path: "test-agent.md",
  basename: "test-agent",
} as TFile;

describe("createSystemContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should process a simple agent file without frontmatter", async () => {
      const content = "You are a helpful assistant named {{ agent_name }}.";

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(
        {} as CachedMetadata,
      );
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
      );

      expect(result).toBe("You are a helpful assistant named test-agent.");
    });

    it("should process frontmatter variables", async () => {
      const content = `---
role: coding assistant
specialty: TypeScript
---
You are a {{ role }} specialized in {{ specialty }}.`;

      const metadata = {
        frontmatter: {
          role: "coding assistant",
          specialty: "TypeScript",
        },
      } as CachedMetadata;

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(metadata);
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
      );

      expect(result).toContain(
        "You are a coding assistant specialized in TypeScript.",
      );
      expect(result).not.toContain("---"); // Frontmatter should be stripped
    });

    it("should use custom agent_name from frontmatter", async () => {
      const content = `---
agent_name: CustomBot
---
Hello, I am {{ agent_name }}.`;

      const metadata = {
        frontmatter: {
          agent_name: "CustomBot",
        },
      } as CachedMetadata;

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(metadata);
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
      );

      expect(result).toContain("Hello, I am CustomBot.");
    });

    it("should process additional data from options", async () => {
      const content = "Current user: {{ user_id }}";

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(
        {} as CachedMetadata,
      );
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
        {
          additionalData: {
            user_id: "user123",
          },
        },
      );

      expect(result).toContain("Current user: user123");
    });
  });

  describe("template processing", () => {
    it("should process fileTree filter", async () => {
      const content = 'Files: {{ "" | fileTree }}';

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(
        {} as CachedMetadata,
      );
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
      );

      expect(result).toContain("Files:"); // fileTree filter should process
    });

    it("should include currentDateTime variable", async () => {
      const content = "Current time: {{ currentDateTime }}";

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(
        {} as CachedMetadata,
      );
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
      );

      expect(result).toMatch(/Current time: \w+day, \w+ \d+, \d{4}/); // Should match date format
    });
  });

  describe("error handling", () => {
    it("should throw meaningful error for undefined variables with file path", async () => {
      const content = "Hello {{ undefined_var }}";

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(
        {} as CachedMetadata,
      );
      vi.mocked(mockVault.read).mockResolvedValue(content);

      await expect(
        createSystemContent(mockFile, mockVault, mockMetadataCache, {
          template: { throwOnUndefined: true },
        }),
      ).rejects.toThrow("test-agent.md"); // Should include file path in error
    });

    it("should handle undefined variables gracefully when throwOnUndefined is false", async () => {
      const content = "Hello {{ undefined_var }}";

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(
        {} as CachedMetadata,
      );
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
        { template: { throwOnUndefined: false } },
      );

      expect(result).toBe("Hello "); // Undefined var should render as empty
    });

    it("should handle schema validation errors", async () => {
      const content = `---
schema.name: string
schema.required: ["name"]
age: 25
---
Hello {{ name }}`;

      const metadata = {
        frontmatter: {
          "schema.name": "string",
          "schema.required": ["name"],
          age: 25,
          // Missing required 'name' field
        },
      } as CachedMetadata;

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(metadata);
      vi.mocked(mockVault.read).mockResolvedValue(content);

      await expect(
        createSystemContent(mockFile, mockVault, mockMetadataCache),
      ).rejects.toThrow("Data validation failed");
    });
  });

  describe("content transformations", () => {
    it("should unescape HTML tags", async () => {
      const content = "Use \\<tag> for markup";

      vi.mocked(mockMetadataCache.getFileCache).mockReturnValue(
        {} as CachedMetadata,
      );
      vi.mocked(mockVault.read).mockResolvedValue(content);

      const result = await createSystemContent(
        mockFile,
        mockVault,
        mockMetadataCache,
      );

      expect(result).toContain("Use <tag> for markup");
    });
  });
});

describe("utility functions", () => {
  describe("stripFrontmatter", () => {
    it("should remove YAML frontmatter", () => {
      const content = `---
title: Test
author: User
---
Content here`;

      const result = stripFrontmatter(content);

      expect(result).toBe("Content here");
      expect(result).not.toContain("---");
    });

    it("should handle content without frontmatter", () => {
      const content = "Just regular content";

      const result = stripFrontmatter(content);

      expect(result).toBe("Just regular content");
    });

    it("should handle different line endings", () => {
      const content = `---\r\ntitle: Test\r\n---\r\nContent`;

      const result = stripFrontmatter(content);

      expect(result).toBe("Content");
    });
  });

  describe("unescapeTags", () => {
    it("should unescape opening tags", () => {
      const text = "Use \\<div> for containers";

      const result = unescapeTags(text);

      expect(result).toBe("Use <div> for containers");
    });

    it("should unescape closing tags", () => {
      const text = "End with \\</div>";

      const result = unescapeTags(text);

      expect(result).toBe("End with </div>");
    });

    it("should handle multiple escaped tags", () => {
      const text = "Use \\<div>content\\</div> and \\<span>text\\</span>";

      const result = unescapeTags(text);

      expect(result).toBe("Use <div>content</div> and <span>text</span>");
    });

    it("should leave unescaped tags alone", () => {
      const text = "Regular <div> tags stay the same";

      const result = unescapeTags(text);

      expect(result).toBe("Regular <div> tags stay the same");
    });
  });
});
