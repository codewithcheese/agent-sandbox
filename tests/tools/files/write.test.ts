import { describe, it, expect, vi, beforeEach } from "vitest";
import { execute as writeToolExecute } from "../../../src/tools/files/write.ts";
import {
  vault as mockVault,
  helpers as mockVaultHelpers,
  metadataCache,
} from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";
import { SessionStore } from "../../../src/chat/session-store.svelte.ts";

describe("Write tool", () => {
  let toolExecOptions: ToolCallOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;
  let sessionStore: SessionStore;

  const MOCK_FILE_PATH = "/test/output.md";
  const MOCK_FILE_CONTENT = "Hello, World!";
  const MOCK_FILE_CONTENT_CRLF = "Hello\r\nWorld!";
  const NORMALIZED_MOCK_FILE_CONTENT_CRLF = "Hello\nWorld!";

  beforeEach(() => {
    vi.resetAllMocks();
    mockVaultHelpers.reset();

    vault = new VaultOverlay(mockVault);
    sessionStore = new SessionStore(vault);
    mockAbortController = new AbortController();

    toolExecOptions = {
      toolCallId: "test-write-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        config: {},
        sessionStore,
        metadataCache,
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

  it("should return error when writing to .chat.md files", async () => {
    const params = { file_path: "/chats/conversation.chat.md", content: "# Modified content" };
    const result = await writeToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Cannot write to .chat.md files");
    expect(result.humanMessage).toBe("Chat files are read-only");
  });

  // Read state checks disabled in-lieu of a token efficient solution
  it.skip("should return error when trying to write to existing file without reading it first", async () => {
    // Create an existing file without simulating a read
    await vault.create(MOCK_FILE_PATH, "Old content");

    const params = { file_path: MOCK_FILE_PATH, content: MOCK_FILE_CONTENT };
    const result = await writeToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File has not been read yet");
  });

  // Read state checks disabled in-lieu of a token efficient solution
  it.skip("should return error when file has been modified since last read", async () => {
    // Create file and simulate reading it
    await vault.create(MOCK_FILE_PATH, "Old content");
    const file = vault.getFileByPath(MOCK_FILE_PATH);
    const originalMtime = file!.stat.mtime;

    // Simulate reading the file by setting read state
    await sessionStore.readState.setLastRead(MOCK_FILE_PATH, originalMtime);

    // Simulate external modification by updating the file's mtime
    await new Promise((resolve) => setTimeout(resolve, 1)); // Ensure different timestamp
    await vault.modify(file!, "Modified externally");

    const params = { file_path: MOCK_FILE_PATH, content: MOCK_FILE_CONTENT };
    const result = await writeToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File has been modified since read");
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

    // Read state checks disabled in-lieu of a token efficient solution
    // expect(await sessionStore.readState.hasBeenRead(MOCK_FILE_PATH)).toBe(true);
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

  it("should overwrite an existing file with new content when file was read first", async () => {
    // Create file and simulate reading it
    await vault.create(MOCK_FILE_PATH, "Old content");
    const file = vault.getFileByPath(MOCK_FILE_PATH);
    await sessionStore.readState.setLastRead(MOCK_FILE_PATH, file!.stat.mtime);

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

    const updatedFile = vault.getFileByPath(MOCK_FILE_PATH);
    expect(updatedFile).not.toBeNull();
    expect(await vault.read(updatedFile)).toBe(MOCK_FILE_CONTENT);

    // Verify read state was updated with new mtime
    expect(await sessionStore.readState.hasBeenRead(MOCK_FILE_PATH)).toBe(true);
  });

  it('should return "Operation aborted" if signal is aborted before write', async () => {
    mockAbortController.abort();
    const params = { file_path: MOCK_FILE_PATH, content: MOCK_FILE_CONTENT };
    await expect(() =>
      writeToolExecute(params, toolExecOptions),
    ).rejects.toThrow("The operation was aborted.");
  });
});
