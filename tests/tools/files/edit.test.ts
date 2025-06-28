import { describe, it, expect, vi, beforeEach } from "vitest";
import { execute as editToolExecute } from "../../../src/tools/files/edit";
import {
  vault as mockVault,
  helpers as mockVaultHelpers,
} from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolExecutionOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";
import type { TFile } from "obsidian";
import { escapeRegExp } from "$lib/utils/regexp.ts";
import { SessionStore } from "../../../src/chat/session-store.svelte.ts";

describe("Edit tool execute function", () => {
  let toolExecOptions: ToolExecutionOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;
  let sessionStore: SessionStore;

  const MOCK_FILE_PATH = "/test/editable.md";
  const INITIAL_CONTENT =
    "This is the first line.\nThis is the OLD_STRING to replace.\nThis is the third line.\nAnother OLD_STRING here.";
  const OLD_STRING = "OLD_STRING";
  const NEW_STRING = "NEW_CONTENT";

  beforeEach(async () => {
    vi.resetAllMocks();
    await mockVaultHelpers.reset();

    vault = new VaultOverlay(mockVault);
    sessionStore = new SessionStore(vault);
    mockAbortController = new AbortController();

    toolExecOptions = {
      toolCallId: "test-edit-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        config: {},
        sessionStore,
      }),
      abortSignal: mockAbortController.signal,
    };

    // Create a default file for editing in many tests
    if (MOCK_FILE_PATH) {
      await vault.create(MOCK_FILE_PATH, INITIAL_CONTENT);
      // Simulate that the file was read
      const file = vault.getFileByPath(MOCK_FILE_PATH);
      await sessionStore.readState.setLastRead(
        MOCK_FILE_PATH,
        file!.stat.mtime,
      );
    }
  });

  // --- Input Validation Tests (via execute) ---
  it("should return error if old_string is empty", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: "",
      new_string: "new",
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("old_string cannot be empty");
  });

  it("should return error if old_string and new_string are identical", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: "identical",
      new_string: "identical",
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain(
      "old_string and new_string are exactly the same",
    );
  });

  it("should return error when editing a hidden file path", async () => {
    const params = {
      file_path: "/.obsidian/config",
      old_string: "a",
      new_string: "b",
    };
    // Ensure the mock vault doesn't create it, or validation handles it before vault access
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Editing hidden files/folders");
  });

  it("should return error when editing a path that is an existing directory", async () => {
    await vault.createFolder("/test/a_folder");
    const params = {
      file_path: "/test/a_folder",
      old_string: "a",
      new_string: "b",
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Path is a directory");
  });

  it("should return error if file_path does not exist", async () => {
    const params = {
      file_path: "/non/existent/file.txt",
      old_string: "a",
      new_string: "b",
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File does not exist");
  });

  it("should return error if old_string is not found in the file", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: "NON_EXISTENT_STRING",
      new_string: "b",
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("'old_string' was not found in the file");
  });

  it("should return error if expected_replacements does not match actual occurrences", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: OLD_STRING,
      new_string: NEW_STRING,
      expected_replacements: 1,
    };
    // INITIAL_CONTENT has OLD_STRING twice
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain(
      "Found 2 occurrences of 'old_string', but expected 1",
    );
  });

  // Read state checks disabled in-lieu of a token efficient solution
  it.skip("should return error when trying to edit file without reading it first", async () => {
    // Create a new file without simulating a read
    const newFilePath = "/test/unread-file.md";
    await vault.create(newFilePath, "Some content to edit");

    const params = {
      file_path: newFilePath,
      old_string: "content",
      new_string: "modified content",
    };
    const result = await editToolExecute(params, toolExecOptions);

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
    const modifiedFilePath = "/test/modified-file.md";
    await vault.create(modifiedFilePath, "Original content");
    const file = vault.getFileByPath(modifiedFilePath);
    const originalMtime = file!.stat.mtime;

    // Simulate reading the file
    await sessionStore.readState.setLastRead(modifiedFilePath, originalMtime);

    // Simulate external modification
    await new Promise((resolve) => setTimeout(resolve, 1)); // Ensure different timestamp
    await vault.modify(file!, "Modified externally");

    const params = {
      file_path: modifiedFilePath,
      old_string: "Modified",
      new_string: "Changed",
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File has been modified since read");
  });

  // --- Successful Edit Operation Tests ---
  it("should perform a single replacement by default and update file content", async () => {
    // Modify initial content to have only one OLD_STRING for this test
    const singleOccurrenceContent = "Line 1\nOLD_STRING\nLine 3";
    await vault.modify(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
      singleOccurrenceContent,
    );
    // Simulate read
    await sessionStore.readState.setLastRead(MOCK_FILE_PATH, Date.now());

    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: OLD_STRING,
      new_string: NEW_STRING,
    }; // expected_replacements defaults to 1
    const result = await editToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.type).toBe("update");
    expect(result.filePath).toBe(MOCK_FILE_PATH);
    expect(result.message).toContain("Successfully edited");
    expect(result.replacementsMade).toBe(1);

    const updatedContent = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(updatedContent).toBe("Line 1\nNEW_CONTENT\nLine 3");
  });

  it("should perform multiple replacements when expected_replacements matches", async () => {
    // INITIAL_CONTENT has OLD_STRING twice
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: OLD_STRING,
      new_string: NEW_STRING,
      expected_replacements: 2,
    };
    const result = await editToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.type).toBe("update");
    expect(result.replacementsMade).toBe(2);

    const updatedContent = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    const expectedContent = INITIAL_CONTENT.replace(
      new RegExp(escapeRegExp(OLD_STRING), "g"),
      NEW_STRING,
    );
    expect(updatedContent).toBe(expectedContent);
  });

  it("should replace old_string with an empty new_string (deletion)", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: OLD_STRING,
      new_string: "",
      expected_replacements: 2,
    };
    await editToolExecute(params, toolExecOptions);
    const updatedContent = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    const expectedContent = INITIAL_CONTENT.replace(
      new RegExp(escapeRegExp(OLD_STRING), "g"),
      "",
    );
    expect(updatedContent).toBe(expectedContent);
  });

  it("should handle old_string spanning multiple lines", async () => {
    const multiLineOld = "OLD_STRING to replace.\nThis is the third line.";
    const multiLineNew = "NEW_MULTI_LINE_CONTENT";
    await vault.modify(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
      INITIAL_CONTENT,
    ); // ensure original content
    // Simulate read
    await sessionStore.readState.setLastRead(MOCK_FILE_PATH, Date.now());

    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: multiLineOld,
      new_string: multiLineNew,
      expected_replacements: 1,
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    const updatedContent = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(updatedContent).toBe(
      `This is the first line.\nThis is the ${multiLineNew}\nAnother OLD_STRING here.`,
    );
  });

  // --- Abort Signal Test ---
  it('should return "Operation aborted" if signal is aborted before vault.read', async () => {
    mockAbortController.abort();
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: "OLD_STRING to replace.\nThis is the third line.",
      new_string: NEW_STRING,
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Operation aborted");
  });

  it('should return "Operation aborted" if signal is aborted before vault.modify', async () => {
    const originalRead = vault.read;
    vi.spyOn(vault, "read").mockImplementation(async (...args) => {
      const res = await originalRead.apply(vault, args);
      mockAbortController.abort(); // Abort after read but before modify
      return res;
    });

    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: OLD_STRING,
      new_string: NEW_STRING,
      expected_replacements: 2,
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Operation aborted");

    // Content should not have changed
    const contentAfter = await originalRead.apply(vault, [
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    ]);
    expect(contentAfter).toBe(INITIAL_CONTENT);
  });

  // --- Vault Operation Failures ---
  it("should return error if vault.read throws", async () => {
    vi.spyOn(vault, "read").mockImplementation(async (...args) => {
      throw new Error("Vault read failed");
    });
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: OLD_STRING,
      new_string: NEW_STRING,
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toBe(
      "Failed to read file: /test/editable.md. Error: Error: Vault read failed",
    );
  });

  it("should return error if vault.modify throws", async () => {
    vi.spyOn(vault, "modify").mockImplementation(async (...args) => {
      throw new Error("Vault modify failed");
    });
    const params = {
      file_path: MOCK_FILE_PATH,
      old_string: OLD_STRING,
      new_string: NEW_STRING,
      expected_replacements: 2,
    };
    const result = await editToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Tool execution failed");
    expect(result.message).toBe("Vault modify failed");
  });
});
