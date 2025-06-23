import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute as listExecute } from "../../../src/tools/files/list.ts";
import { helpers, vault as mockVault } from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";

describe("LS Tool", () => {
  let toolExecOptions;

  let vault: VaultOverlay;

  beforeEach(async () => {
    vi.resetAllMocks();
    await helpers.reset(); // Reset the mock vault state

    toolExecOptions = {
      toolCallId: "test-tool-call-id",
      messages: [],
      getContext: () => {
        return {
          vault,
        };
      },
      abortSignal: new AbortController().signal,
    };

    vault = new VaultOverlay(mockVault);
    // Set up mock vault files for testing
    vault.create("/test/project/file1.txt", "Content of file1");
    vault.createFolder("/test/project/subdir");
    vault.create("/test/project/subdir/file2.ts", "Content of file2");
    vault.create("/test/project/.hiddenfile", "Hidden content");
  });

  it("should list contents of the root directory if path is empty", async () => {
    const params = { path: "" };
    const result = await listExecute(params, toolExecOptions);

    const expectedOutput = `- /\n  - test/\n    - project/\n      - file1.txt\n      - subdir/\n        - file2.ts`;
    expect(result).toBe(expectedOutput);
  });

  it("should list contents of a specified absolute path", async () => {
    const params = { path: "/test/project" };
    const result = await listExecute(params, toolExecOptions);

    const expectedOutput = `- /test/project/\n  - file1.txt\n  - subdir/\n    - file2.ts`;
    expect(result).toBe(expectedOutput);
  });

  it("should list empty subdirectories", async () => {
    // Add an empty directory to the mock vault
    await vault.createFolder("/test/project/empty_dir");
    await vault.create("/test/project/readable.txt", "Readable content");

    const params = { path: "/test/project" };
    const result = await listExecute(params, toolExecOptions);

    // Should show readable files and all directories (including empty ones)
    expect(result).toContain("readable.txt");
    expect(result).toContain("file1.txt");
    expect(result).toContain("subdir/");
    // Empty directories SHOULD appear in the listing
    expect(result).toContain("empty_dir/");
  });

  it("should handle unreadable subdirectories gracefully", async () => {
    // Add an unreadable directory to the mock vault
    await vault.createFolder("/test/project/unreadable");
    await vault.create("/test/project/readable.txt", "Readable content");

    const params = { path: "/test/project" };
    const result = await listExecute(params, toolExecOptions);

    // Should still show readable files and directories
    expect(result).toContain("readable.txt");
    expect(result).toContain("file1.txt");
    expect(result).toContain("subdir/");
  });

  it("should respect ignore patterns", async () => {
    await vault.create(
      "/.obsidian/data.json",
      JSON.stringify({ sensitive: true }),
    );
    const params = { path: "/", ignore: [] };
    const result = await listExecute(params, toolExecOptions);
    // should not include .obsidian/data.json
    const expectedOutput = `- /\n  - test/\n    - project/\n      - file1.txt\n      - subdir/\n        - file2.ts`;
    expect(result).toBe(expectedOutput);

    const params2 = { path: "/test/project", ignore: ["file1.txt"] };
    const result2 = await listExecute(params2, toolExecOptions);
    const expectedOutput2 = `- /test/project/\n  - subdir/\n    - file2.ts`;
    expect(result2).toBe(expectedOutput2);

    const params3 = { path: "/test/project", ignore: ["subdir"] };
    const result3 = await listExecute(params3, toolExecOptions);
    const expectedOutput3 = `- /test/project/\n  - file1.txt`;
    expect(result3).toBe(expectedOutput3);
  });

  it("should ignore dotfiles by default", async () => {
    const params = { path: "/test/project" };
    const result = await listExecute(params, toolExecOptions);
    expect(result).not.toContain(".hiddenfile");
  });

  it("should handle aborted operation", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const abortedToolExecOptions = {
      ...toolExecOptions,
      abortSignal: abortController.signal,
    };

    const params = { path: "/test/project" };
    const result = await listExecute(params, abortedToolExecOptions);
    expect((result as any).error).toBe("Tool execution failed");
    expect((result as any).message).toBe("Operation aborted");
  });

  it("should truncate output if it exceeds MAX_OUTPUT_CHARS", async () => {
    const MAX_CHARS = 40000; // Should match constant in list.ts
    const TRUNC_MSG_START = "There are more than"; // Start of truncation message

    // Create many files in the mock vault to exceed the limit
    for (let i = 0; i < 2000; i++) {
      // console.time(`Create file ${i}`);
      await vault.create(
        `/test/project/long_file_name_${i}_to_ensure_we_hit_the_limit.txt`,
        `Content ${i}`,
      );
      // console.timeEnd(`Create file ${i}`);
    }

    const params = { path: "/test/project" };
    const result = await listExecute(params, toolExecOptions);

    expect(result).toContain(TRUNC_MSG_START);
    // The actual length check is tricky due to formatting, but it should be around MAX_CHARS
    expect((result as string).length).toBeLessThanOrEqual(MAX_CHARS + 100); // Allow some buffer for formatting
  });

  it("should handle empty directory", async () => {
    await vault.createFolder("/test/project/empty_subdir");

    const params = { path: "/test/project/empty_subdir" };
    const result = await listExecute(params, toolExecOptions);
    const expectedOutput = `- /test/project/empty_subdir/`;
    expect(result).toBe(expectedOutput);
  });
});
