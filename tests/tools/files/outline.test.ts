import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute as outlineToolExecute } from "../../../src/tools/files/outline";
import {
  helpers,
  vault as mockVault,
  metadataCache,
} from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";
import { SessionStore } from "../../../src/chat/session-store.svelte.ts";

describe("outlineToolExecute", () => {
  let toolExecOptions: ToolCallOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;
  let sessionStore: SessionStore;

  beforeEach(async () => {
    vi.resetAllMocks();
    await helpers.reset();

    vault = new VaultOverlay(mockVault);
    mockAbortController = new AbortController();
    sessionStore = new SessionStore(vault);

    toolExecOptions = {
      toolCallId: "test-outline-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        sessionStore,
        metadataCache,
      }),
      abortSignal: mockAbortController.signal,
    };
  });

  // --- Input Validation Tests ---
  it("should return error if file does not exist", async () => {
    const params = { file_path: "/nonexistent.md" };
    const result = await outlineToolExecute(params, toolExecOptions);
    invariant(typeof result === "object" && "error" in result, "Expected error object");
    expect(result.error).toBe("File not found");
    expect(result.message).toContain("File not found: /nonexistent.md");
  });

  it("should return error if file is not markdown", async () => {
    await vault.create("/test/document.txt", "Some text content");
    const params = { file_path: "/test/document.txt" };
    const result = await outlineToolExecute(params, toolExecOptions);
    invariant(typeof result === "object" && "error" in result, "Expected error object");
    expect(result.error).toBe("Invalid file type");
    expect(result.message).toContain("Outline tool only supports markdown files");
  });

  // --- Successful Operation Tests ---
  it("should extract outline from simple markdown with headings", async () => {
    const markdownContent = `# Introduction
Some intro text here.

## Getting Started
Getting started instructions.

### Prerequisites
List of requirements.

## Configuration
Configuration details.

# Advanced Topics
Advanced content here.
`;

    await vault.create("/test/simple.md", markdownContent);
    const params = { file_path: "/test/simple.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.file_path).toBe("/test/simple.md");
    expect(result.total_lines).toBe(markdownContent.split('\n').length);
    expect(result.outline).toHaveLength(5);

    // Check first heading
    expect(result.outline[0]).toEqual({
      level: 1,
      text: "Introduction",
      offset: 1,
      limit: 3, // Lines until next heading
    });

    // Check nested heading
    expect(result.outline[2]).toEqual({
      level: 3,
      text: "Prerequisites",
      offset: 7,
      limit: 3,
    });

    // Check last heading
    expect(result.outline[4]).toEqual({
      level: 1,
      text: "Advanced Topics",
      offset: 13,
      limit: 3, // Lines until end of file
    });
  });

  it("should handle markdown with no headings", async () => {
    const markdownContent = `This is just regular text.

Some more text without any headings.

- List item 1
- List item 2
`;

    await vault.create("/test/no-headings.md", markdownContent);
    const params = { file_path: "/test/no-headings.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.file_path).toBe("/test/no-headings.md");
    expect(result.total_lines).toBe(markdownContent.split('\n').length);
    expect(result.outline).toHaveLength(0);
  });

  it("should handle empty markdown file", async () => {
    await vault.create("/test/empty.md", "");
    const params = { file_path: "/test/empty.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.file_path).toBe("/test/empty.md");
    expect(result.total_lines).toBe(1); // Empty file has one line
    expect(result.outline).toHaveLength(0);
  });

  it("should handle headings with complex formatting", async () => {
    const markdownContent = `# **Bold** and *Italic* Heading

## Heading with \`inline code\`

### Heading with [link](https://example.com)

#### Heading with **mixed** \`formatting\` and *emphasis*
`;

    await vault.create("/test/formatted.md", markdownContent);
    const params = { file_path: "/test/formatted.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.outline).toHaveLength(4);

    expect(result.outline[0].text).toBe("Bold and Italic Heading");
    expect(result.outline[1].text).toBe("Heading with inline code");
    expect(result.outline[2].text).toBe("Heading with link");
    expect(result.outline[3].text).toBe("Heading with mixed formatting and emphasis");
  });

  it("should calculate section sizes correctly", async () => {
    const markdownContent = `# Section 1
Line 1
Line 2
Line 3

## Section 2
Line 1
Line 2

### Section 3
Line 1

# Section 4
Final line`;

    await vault.create("/test/sections.md", markdownContent);
    const params = { file_path: "/test/sections.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.outline).toHaveLength(4);

    expect(result.outline[0]).toEqual({
      level: 1,
      text: "Section 1",
      offset: 1,
      limit: 5, // Lines until "## Section 2"
    });

    expect(result.outline[1]).toEqual({
      level: 2,
      text: "Section 2",
      offset: 6,
      limit: 4, // Lines until "### Section 3"
    });

    expect(result.outline[2]).toEqual({
      level: 3,
      text: "Section 3",
      offset: 10,
      limit: 3, // Lines until "# Section 4"
    });

    expect(result.outline[3]).toEqual({
      level: 1,
      text: "Section 4",
      offset: 13,
      limit: 2, // Lines until end of file
    });
  });

  it("should handle headings at different levels", async () => {
    const markdownContent = `###### Level 6 Heading
Content

##### Level 5 Heading
More content

#### Level 4 Heading
Even more content

### Level 3 Heading
Content

## Level 2 Heading
Content

# Level 1 Heading
Final content`;

    await vault.create("/test/levels.md", markdownContent);
    const params = { file_path: "/test/levels.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.outline).toHaveLength(6);

    expect(result.outline[0].level).toBe(6);
    expect(result.outline[1].level).toBe(5);
    expect(result.outline[2].level).toBe(4);
    expect(result.outline[3].level).toBe(3);
    expect(result.outline[4].level).toBe(2);
    expect(result.outline[5].level).toBe(1);
  });

  // --- Error Handling Tests ---
  it("should handle vault read errors", async () => {
    await vault.create("/test/vault-error.md", "# Test");
    
    // Mock vault.read to throw an error
    vi.spyOn(vault, "read").mockRejectedValue(new Error("Vault read failed"));

    const params = { file_path: "/test/vault-error.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "error" in result, "Expected error object");
    expect(result.error).toBe("Parse failed");
    expect(result.message).toContain("Vault read failed");
  });

  // --- Edge Cases ---
  it("should handle file paths with spaces", async () => {
    const markdownContent = `# Test Heading
Content here`;

    await vault.create("/test/file with spaces.md", markdownContent);
    const params = { file_path: "/test/file with spaces.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.file_path).toBe("/test/file with spaces.md");
    expect(result.outline).toHaveLength(1);
    expect(result.outline[0].text).toBe("Test Heading");
  });

  it("should handle headings with only whitespace", async () => {
    const markdownContent = `# 
Content

##   
More content

###      
Even more content`;

    await vault.create("/test/whitespace.md", markdownContent);
    const params = { file_path: "/test/whitespace.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    // Empty headings should be filtered out
    expect(result.outline).toHaveLength(0);
  });

  it("should handle single line file with heading", async () => {
    await vault.create("/test/single-line.md", "# Single Line Heading");
    const params = { file_path: "/test/single-line.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.outline).toHaveLength(1);
    expect(result.outline[0]).toEqual({
      level: 1,
      text: "Single Line Heading",
      offset: 1,
      limit: 1,
    });
  });

  it("should handle markdown with GFM tables", async () => {
    const markdownContent = `# Table Section

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |

## Another Section
Content here`;

    await vault.create("/test/tables.md", markdownContent);
    const params = { file_path: "/test/tables.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.outline).toHaveLength(2);
    expect(result.outline[0].text).toBe("Table Section");
    expect(result.outline[1].text).toBe("Another Section");
  });

  it("should handle headings with special characters", async () => {
    const markdownContent = `# Heading with @mentions and #tags

## Code \`blocks\` & <html> entities

### Special chars: $€£¥

#### Emoji heading 🎉 🚀
`;

    await vault.create("/test/special-chars.md", markdownContent);
    const params = { file_path: "/test/special-chars.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.outline).toHaveLength(4);
    expect(result.outline[0].text).toBe("Heading with @mentions and #tags");
    expect(result.outline[1].text).toBe("Code blocks & <html> entities");
    expect(result.outline[2].text).toBe("Special chars: $€£¥");
    expect(result.outline[3].text).toBe("Emoji heading 🎉 🚀");
  });

  it("should handle very long headings", async () => {
    const longHeading = "A".repeat(200);
    const markdownContent = `# ${longHeading}

Content here`;

    await vault.create("/test/long-heading.md", markdownContent);
    const params = { file_path: "/test/long-heading.md" };
    const result = await outlineToolExecute(params, toolExecOptions);

    invariant(typeof result === "object" && "outline" in result, "Expected outline result");
    expect(result.outline).toHaveLength(1);
    expect(result.outline[0].text).toBe(longHeading);
  });
});