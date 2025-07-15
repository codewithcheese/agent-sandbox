import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute as readToolExecute } from "../../../src/tools/files/read";
import {
  helpers,
  vault as mockVault,
  metadataCache,
} from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";
import { encodeBase64 } from "$lib/utils/base64.ts";
import { SessionStore } from "../../../src/chat/session-store.svelte.ts";

describe("readToolExecute", () => {
  let toolExecOptions: ToolCallOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;
  let sessionStore: SessionStore;

  const formatExpectedTextOutput = (
    filePath: string,
    content: string,
    startLine: number,
    totalLines: number,
    numReadLines: number,
  ) => {
    return `File: ${filePath}\nLines ${startLine}-${startLine + numReadLines - 1} of ${totalLines}:\n\`\`\`\n${content}\n\`\`\``;
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    await helpers.reset(); // Reset the mock vault state

    vault = new VaultOverlay(mockVault); // Use your VaultOverlaySvelte
    mockAbortController = new AbortController();
    sessionStore = new SessionStore(vault);

    toolExecOptions = {
      toolCallId: "test-read-tool-call",
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
    const params = { file_path: "/nonexistent.txt" };
    const result = await readToolExecute(params, toolExecOptions);
    invariant(typeof result !== "string", "Expected error object");
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File does not exist");
  });

  it("should return error if path is a directory", async () => {
    await vault.createFolder("/test/is_a_directory");
    const params = { file_path: "/test/is_a_directory" };
    const result = await readToolExecute(params, toolExecOptions);
    invariant(typeof result !== "string", "Expected error object");
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Path is a directory");
  });

  it("should return error for disallowed binary files", async () => {
    await vault.createBinary(`/test/binary.exe`, new ArrayBuffer(10));
    const params = { file_path: `/test/binary.exe` };
    const result = await readToolExecute(params, toolExecOptions);
    invariant(typeof result !== "string", "Expected error object");
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain(`cannot read binary files of type .exe`);
  });

  it("should return error for empty image files", async () => {
    await vault.createBinary(`/test/empty_image.png`, new ArrayBuffer(0));
    const params = { file_path: `/test/empty_image.png` };
    const result = await readToolExecute(params, toolExecOptions);
    invariant(typeof result !== "string", "Expected error object");
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Empty image files cannot be processed");
  });

  it("should return error for large text file without offset/limit", async () => {
    const largeContent = "a".repeat(100);
    await vault.create("/test/largefile.txt", largeContent);
    const params = { file_path: "/test/largefile.txt" };
    const options: ToolCallOptionsWithContext = {
      ...toolExecOptions,
      getContext: () => ({
        vault,
        config: { MAX_TEXT_FILE_SIZE: 10 },
        sessionStore,
        metadataCache,
      }),
    };
    const result = await readToolExecute(params, options);
    invariant(typeof result !== "string", "Expected error object");
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("exceeds maximum allowed size");
  });

  // --- Text File Reading Tests ---
  it("should read a short text file correctly", async () => {
    const shortContent = "a".repeat(10) + "\n" + "b".repeat(10);
    await vault.create("/test/short.txt", shortContent);
    const params = { file_path: "/test/short.txt" };
    const result = await readToolExecute(params, toolExecOptions);

    const lines = shortContent.split("\n");
    const numberedContent = lines
      .map((line, i) => `${String(i + 1).padStart(6)}\t${line}`)
      .join("\n");
    const expected = formatExpectedTextOutput(
      "/test/short.txt",
      numberedContent,
      1,
      lines.length,
      lines.length,
    );
    expect(result).toBe(expected);
  });

  it("should handle empty text file", async () => {
    await vault.create("/test/empty.txt", "");
    const params = { file_path: "/test/empty.txt" };
    const result = await readToolExecute(params, toolExecOptions);
    expect(result).toContain("empty");
  });

  it("should handle out of bounds text file", async () => {
    await vault.create("/test/empty.txt", "");
    const params = { file_path: "/test/empty.txt", offset: 100 };
    const result = await readToolExecute(params, toolExecOptions);
    expect(result).toContain("out of bounds");
  });

  it("should truncate long lines in text files", async () => {
    const MAX_LINE_LENGTH = 2000; // Default config value
    const longLineContent =
      "L" + "o".repeat(MAX_LINE_LENGTH + 10) + "ng line 1\nAnother normal line";

    await vault.create("/test/longlines.txt", longLineContent);
    const params = { file_path: "/test/longlines.txt" };
    const options = {
      ...toolExecOptions,
      getContext: () => ({
        vault,
        config: { MAX_LINE_LENGTH },
        sessionStore,
        metadataCache,
      }),
    };
    const result = await readToolExecute(params, options);
    invariant(
      typeof result === "string",
      `Expected result to be string. Got: ${JSON.stringify(result)}`,
    );
    const contentLine = result
      .split("\n")
      .find((line) => line.includes("Loooo"));
    expect(contentLine).toBeDefined();
    expect(contentLine).toContain("[truncated]");
  });

  it("should respect offset and limit for text files", async () => {
    const DEFAULT_LINE_LIMIT = 2000; // Default config value
    const manyLinesContent = Array.from(
      { length: DEFAULT_LINE_LIMIT + 50 },
      (_, i) => `Line ${i + 1}`,
    ).join("\n");

    await vault.create("/test/manylines.txt", manyLinesContent);
    const params = { file_path: "/test/manylines.txt", offset: 3, limit: 2 };
    const result = await readToolExecute(params, toolExecOptions);

    const allLines = manyLinesContent.split("\n");
    const selected = allLines.slice(2, 4); // offset 3 is index 2, limit 2
    const numberedContent = selected
      .map((line, i) => `${String(3 + i).padStart(6)}\t${line}`)
      .join("\n");
    const expected = formatExpectedTextOutput(
      "/test/manylines.txt",
      numberedContent,
      3,
      allLines.length,
      selected.length,
    );
    expect(result).toBe(expected);
  });

  it("should handle offset beyond file length", async () => {
    const shortContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    await vault.create("/test/short.txt", shortContent);
    const params = { file_path: "/test/short.txt", offset: 10, limit: 5 };
    const result = await readToolExecute(params, toolExecOptions);
    expect(result).toContain("out of bounds");
  });

  it("should handle limit exceeding available lines after offset", async () => {
    await vault.create("/test/short.txt", "L1\nL2\nL3\nL4\nL5");
    const params = { file_path: "/test/short.txt", offset: 4, limit: 5 }; // 5 lines total, offset 4 means lines 4, 5
    const result = await readToolExecute(params, toolExecOptions);

    const allLines = "L1\nL2\nL3\nL4\nL5".split("\n");
    const selected = allLines.slice(3); // offset 4 is index 3
    const numberedContent = selected
      .map((line, i) => `${String(4 + i).padStart(6)}\t${line}`)
      .join("\n");
    const expected = formatExpectedTextOutput(
      "/test/short.txt",
      numberedContent,
      4,
      allLines.length,
      selected.length,
    );
    expect(result).toBe(expected);
  });

  it("should truncate overall output if formatted text is too long", async () => {
    const longContentForTest =
      "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8\nLine9\nLine10"; // Approx 60 chars
    await vault.create("/test/output_truncate.txt", longContentForTest);
    const params = { file_path: "/test/output_truncate.txt" };
    const options: ToolCallOptionsWithContext = {
      ...toolExecOptions,
      getContext: () => ({
        vault,
        config: {
          MAX_TEXT_FILE_SIZE: 80,
        },
        sessionStore,
        metadataCache,
      }),
    };
    const result = await readToolExecute(params, options);

    invariant(
      typeof result === "string",
      `Expected string result. Received: ${JSON.stringify(result)}`,
    );
    expect(result).toContain("...[output truncated due to excessive length]");
  });

  // --- Image File Reading Tests ---
  it("should read a small image file and return base64 data structure", async () => {
    const data = new ArrayBuffer(32);
    await vault.createBinary("/test/image.png", data);

    const params = { file_path: "/test/image.png" };
    const result = await readToolExecute(params, toolExecOptions);

    invariant(
      typeof result === "object",
      `Expected result to be object. Got: ${result}`,
    );
    expect(result.type).toBe("image");
    expect(result.file.base64).toBe(encodeBase64(data));
    expect(result.file.type).toBe("image/png");
    expect(result.file.originalSize).toBe(32);
    expect(result.file.file_path).toBe("/test/image.png");
  });

  it("should return placeholder for very large image files", async () => {
    const MAX_IMAGE_SIZE_BYTES = 3.75 * 1024 * 1024; // Default config value
    const data = new ArrayBuffer(MAX_IMAGE_SIZE_BYTES + 1000);
    await vault.createBinary("/test/large_image.jpg", data);

    const params = { file_path: "/test/large_image.jpg" };
    const options = {
      ...toolExecOptions,
      getContext: () => ({
        vault,
        config: { MAX_IMAGE_SIZE_BYTES },
        sessionStore,
        metadataCache,
      }),
    };
    const result = await readToolExecute(params, options);

    invariant(
      typeof result === "object",
      `Expected result to be object. Got: ${result}`,
    );
    expect(result.error).toBeDefined();
    expect(result.message).toContain("Image is too large");
    expect(result.file_path).toBe("/test/large_image.jpg");
  });

  // --- Abort Test ---
  it("should handle aborted operation during text file read", async () => {
    await vault.create("/test/abort_target.txt", "L1\nL2\nL3\nL4\nL5");
    mockAbortController.abort();
    const params = { file_path: "/test/abort_target.txt" };
    await expect(() =>
      readToolExecute(params, toolExecOptions),
    ).rejects.toThrow("The operation was aborted.");
  });

  it("should handle aborted operation during image file read", async () => {
    mockAbortController.abort();
    await vault.createBinary("/test/abort_image.png", new ArrayBuffer(100));
    const params = { file_path: "/test/abort_image.png" };
    await expect(() =>
      readToolExecute(params, toolExecOptions),
    ).rejects.toThrow("The operation was aborted.");
  });

  // --- Edge Cases ---
  it("should handle file path with spaces", async () => {
    await vault.create("/test/file with spaces.txt", "content");
    const params = { file_path: "/test/file with spaces.txt" };
    const result = await readToolExecute(params, toolExecOptions);
    const numberedContent = `${String(1).padStart(6)}\tcontent`;
    const expected = formatExpectedTextOutput(
      "/test/file with spaces.txt",
      numberedContent,
      1,
      1,
      1,
    );
    expect(result).toBe(expected);
  });

  it("should handle file with only newlines", async () => {
    await vault.create("/test/newlines.txt", "\n\n\n");
    const params = { file_path: "/test/newlines.txt" };
    const result = await readToolExecute(params, toolExecOptions);
    const numberedContent = [
      `${String(1).padStart(6)}\t`,
      `${String(2).padStart(6)}\t`,
      `${String(3).padStart(6)}\t`,
      `${String(4).padStart(6)}\t`, // Split results in an extra empty string for trailing newline
    ].join("\n");
    const expected = formatExpectedTextOutput(
      "/test/newlines.txt",
      numberedContent,
      1,
      4,
      4,
    );
    expect(result).toBe(expected);
  });

  it("should correctly handle 1-indexed offset and limit", async () => {
    await vault.create("/test/offset_test.txt", "L1\nL2\nL3\nL4\nL5");
    const params = { file_path: "/test/offset_test.txt", offset: 2, limit: 2 }; // Read L2, L3
    const result = await readToolExecute(params, toolExecOptions);
    const numberedContent = [
      `${String(2).padStart(6)}\tL2`,
      `${String(3).padStart(6)}\tL3`,
    ].join("\n");
    const expected = formatExpectedTextOutput(
      "/test/offset_test.txt",
      numberedContent,
      2,
      5,
      2,
    );
    expect(result).toBe(expected);
  });

  // --- .chat.md File Handling Tests ---
  it("should truncate .chat.md files at chat data section", async () => {
    const chatContent = `## User
*1/1/2024, 10:30:00 AM*

Hello, how are you?

## Assistant
*1/1/2024, 10:30:15 AM*

I'm doing well, thank you!

%%
# Chat Data
\`\`\`chatdata
eyJ2ZXJzaW9uIjoxLCJwYXlsb2FkIjp7ImlkIjoidGVzdC1pZCIsIm1lc3NhZ2VzIjpbXSwidmF1bHQiOnVuZGVmaW5lZCwib3B0aW9ucyI6eyJtYXhTdGVwcyI6MTAwLCJ0ZW1wZXJhdHVyZSI6MC43LCJ0aGlua2luZ0VuYWJsZWQiOmZhbHNlLCJtYXhUb2tlbnMiOjQwMDAsInRoaW5raW5nVG9rZW5zQnVkZ2V0IjoxMjAwfSwiY3JlYXRlZEF0IjoiMjAyNC0wMS0wMVQxMDowMDowMC4wMDBaIiwidXBkYXRlZEF0IjoiMjAyNC0wMS0wMVQxMDozMDowMC4wMDBaIn19
\`\`\`
%%`;

    await vault.create("/test/conversation.chat.md", chatContent);
    const params = { file_path: "/test/conversation.chat.md" };
    const result = await readToolExecute(params, toolExecOptions);

    invariant(typeof result === "string", "Expected string result");
    
    // Should contain the readable content
    expect(result).toContain("## User");
    expect(result).toContain("Hello, how are you?");
    expect(result).toContain("## Assistant");
    expect(result).toContain("I'm doing well, thank you!");
    
    // Should NOT contain the encoded data section
    expect(result).not.toContain("# Chat Data");
    expect(result).not.toContain("chatdata");
    expect(result).not.toContain("eyJ2ZXJzaW9u");
    
    // Should have correct line count (only the visible markdown content)
    const allLines = chatContent.split('\n');
    const chatDataIndex = allLines.findIndex(line => line.trim() === '%%');
    const visibleLines = allLines.slice(0, chatDataIndex);
    expect(result).toContain(`Lines 1-${visibleLines.length} of ${visibleLines.length}:`);
  });

  it("should handle .chat.md files without chat data section", async () => {
    const chatContent = `## User
*1/1/2024, 10:30:00 AM*

Hello, this is a malformed chat file without encoded data.

## Assistant
*1/1/2024, 10:30:15 AM*

This shouldn't happen, but let's handle it gracefully.`;

    await vault.create("/test/malformed.chat.md", chatContent);
    const params = { file_path: "/test/malformed.chat.md" };
    const result = await readToolExecute(params, toolExecOptions);

    invariant(typeof result === "string", "Expected string result");
    
    // Should return the full content since there's no %% marker
    expect(result).toContain("## User");
    expect(result).toContain("malformed chat file");
    expect(result).toContain("## Assistant");
    expect(result).toContain("handle it gracefully");
    
    const allLines = chatContent.split('\n');
    expect(result).toContain(`Lines 1-${allLines.length} of ${allLines.length}:`);
  });

  it("should respect offset and limit parameters for .chat.md files", async () => {
    const chatContent = `## User
*1/1/2024, 10:30:00 AM*

Hello, how are you?

## Assistant
*1/1/2024, 10:30:15 AM*

I'm doing well, thank you!

%%
# Chat Data
\`\`\`chatdata
encoded-data-here
\`\`\`
%%`;

    await vault.create("/test/chat-with-params.chat.md", chatContent);
    const params = { file_path: "/test/chat-with-params.chat.md", offset: 3, limit: 2 };
    const result = await readToolExecute(params, toolExecOptions);

    invariant(typeof result === "string", "Expected string result");
    
    // Should contain lines 3-4 of the visible content
    expect(result).toContain("Hello, how are you?");
    expect(result).not.toContain("## User"); // Line 1, not included
    expect(result).not.toContain("# Chat Data"); // Should be truncated anyway
    expect(result).toContain("Lines 3-4 of 10:"); // 10 lines before %% marker
  });
});
