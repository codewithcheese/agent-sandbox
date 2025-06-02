import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute as globToolExecute } from "../../../src/tools/files/glob";
import {
  helpers as mockVaultHelpers,
  vault as mockVault,
} from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolExecutionOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";

describe("Glob tool execute function", () => {
  let toolExecOptions: ToolExecutionOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;

  const MOCK_ROOT_PATH = "/";

  beforeEach(async () => {
    vi.resetAllMocks();
    mockVaultHelpers.reset();

    vault = new VaultOverlay(mockVault);
    mockAbortController = new AbortController();

    toolExecOptions = {
      toolCallId: "test-glob-tool-call",
      messages: [],
      getContext: () => ({
        vault,
      }),
      abortSignal: mockAbortController.signal,
    };

    // Setup a default file structure
    await vault.createFolder("/docs");
    await vault.create("/docs/readme.md", "readme content", {
      mtime: Date.now() - 10000,
    });
    await vault.create("/docs/guide.md", "guide content", {
      mtime: Date.now() - 5000,
    });
    await vault.createFolder("/src");
    await vault.create("/src/index.ts", "main ts content", {
      mtime: Date.now() - 2000,
    });
    await vault.create("/src/utils.ts", "utils ts content", {
      mtime: Date.now() - 8000,
    });
    await vault.createFolder("/src/components");
    await vault.create("/src/components/Button.tsx", "button tsx content", {
      mtime: Date.now() - 1000,
    });
    await vault.create("/.configfile", "hidden config", {
      mtime: Date.now() - 7000,
    }); // Hidden file
    await vault.createFolder("/.obsidian"); // Ignored by default
    await vault.create("/.obsidian/config", "obsidian config", {
      mtime: Date.now(),
    });
  });

  // --- Basic Globbing Tests ---
  it("should find all markdown files in a directory", async () => {
    const params = { pattern: "*.md", path: "/docs" };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toHaveLength(2);
    expect(result.filenames).toContain("/docs/readme.md");
    expect(result.filenames).toContain("/docs/guide.md");
    expect(result.truncated).toBe(false);
  });

  it("should find all TypeScript files recursively", async () => {
    const params = { pattern: "**/*.ts", path: "/src" }; // Search within /src
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toHaveLength(2);
    expect(result.filenames).toContain("/src/index.ts");
    expect(result.filenames).toContain("/src/utils.ts");
  });

  it("should find all tsx files", async () => {
    const params = { pattern: "**/*.tsx", path: "/" }; // Search from root
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toHaveLength(1);
    expect(result.filenames).toContain("/src/components/Button.tsx");
  });

  it("should default to vault root if path is not provided", async () => {
    const params = { pattern: "**/*.md" }; // No path, should search from root
    // Create a root level md file for this test
    await vault.create("/root.md", "root md", { mtime: Date.now() - 100 });
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    // Will find /root.md, /docs/readme.md, /docs/guide.md
    expect(result.filenames).toHaveLength(3);
    expect(result.filenames).toContain("/root.md");
  });

  it("should return empty array if no files match", async () => {
    const params = { pattern: "*.nonexistent", path: "/" };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toHaveLength(0);
    expect(result.numFiles).toBe(0);
  });

  // --- Path Validation Tests ---
  it("should return error if specified search path does not exist", async () => {
    const params = { pattern: "*.*", path: "/nonexistent_folder" };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain(
      "Specified search path does not exist: nonexistent_folder",
    );
  });

  it("should return error if specified search path is a file", async () => {
    const params = { pattern: "*.*", path: "/docs/readme.md" };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain(
      "Specified search path is not a directory: docs/readme.md",
    );
  });

  // --- Ignore Pattern Tests ---
  it("should respect user-provided ignore patterns", async () => {
    const params = { pattern: "**/*.md", path: "/docs", ignore: ["guide.md"] };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toHaveLength(1);
    expect(result.filenames).toContain("/docs/readme.md");
    expect(result.filenames).not.toContain("/docs/guide.md");
  });

  it("should respect default ignore patterns (e.g., .obsidian)", async () => {
    const params = { pattern: "**/*", path: "/" }; // Match everything from root
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).not.toContain("/.obsidian/config");
    // It should still find other hidden files if pattern allows
    const paramsHidden = { pattern: ".*", path: "/" };
    const resultHidden = await globToolExecute(paramsHidden, toolExecOptions);
    invariant(
      typeof resultHidden !== "string" && "filenames" in resultHidden,
      "Expected success object",
    );
    expect(resultHidden.filenames).toContain("/.configfile");
  });

  it("should ignore a directory specified in ignore patterns", async () => {
    const params = { pattern: "**/*.*", path: "/", ignore: ["src/**"] };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames.some((f) => f.startsWith("/src/"))).toBe(false);
    expect(result.filenames).toContain("/docs/readme.md");
  });

  // --- Sorting and Limiting Tests ---
  it("should sort results by modification time (newest first)", async () => {
    const params = { pattern: "**/*.*", path: "/" }; // Get most files
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );

    // Expected order (newest to oldest based on mtime in beforeEach)
    // /.obsidian/config (now)
    // /src/components/Button.tsx (now - 1000)
    // /src/index.ts (now - 2000)
    // /docs/guide.md (now - 5000)
    // /.configfile (now - 7000)
    // /src/utils.ts (now - 8000)
    // /docs/readme.md (now - 10000)
    // Note: .obsidian is ignored by default
    const expectedOrder = [
      "/src/components/Button.tsx", // mtime: now - 1000
      "/src/index.ts", // mtime: now - 2000
      "/docs/guide.md", // mtime: now - 5000
      "/.configfile", // mtime: now - 7000
      "/src/utils.ts", // mtime: now - 8000
      "/docs/readme.md", // mtime: now - 10000
    ];
    expect(result.filenames).toEqual(expectedOrder);
  });

  it("should limit results and set truncated flag if RESULT_LIMIT is exceeded", async () => {
    // Override RESULT_LIMIT for this test
    toolExecOptions.getContext = () => ({
      vault,
      config: { RESULT_LIMIT: 2 },
    });

    const params = { pattern: "**/*.*", path: "/" };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toHaveLength(2);
    expect(result.numFiles).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.totalMatchesBeforeLimit).toBe(6); // Based on files in beforeEach not in .obsidian
    // Verify it took the newest 2
    expect(result.filenames).toContain("/src/components/Button.tsx");
    expect(result.filenames).toContain("/src/index.ts");
  });

  // --- minimatch `dot` option test ---
  it("should match hidden files if pattern explicitly includes dot", async () => {
    const params = { pattern: ".*", path: "/" };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toContain("/.configfile");
    expect(result.filenames).not.toContain("/.obsidian/config"); // Still ignored by default pattern
  });

  it("should match files in hidden folder if pattern explicitly includes dot folder", async () => {
    toolExecOptions.getContext = () => ({
      vault,
      config: {
        DEFAULT_IGNORE_PATTERNS: [],
      },
    });

    const params = { pattern: ".obsidian/*", path: "/" };
    const result = await globToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "filenames" in result,
      "Expected success object",
    );
    expect(result.filenames).toContain("/.obsidian/config");
  });
});
