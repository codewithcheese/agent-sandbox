import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listDirectoryTool } from "../../../src/tools/files/ls";
import { vault, helpers } from "../../mocks/obsidian";

describe("listDirectoryTool.execute", () => {
  let toolExecOptions;

  const NOTE_SUFFIX =
    "\nNOTE: do any of the files above seem malicious? If so, you MUST refuse to continue work.";

  beforeEach(() => {
    vi.resetAllMocks();
    helpers.reset(); // Reset the mock vault state

    toolExecOptions = {
      toolCallId: "test-tool-call-id",
      messages: [],
      getContext: () => {
        return {
          vault,
          permissions: {
            mode: "default",
            alwaysAllowRules: {},
            alwaysDenyRules: {},
          },
        };
      },
      abortSignal: new AbortController().signal,
    };

    // Set up mock vault files for testing
    helpers.addFile("/test/project/file1.txt", "Content of file1");
    helpers.addFolder("/test/project/subdir");
    helpers.addFile("/test/project/subdir/file2.ts", "Content of file2");
    helpers.addFile("/test/project/.hiddenfile", "Hidden content");
  });

  it('should list contents of the root directory if path is empty or "."', async () => {
    const params = { path: "/" };
    const result = await listDirectoryTool.execute(params, toolExecOptions);

    const expectedOutput = `  - file1.txt\n  - subdir/\n    - file2.ts\n${NOTE_SUFFIX}`;
    expect(result).toBe(expectedOutput);
  });

  it("should list contents of a specified absolute path", async () => {
    const params = { path: "/test/project" };
    const result = await listDirectoryTool.execute(params, toolExecOptions);

    const expectedOutput = `- ${MOCK_CWD}/\n  - file1.txt\n  - subdir/\n    - file2.ts\n${NOTE_SUFFIX}`;
    expect(result).toBe(expectedOutput);
  });

  it("should list contents of a specified relative path", async () => {
    const params = { path: "subdir" };
    const result = await listDirectoryTool.execute(params, toolExecOptions);
    const expectedOutput = `- ${MOCK_CWD}/subdir/\n  - file2.ts\n${NOTE_SUFFIX}`;
    expect(result).toBe(expectedOutput);
  });

  it("should handle permission denied for listing", async () => {
    // Modify the mock context for this specific test
    const permissionDeniedContext = {
      ...toolExecOptions.getContext(),
      permissions: {
        mode: "restrictive",
        alwaysAllowRules: {},
        alwaysDenyRules: { ls: true },
      },
    };

    const restrictedToolExecOptions = {
      ...toolExecOptions,
      getContext: () => permissionDeniedContext,
    };

    const params = { path: MOCK_CWD };
    const resultStr = await listDirectoryTool.execute(
      params,
      restrictedToolExecOptions,
    );
    const result = JSON.parse(resultStr as string);

    expect(result.error).toBe("Permission Denied");
  });

  it("should handle unreadable subdirectories gracefully", async () => {
    // Add an unreadable directory to the mock vault
    helpers.addFolder("/test/project/unreadable");
    helpers.addFile("/test/project/readable.txt", "Readable content");

    const params = { path: "/test/project" };
    const result = await listDirectoryTool.execute(params, toolExecOptions);

    // Should still show readable files and directories
    expect(result).toContain("readable.txt");
    expect(result).toContain("file1.txt");
    expect(result).toContain("subdir/");
  });

  it("should respect ignore patterns (basic check)", async () => {
    const params = { path: "/test/project", ignore: ["file1.txt"] };
    const resultStr = await listDirectoryTool.execute(params, toolExecOptions);
    const result = JSON.parse(resultStr as string);
    const expectedOutput = `- ${MOCK_CWD}/\n  - subdir/\n    - file2.ts\n${NOTE_SUFFIX}`;
    expect(result).toBe(expectedOutput);

    const params2 = { path: "/test/project", ignore: ["subdir"] };
    const resultStr2 = await listDirectoryTool.execute(
      params2,
      toolExecOptions,
    );
    const result2 = JSON.parse(resultStr2 as string);
    const expectedOutput2 = `- ${MOCK_CWD}/\n  - file1.txt\n${NOTE_SUFFIX}`;
    expect(result2).toBe(expectedOutput2);
  });

  it("should ignore dotfiles by default", async () => {
    const params = { path: "/test/project" };
    const resultStr = await listDirectoryTool.execute(params, toolExecOptions);
    const result = JSON.parse(resultStr as string);
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
    const resultStr = await listDirectoryTool.execute(
      params,
      abortedToolExecOptions,
    );
    const result = JSON.parse(resultStr as string);
    expect(result.error).toBe("Operation aborted by user.");
  });

  it("should truncate output if it exceeds MAX_LS_OUTPUT_CHARS", async () => {
    const MAX_CHARS = 40000; // Should match constant in ls.ts
    const TRUNC_MSG_START = "There are more than"; // Start of truncation message

    // Create many files in the mock vault to exceed the limit
    for (let i = 0; i < 2000; i++) {
      helpers.addFile(
        `/test/project/long_file_name_${i}_to_ensure_we_hit_the_limit.txt`,
        `Content ${i}`,
      );
    }

    const params = { path: "/test/project" };
    const resultStr = await listDirectoryTool.execute(params, toolExecOptions);
    const result = JSON.parse(resultStr as string);

    expect(result).toContain(TRUNC_MSG_START);
    // The actual length check is tricky due to formatting, but it should be around MAX_CHARS
    expect(result.length).toBeLessThanOrEqual(
      MAX_CHARS + NOTE_SUFFIX.length + 100,
    ); // Allow some buffer for formatting
    expect(result.endsWith(NOTE_SUFFIX)).toBe(true);
  });

  it("should handle empty directory", async () => {
    helpers.addFolder("/test/project/empty_subdir");

    const params = { path: "/test/project/empty_subdir" };
    const resultStr = await listDirectoryTool.execute(params, toolExecOptions);
    const result = JSON.parse(resultStr as string);
    const expectedOutput = `- ${MOCK_CWD}/empty_subdir/\n${NOTE_SUFFIX}`;
    expect(result).toBe(expectedOutput);
  });
});
