import { describe, it, expect, vi, beforeEach } from "vitest";
import { execute as multiEditToolExecute } from "../../../src/tools/files/multi-edit.ts";
import {
  vault as mockVault,
  helpers as mockVaultHelpers,
  metadataCache,
} from "../../mocks/obsidian";
import { VaultOverlay } from "../../../src/chat/vault-overlay.svelte.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types.ts";
import { invariant } from "@epic-web/invariant";
import type { TFile } from "obsidian";
import { SessionStore } from "../../../src/chat/session-store.svelte.ts";

describe("MultiEdit tool execute function", () => {
  let toolExecOptions: ToolCallOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;
  let sessionStore: SessionStore;

  const MOCK_FILE_PATH = "/test/multi-editable.txt";
  const INITIAL_CONTENT = "one two three\nfour five six\nseven two eight"; // "two" appears twice

  beforeEach(async () => {
    vi.resetAllMocks();
    await mockVaultHelpers.reset();

    vault = new VaultOverlay(mockVault);
    sessionStore = new SessionStore(vault);
    mockAbortController = new AbortController();

    toolExecOptions = {
      toolCallId: "test-multiedit-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        sessionStore,
        metadataCache,
      }),
      abortSignal: mockAbortController.signal,
    };

    await vault.create(MOCK_FILE_PATH, INITIAL_CONTENT);
    // Simulate that the file was read
    const file = vault.getFileByPath(MOCK_FILE_PATH);
    await sessionStore.readState.setLastRead(MOCK_FILE_PATH, file!.stat.mtime);
  });

  // --- Initial File Path Validation Tests ---
  it("should return error if file_path does not exist", async () => {
    const params = {
      file_path: "/non/existent.txt",
      edits: [{ old_string: "a", new_string: "b" }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File does not exist");
  });

  it("should return error for hidden file path", async () => {
    const params = {
      file_path: "/.secret/file.txt",
      edits: [{ old_string: "a", new_string: "b" }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Editing hidden files/folders");
  });

  it("should return error if path is a directory", async () => {
    await vault.createFolder("/test/a_folder_for_multiedit");
    const params = {
      file_path: "/test/a_folder_for_multiedit",
      edits: [{ old_string: "a", new_string: "b" }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("Path is a directory");
  });

  // Read state checks disabled in-lieu of a better solution
  it.skip("should return error when trying to multi-edit file without reading it first", async () => {
    // Create a new file without simulating a read
    const newFilePath = "/test/unread-multi-edit.txt";
    await vault.create(newFilePath, "Some content to edit");

    const params = {
      file_path: newFilePath,
      edits: [{ old_string: "content", new_string: "modified content" }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File has not been read yet");
  });

  // Read state checks disabled in-lieu of a better solution
  it.skip("should return error when file has been modified since last read", async () => {
    // Create file and simulate reading it
    const modifiedFilePath = "/test/modified-multi-edit.txt";
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
      edits: [{ old_string: "Modified", new_string: "Changed" }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);

    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Input Validation Failed");
    expect(result.message).toContain("File has been modified since read");
  });

  // --- Individual Edit Operation Validation Tests (within the loop) ---
  it("should fail if an editOp has empty old_string", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [{ old_string: "", new_string: "inject" }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Invalid Edit");
    expect(result.message).toContain("old_string cannot be empty");
  });

  it("should fail if an editOp has identical old_string and new_string", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [{ old_string: "two", new_string: "two" }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Invalid Edit");
    expect(result.message).toContain("old_string and new_string are identical");
  });

  it("should fail if an editOp's old_string is not found in current content", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [
        { old_string: "two", new_string: "2", expected_replacements: 2 }, // This will change "two"
        { old_string: "two", new_string: "TWO_AGAIN" }, // This "two" won't be found
      ],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("String Not Found During MultiEdit");
    expect(result.message).toContain("Edit #2"); // 0-indexed
    expect(result.message).toContain(
      "not found in the current (in-memory) state",
    );
    // Verify file was not changed (atomicity)
    const content = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(content).toBe(INITIAL_CONTENT);
  });

  it("should fail if an editOp's expected_replacements mismatches", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [
        {
          old_string: "two",
          new_string: "three",
          expected_replacements: 1,
        },
      ], // OLD_STRING appears twice
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Replacement Count Mismatch During MultiEdit");
    expect(result.message).toContain("Edit #1");
    expect(result.message).toContain("Found 2 occurrences of old_string");
    expect(result.message).toContain("but expected 1");
    const content = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(content).toBe(INITIAL_CONTENT);
  });

  // --- Successful Multi-Edit Operation Tests ---
  it("should apply a single edit in the array correctly", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [{ old_string: "two", new_string: "2", expected_replacements: 2 }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.type).toBe("update");
    expect(result.editsAppliedCount).toBe(1);
    expect(result.totalReplacementsMade).toBe(2);

    const updatedContent = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(updatedContent).toBe("one 2 three\nfour five six\nseven 2 eight");
  });

  it("should apply multiple non-overlapping edits sequentially and correctly", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [
        { old_string: "one", new_string: "1", expected_replacements: 1 },
        { old_string: "five", new_string: "5", expected_replacements: 1 },
        { old_string: "eight", new_string: "8", expected_replacements: 1 },
      ],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.type).toBe("update");
    expect(result.editsAppliedCount).toBe(3);
    expect(result.totalReplacementsMade).toBe(3);

    const updatedContent = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(updatedContent).toBe("1 two three\nfour 5 six\nseven two 8");
  });

  it("should apply multiple edits where later edits depend on earlier ones", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [
        {
          old_string: "two",
          new_string: "TWENTY_TWO",
          expected_replacements: 2,
        }, // "two" -> "TWENTY_TWO"
        {
          old_string: "TWENTY_TWO",
          new_string: "22",
          expected_replacements: 2,
        }, // "TWENTY_TWO" -> "22"
      ],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "type" in result,
      "Expected success object",
    );
    expect(result.editsAppliedCount).toBe(2);
    expect(result.totalReplacementsMade).toBe(4); // 2 for first op, 2 for second op

    const updatedContent = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(updatedContent).toBe("one 22 three\nfour five six\nseven 22 eight");
  });

  it("should return 'No Effective Change' if edits result in original content", async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [
        { old_string: "two", new_string: "TEMP_VAL", expected_replacements: 2 },
        { old_string: "TEMP_VAL", new_string: "two", expected_replacements: 2 },
      ],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("No Effective Change");
    const content = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(content).toBe(INITIAL_CONTENT); // File should not be modified
  });

  // --- Vault Operation Failures ---
  it("should return error if vault.modify throws during final write", async () => {
    vi.spyOn(vault, "modify").mockImplementation(async (...args) => {
      throw new Error("Vault modify failed");
    });
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [{ old_string: "one", new_string: "1", expected_replacements: 1 }],
    };
    const result = await multiEditToolExecute(params, toolExecOptions);
    invariant(
      typeof result !== "string" && "error" in result,
      "Expected error object",
    );
    expect(result.error).toBe("Tool execution failed");
    expect(result.message).toBe("Vault modify failed");
  });

  // --- Abort Signal Test ---
  it('should return "Operation aborted" if signal is aborted during the edit loop', async () => {
    const params = {
      file_path: MOCK_FILE_PATH,
      edits: [
        { old_string: "one", new_string: "1", expected_replacements: 1 },
        { old_string: "two", new_string: "2", expected_replacements: 2 }, // Will abort during this
      ],
    };
    // Mock the replace method to abort after the first successful replacement in memory
    const originalStringReplace = String.prototype.replace;
    let replaceCount = 0;
    String.prototype.replace = function (searchValue, replaceValue) {
      replaceCount++;
      if (replaceCount > 1) {
        // Abort after the first edit's replacements are done
        mockAbortController.abort();
      }
      return originalStringReplace.apply(this, [searchValue, replaceValue]);
    };

    await expect(() =>
      multiEditToolExecute(params, toolExecOptions),
    ).rejects.toThrow("The operation was aborted.");
    // String.prototype.replace = originalStringReplace; // Restore original method
    const content = await vault.read(
      vault.getFileByPath(MOCK_FILE_PATH) as TFile,
    );
    expect(content).toBe(INITIAL_CONTENT); // File should not be modified
  });
});
