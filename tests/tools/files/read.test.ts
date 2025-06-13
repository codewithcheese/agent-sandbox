import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute as readToolExecute } from "../../../src/tools/files/read";
import { helpers, vault as mockVault } from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolExecutionOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";
import { encodeBase64 } from "$lib/utils/base64.ts";

describe("readToolExecute", () => {
  let toolExecOptions: ToolExecutionOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;

  const formatExpectedTextOutput = (
    filePath: string,
    content: string,
    startLine: number,
    totalLines: number,
    numReadLines: number,
  ) => {
    return `File: ${filePath}\nLines ${startLine}-${startLine + numReadLines - 1} of ${totalLines}:\n\`\`\`\n${content}\n\`\`\``;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    helpers.reset(); // Reset the mock vault state

    vault = new VaultOverlay(mockVault); // Use your VaultOverlaySvelte
    mockAbortController = new AbortController();

    toolExecOptions = {
      toolCallId: "test-read-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        sessionStore: {},
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
    const options: ToolExecutionOptionsWithContext = {
      ...toolExecOptions,
      getContext: () => ({
        vault,
        config: { MAX_TEXT_FILE_SIZE_NO_OFFSET_LIMIT: 10 },
        sessionStore: {},
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
        sessionStore: {},
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
    const options: ToolExecutionOptionsWithContext = {
      ...toolExecOptions,
      getContext: () => ({
        vault,
        config: {
          MAX_TEXT_FILE_SIZE_NO_OFFSET_LIMIT: 80,
        },
        sessionStore: {},
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
        sessionStore: {},
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
    const result = await readToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string",
      "Expected error object. Got: " + result,
    );
    expect(result.error).toBe("Operation aborted");
  });

  it("should handle aborted operation during image file read", async () => {
    mockAbortController.abort();
    await vault.createBinary("/test/abort_image.png", new ArrayBuffer(100));
    const params = { file_path: "/test/abort_image.png" };
    const result = await readToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string",
      "Expected error object. Got: " + result,
    );
    expect(result.error).toBe("Operation aborted");
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
});
