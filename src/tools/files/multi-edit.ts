import { z } from "zod";
import { normalizePath, type Vault } from "obsidian";
import { createDebug } from "$lib/debug";
import type { ToolDefinition, ToolCallOptionsWithContext } from "../types.ts";
import { invariant } from "@epic-web/invariant";
import { escapeRegExp } from "$lib/utils/regexp.ts";
import { type ToolUIPart } from "ai";

const debug = createDebug();

// Define the UI tool type for the multi-edit tool
type MultiEditUITool = {
  input: {
    file_path: string;
    edits: Array<{
      old_string: string;
      new_string: string;
      expected_replacements?: number;
    }>;
  };
  output:
    | {
        type: "update";
        filePath: string;
        message: string;
        editsAppliedCount: number;
        totalReplacementsMade: number;
      }
    | {
        error: string;
        message?: string;
        humanMessage?: string;
        meta?: any;
      };
};

type MultiEditToolUIPart = ToolUIPart<{ MultiEdit: MultiEditUITool }>;

/**
 * Features:
 * - Performs multiple, sequential, exact string replacements in a single file atomically
 * - Expects absolute paths within the vault (e.g., "/folder/file.md")
 * - All edits are applied in sequence to an in-memory version of the file content
 * - File on disk is only modified ONCE at the end if all edits succeed
 * - Each edit operates on the result of the previous edit operation
 * - Atomic operation - either all edits succeed or none are applied
 * - Supports expected replacement count validation for each edit operation
 * - Comprehensive error handling with detailed validation messages
 * - Cancellation support using abort signal from tool execution options
 * - Normalizes line endings in content being written to `\n`
 * - Validates against editing hidden files/folders (starting with '.')
 * - Returns detailed success information including total replacements made
 * - Ideal for making several changes to different parts of the same file
 * - More efficient than multiple single Edit tool calls for the same file
 *
 * Common Use Cases:
 * - Updating multiple function signatures in a file
 * - Replacing multiple variable names or constants
 * - Making coordinated changes across different sections
 * - Batch updates to configuration or data files
 *
 * Performance Notes:
 * - Single file write operation regardless of number of edits
 * - In-memory processing minimizes I/O operations
 * - Validation occurs before any modifications are made
 * - Rollback-safe - no partial updates on failure
 */

export const defaultConfig = {};

export const TOOL_NAME = "MultiEdit";
export const TOOL_DESCRIPTION =
  "Performs multiple, sequential, exact string replacements in a single file atomically.";
export const TOOL_PROMPT_GUIDANCE = `This is a tool for making multiple edits to a single file in one operation. It allows you to perform multiple find-and-replace operations efficiently. Prefer this tool over the single Edit tool when you need to make multiple distinct changes to the same file.

Before using this tool:
1. Use the Read tool to understand the file's contents and context.
2. Verify the directory path is correct.

To make multiple file edits, provide the following:
1. file_path: The absolute path to the file to modify within the vault (e.g., /folder/file.md).
2. edits: An array of edit operations to perform, where each edit contains:
   - old_string: The text to replace (must match the file contents exactly at the time of its application, including all whitespace and indentation).
   - new_string: The edited text to replace the old_string.
   - expected_replacements: The number of replacements you expect this specific edit operation to make. Defaults to 1 if not specified.

IMPORTANT:
- All edits are applied in sequence to an in-memory version of the file content. The file on disk is only modified ONCE at the end if all edits succeed.
- Each edit operates on the result of the previous edit.
- All individual edit operations must be valid for the entire MultiEdit operation to succeed. If any single edit fails (e.g., old_string not found, or expected_replacements mismatch for that step), none of the changes will be applied to the file.
- This tool is ideal when you need to make several changes to different parts of the same file.
- For Jupyter notebooks (.ipynb files), use the NotebookEdit tool instead.

CRITICAL REQUIREMENTS:
1. All edits follow the same requirements as the single Edit tool regarding exact matches.
2. The edits are atomic - either all succeed and the file is updated, or none are applied if any step fails.
3. Plan your edits carefully to avoid conflicts where earlier edits might alter the text that later edits are trying to find.

WARNING:
- An individual edit step will fail if its old_string matches multiple locations and its expected_replacements isn't specified or doesn't match the actual count at that stage.
- An individual edit step will fail if its old_string doesn't match the file contents (in its current in-memory state) exactly.
- An individual edit step will fail if its old_string and new_string are the same.

When making edits:
- Ensure all edits result in idiomatic, correct code.
- Do not leave the code in a broken state.
- Always use absolute file paths (e.g. /folder/file.md).
- This tool CANNOT be used to create a new file. The file specified in file_path MUST exist. Use the Write tool to create new files.`;

const editOperationSchema = z.strictObject({
  old_string: z.string().describe("The text to replace"),
  new_string: z.string().describe("The text to replace it with"),
  expected_replacements: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .describe(
      "The expected number of replacements for this specific edit operation. Defaults to 1.",
    ),
});

const multiEditInputSchema = z.strictObject({
  file_path: z
    .string()
    .describe(
      "The absolute path to the file to modify within the vault (e.g., /folder/file.md)",
    ),
  edits: z
    .array(editOperationSchema)
    .min(1, "At least one edit operation is required")
    .describe("Array of edit operations to perform sequentially on the file."),
});

// --- Output Type for execute ---
type MultiEditToolOutput =
  | {
      type: "update";
      filePath: string;
      message: string;
      editsAppliedCount: number; // Number of edit operations from the input array
      totalReplacementsMade: number; // Sum of replacements across all operations
    }
  | {
      error: string;
      message?: string;
      humanMessage?: string;
      meta?: any; // For additional error context, like which edit failed
    };

async function validateMultiEditFilePath(
  filePath: string,
  vault: Vault,
  config: typeof defaultConfig,
  readState: any, // ReadState accessed through sessionStore
): Promise<{
  result: boolean;
  message?: string;
  humanMessage?: string;
  meta?: any;
}> {
  const path = normalizePath(filePath);

  const pathParts = path.split("/");
  if (pathParts.some((part) => part.startsWith("."))) {
    return {
      result: false,
      message:
        "Editing hidden files/folders (starting with '.') is not allowed.",
      humanMessage: "Hidden path not allowed",
    };
  }

  const abstractFile = vault.getAbstractFileByPath(path);
  if (!abstractFile) {
    return {
      result: false,
      message: `File does not exist: ${filePath}`,
      humanMessage: "File not found",
    };
  }

  if (vault.getFolderByPath(path)) {
    return {
      result: false,
      message: "Path is a directory, not a file. Cannot edit a directory.",
      humanMessage: "Path is a directory",
    };
  }

  // const file = vault.getFileByPath(path);
  // if (file) {
  // Read-before-write check
  // const hasBeenRead = await readState.hasBeenRead(path);
  // if (!hasBeenRead) {
  //   return {
  //     result: false,
  //     message: "File has not been read yet. Read it first before editing it.",
  //   };
  // }

  // Modified-since-read check
  // const isModified = await readState.isModifiedSinceRead(
  //   path,
  //   file.stat.mtime,
  // );
  // if (isModified) {
  //   return {
  //     result: false,
  //     message:
  //       "File has been modified since read. Read it again before attempting to edit.",
  //   };
  // }
  // }

  return { result: true };
}

export async function execute(
  params: z.infer<typeof multiEditInputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<MultiEditToolOutput> {
  const { abortSignal } = toolExecOptions;
  const {
    vault,
    config: contextConfig,
    sessionStore,
  } = toolExecOptions.getContext();

  const config = { ...defaultConfig, ...contextConfig };

  if (!vault) {
    throw new Error("Vault not available in execution context");
  }

  const validation = await validateMultiEditFilePath(
    params.file_path,
    vault,
    config,
    sessionStore.readState,
  );
  if (!validation.result) {
    return {
      error: "Input Validation Failed",
      message: validation.message,
      humanMessage: validation.humanMessage,
      meta: validation.meta,
    };
  }
  const file = vault.getFileByPath(normalizePath(params.file_path));

  try {
    const originalFileContent = (await vault.read(file)).replace(/\r\n/g, "\n");

    if (abortSignal.aborted) {
      abortSignal.throwIfAborted();
    }

    let currentContentInMemory = originalFileContent;
    let totalReplacementsMadeThisCall = 0;

    for (const [i, editOp] of params.edits.entries()) {
      if (abortSignal.aborted) {
        throw new Error("Operation aborted");
      }

      if (editOp.old_string === "") {
        return {
          error: "Invalid Edit",
          message: `Edit #${i + 1}: old_string cannot be empty for MultiEdit operations.`,
          humanMessage: "Empty old_string",
        };
      }
      if (editOp.old_string === editOp.new_string) {
        return {
          error: "Invalid Edit",
          message: `Edit #${i + 1}: old_string and new_string are identical.`,
          humanMessage: "No changes to make",
        };
      }

      const expectedReplacements = editOp.expected_replacements ?? 1;

      const occurrences = (
        currentContentInMemory.match(
          new RegExp(escapeRegExp(editOp.old_string), "g"),
        ) || []
      ).length;

      if (occurrences === 0) {
        return {
          error: "String Not Found During MultiEdit",
          message: `Edit #${i + 1} (1-indexed): old_string "${editOp.old_string.substring(0, 50)}..." not found in the current (in-memory) state of the file content. Previous edits might have altered the target string.`,
          humanMessage: "Text not found",
          meta: { failedEditIndex: i, originalOldString: editOp.old_string },
        };
      }
      if (occurrences !== expectedReplacements) {
        return {
          error: "Replacement Count Mismatch During MultiEdit",
          message: `Edit #${i + 1} (1-indexed): Found ${occurrences} occurrences of old_string "${editOp.old_string.substring(0, 50)}...", but expected ${expectedReplacements}.`,
          humanMessage: "Occurrence count mismatch",
          meta: {
            failedEditIndex: i,
            originalOldString: editOp.old_string,
            found: occurrences,
            expected: expectedReplacements,
          },
        };
      }

      currentContentInMemory = currentContentInMemory.replace(
        new RegExp(escapeRegExp(editOp.old_string), "g"),
        editOp.new_string,
      );
      totalReplacementsMadeThisCall += occurrences;
    }

    if (currentContentInMemory === originalFileContent) {
      return {
        error: "No Effective Change",
        message:
          "The series of edits resulted in no net change to the file content.",
        humanMessage: "No changes to make",
      };
    }

    await vault.modify(file, currentContentInMemory);
    abortSignal.throwIfAborted();

    // Update read state after successful multi-edit
    // const updatedFile = vault.getFileByPath(normalizePath(params.file_path));
    // if (updatedFile) {
    //   await sessionStore.readState.setLastRead(
    //     normalizePath(params.file_path),
    //     updatedFile.stat.mtime,
    //   );
    // }

    return {
      type: "update",
      filePath: params.file_path,
      message: `Successfully applied ${params.edits.length} edit operation(s) to ${params.file_path} (${totalReplacementsMadeThisCall} total replacement(s) made).`,
      editsAppliedCount: params.edits.length,
      totalReplacementsMade: totalReplacementsMadeThisCall,
    };
  } catch (e: any) {
    debug(`Error during multi-edit for file '${params.file_path}':`, e);
    if (typeof e === "object" && "name" in e && e.name === "AbortError") {
      // Rethrow AbortError so that tool is marked a error not warning
      throw e;
    }
    return {
      error: "Tool execution failed",
      message: e.message || String(e),
      humanMessage: "Unexpected error",
    };
  }
}

export const multiEditTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema: multiEditInputSchema,
  execute,
  generateDataPart: (toolPart: MultiEditToolUIPart) => {
    const { state, input } = toolPart;

    // Show file path and number of edits during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      if (!input?.file_path) return null;

      const editCount = input.edits?.length || 0;
      const editText = editCount === 1 ? "edit" : "edits";

      return {
        path: input.file_path,
        context: `${editCount} ${editText}`,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;

      // Handle recoverable error output
      if (output && "error" in output) {
        return {
          path: input?.file_path,
          context: output.humanMessage || output.message || output.error,
          error: true,
        };
      }

      // Handle success output
      if (output && "editsAppliedCount" in output) {
        const editText = output.editsAppliedCount === 1 ? "edit" : "edits";
        const replacementText =
          output.totalReplacementsMade === 1 ? "replacement" : "replacements";

        return {
          path: input.file_path,
          lines: `${output.editsAppliedCount} ${editText} • ${output.totalReplacementsMade} ${replacementText}`,
        };
      }
    }

    if (state === "output-error") {
      // Show actual error message instead of generic "(error)"
      const errorText = toolPart.errorText || "Unknown error";

      return {
        path: input?.file_path,
        lines: errorText,
      };
    }

    return null;
  },
};
