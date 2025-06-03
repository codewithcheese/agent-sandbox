import { describe, it, expect, vi, beforeEach } from "vitest";
import { execute as writeToolExecute } from "../../../src/tools/files/write.ts";
import {
  vault as mockVault,
  helpers as mockVaultHelpers,
} from "../../mocks/obsidian";
import { VaultOverlaySvelte } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolExecutionOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";

describe("Write tool", () => {
  let toolExecOptions: ToolExecutionOptionsWithContext;
  let vault: VaultOverlaySvelte;
  let mockAbortController: AbortController;

  const MOCK_FILE_PATH = "/test/output.md";
  const MOCK_FILE_CONTENT = "Hello, World!";
  const MOCK_FILE_CONTENT_CRLF = "Hello\r\nWorld!";
  const NORMALIZED_MOCK_FILE_CONTENT_CRLF = "Hello\nWorld!";

  beforeEach(() => {
    vi.resetAllMocks();
    mockVaultHelpers.reset();

    vault = new VaultOverlaySvelte(mockVault);
    mockAbortController = new AbortController();

    toolExecOptions = {
      toolCallId: "test-write-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        config: {},
      }),
      abortSignal: mockAbortController.signal,
    };
  });

  it("should return error when writing to a hidden file path (starts with .)", async () => {
    const params = { file_path: "/.config/settings.json", content: "config" };
    const result = await writeToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Writing to hidden files/folders");
  });

  it("should return error when writing to a path that is an existing directory", async () => {
    await vault.createFolder("/test/existing_folder");
    const params = { file_path: "/test/existing_folder", content: "oops" };
    const result = await writeToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Path is a directory");
  });

  // --- File Creation Tests ---
  it("should create a new file with specified content", async () => {
    const params = { file_path: MOCK_FILE_PATH, content: MOCK_FILE_CONTENT };
    const result = await writeToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.type).toBe("create");
    expect(result.filePath).toBe(MOCK_FILE_PATH);
    expect(result.message).toContain("Successfully created");
    expect(result.contentSnippet).toBe(MOCK_FILE_CONTENT.substring(0, 200));

    const file = vault.getFileByPath(MOCK_FILE_PATH);
    expect(file).not.toBeNull();
    expect(await vault.read(file)).toBe(MOCK_FILE_CONTENT);
  });

  it("should create parent directories if they do not exist", async () => {
    const filePath = "/new/parent/dir/file.txt";
    const params = { file_path: filePath, content: "content" };
    await writeToolExecute(params, toolExecOptions);

    const parentFolder = vault.getFolderByPath("/new/parent/dir");
    expect(parentFolder).not.toBeNull();
  });

  it("should normalize CRLF to LF line endings in content", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      content: MOCK_FILE_CONTENT_CRLF,
    };
    await writeToolExecute(params, toolExecOptions);

    const file = vault.getFileByPath(MOCK_FILE_PATH);
    expect(file).not.toBeNull();
    expect(await vault.read(file)).toBe(NORMALIZED_MOCK_FILE_CONTENT_CRLF);
  });

  it("should create an empty file if content is empty string", async () => {
    const params = { file_path: MOCK_FILE_PATH, content: "" };
    const result = await writeToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.type).toBe("create");
    expect(result.contentSnippet).toBe("");

    const file = vault.getFileByPath(MOCK_FILE_PATH);
    expect(file).not.toBeNull();
    expect(await vault.read(file)).toBe("");
  });

  it("should overwrite an existing file with new content", async () => {
    await vault.create(MOCK_FILE_PATH, "Old content"); // Pre-existing file
    const params = { file_path: MOCK_FILE_PATH, content: MOCK_FILE_CONTENT };
    const result = await writeToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.type).toBe("update");
    expect(result.filePath).toBe(MOCK_FILE_PATH);
    expect(result.message).toContain("Successfully updated");
    expect(result.contentSnippet).toBe(MOCK_FILE_CONTENT.substring(0, 200));

    const file = vault.getFileByPath(MOCK_FILE_PATH);
    expect(file).not.toBeNull();
    expect(await vault.read(file)).toBe(MOCK_FILE_CONTENT);
  });

  it('should return "Operation aborted" if signal is aborted before write', async () => {
    mockAbortController.abort();
    const params = { file_path: MOCK_FILE_PATH, content: MOCK_FILE_CONTENT };
    const result = await writeToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Operation aborted");
  });
});
