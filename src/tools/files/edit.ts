import { z } from "zod";
import { tool } from "ai";
import { normalizePath, type Vault } from "obsidian";
import { createDebug } from "$lib/debug";
import type { ToolDefinition, ToolCallOptionsWithContext } from "../types.ts";
import { invariant } from "@epic-web/invariant";
import { escapeRegExp } from "$lib/utils/regexp.ts";
import type { ReadState } from "../../chat/read-state.ts";
import { type ToolUIPart } from "ai";

/**
 * Features:
 * - Replaces specific occurrences of `old_string` with `new_string` in an existing file.
 * - Expects absolute paths within the vault (e.g., "/folder/file.md").
 * - Requires `expected_replacements` parameter (defaults to 1) to specify how many occurrences of `old_string` should be found and replaced. The operation fails if the actual count doesn't match.
 * - (Future Feature) **Consistency Checks**
 *   - Require the target file to have been read recently using a `Read` tool. This prevents editing unseen content.
 *   - Prevent editing if the file has been modified on disk since it was last recorded, prompting a re-read to resolve potential conflicts.
 *   - Updates read state with the new content and modification timestamp upon successful edit.
 * - Validates against editing hidden files/folders (e.g., `.obsidian/` folder) or attempting to edit a directory.
 * - Returns an error if `old_string` is empty or if `old_string` and `new_string` are identical.
 * - Returns an error if `old_string` is not found in the file.
 * - Returns a success message indicating the file path and the number of replacements made.
 * - (Future Feature) Could return a structured diff of the changes if the file was updated.
 * - Cancellation support using the `abortSignal` from tool execution options.
 * - Normalizes line endings in the content being written to `\n`.
 */

const debug = createDebug();

// Define the UI tool type for the edit tool
type EditUITool = {
  input: {
    file_path: string;
    old_string: string;
    new_string: string;
    expected_replacements?: number;
  };
  output: {
    type: "update";
    filePath: string;
    message: string;
    replacementsMade: number;
  } | {
    error: string;
    message?: string;
    meta?: any;
  };
};

type EditToolUIPart = ToolUIPart<{ Edit: EditUITool }>;

export const defaultConfig = {};

export const TOOL_NAME = "Edit";
export const TOOL_DESCRIPTION =
  "A tool for editing files by replacing specific strings.";
export const TOOL_PROMPT_GUIDANCE = `Performs exact string replacements in files with strict occurrence count validation.

Usage:
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- The file_path parameter must be an absolute path within the vault (e.g., /folder/file.md).
- old_string: The exact text to replace.
- new_string: The text to replace it with. Must be different from old_string.
- expected_replacements: The number of times old_string is expected to appear and be replaced. Defaults to 1. If the actual count differs, the operation will fail.
- This tool requires the file to have been read recently and not modified since.`;

const editInputSchema = z.strictObject({
  file_path: z
    .string()
    .describe(
      "The absolute path to the file to modify within the vault (e.g., /folder/file.md)",
    ),
  old_string: z.string().describe("The text to replace"),
  new_string: z
    .string()
    .describe(
      "The text to replace it with (must be different from old_string)",
    ),
  expected_replacements: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The expected number of replacements to perform. Defaults to 1 if not specified.",
    ),
});

type EditToolOutput =
  | {
      type: "update";
      filePath: string;
      message: string;
      replacementsMade: number;
    }
  | {
      error: string;
      message?: string;
      meta?: any;
    };

async function validateInput(
  params: z.infer<typeof editInputSchema>,
  vault: Vault,
  config: typeof defaultConfig,
  readState: ReadState,
): Promise<{ result: boolean; message?: string; meta?: any }> {
  if (params.old_string === "") {
    return {
      result: false,
      message: "old_string cannot be empty for an edit operation.",
    };
  }

  if (params.old_string === params.new_string) {
    return {
      result: false,
      message:
        "No changes to make: old_string and new_string are exactly the same.",
    };
  }

  const path = normalizePath(params.file_path);

  // Disallow editing dot files or files in dot folders for safety
  const pathParts = path.split("/");
  if (pathParts.some((part) => part.startsWith("."))) {
    return {
      result: false,
      message:
        "Editing hidden files/folders (starting with '.') is not allowed.",
    };
  }

  if (vault.getFolderByPath(path)) {
    return {
      result: false,
      message: "Path is a directory, not a file. Cannot edit a directory.",
    };
  }

  const file = vault.getFileByPath(path);

  if (!file) {
    return {
      result: false,
      message: `File does not exist: ${params.file_path}`,
    };
  }

  let currentContent;
  try {
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

    // Check if old_string exists and matches expected_replacements
    currentContent = (await vault.read(file)).replace(/\r\n/g, "\n");
  } catch (error) {
    return {
      result: false,
      message: `Failed to read file: ${params.file_path}. Error: ${error}`,
    };
  }

  const occurrences = (
    currentContent.match(new RegExp(escapeRegExp(params.old_string), "g")) || []
  ).length;

  if (occurrences === 0) {
    return {
      result: false,
      message: `The 'old_string' was not found in the file: ${params.file_path}. Please ensure it matches exactly, including whitespace and line breaks.`,
    };
  }

  if (occurrences !== (params.expected_replacements || 1)) {
    return {
      result: false,
      message: `Found ${occurrences} occurrences of 'old_string', but expected ${params.expected_replacements}. Please verify 'old_string' and 'expected_replacements', or use MultiEdit for more complex scenarios.`,
    };
  }

  return { result: true };
}

export async function execute(
  params: z.infer<typeof editInputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<EditToolOutput> {
  const { abortSignal } = toolExecOptions;
  const {
    vault,
    config: contextConfig,
    sessionStore,
  } = toolExecOptions.getContext();
  const config = { ...defaultConfig, ...contextConfig };

  invariant(vault, "Vault not available in execution context.");

  const validation = await validateInput(
    params,
    vault,
    config,
    sessionStore.readState,
  );
  if (!validation.result) {
    return {
      error: "Input Validation Failed",
      message: validation.message,
      meta: validation.meta,
    };
  }

  const normalizedFilePath = normalizePath(params.file_path);
  const file = vault.getFileByPath(normalizedFilePath);

  try {
    const originalFileContent = (await vault.read(file)).replace(/\r\n/g, "\n");
    if (abortSignal.aborted)
      return {
        error: "Operation aborted",
        message: "Edit operation aborted by user.",
      };

    const oldString = params.old_string;
    const newString = params.new_string;

    // Perform replacement - RegExp ensures global replacement for the validated count
    const updatedFileContent = originalFileContent.replace(
      new RegExp(escapeRegExp(oldString), "g"),
      newString,
    );
    const actualReplacements = params.expected_replacements ?? 1; // Already validated this count matches

    await vault.modify(file, updatedFileContent);
    if (abortSignal.aborted) {
      return {
        error: "Operation aborted",
        message: "Edit operation aborted by user.",
      };
    }

    // Update read state after successful edit
    // const updatedFile = vault.getFileByPath(normalizedFilePath);
    // if (updatedFile) {
    //   await sessionStore.readState.setLastRead(
    //     normalizedFilePath,
    //     updatedFile.stat.mtime,
    //   );
    // }

    return {
      type: "update",
      filePath: params.file_path,
      message: `Successfully edited ${params.file_path} (${actualReplacements} replacement(s) made).`,
      replacementsMade: actualReplacements,
    };
  } catch (e: any) {
    debug(`Error editing file '${params.file_path}':`, e);
    return {
      error: "Tool execution failed",
      message: e.message || String(e),
    };
  }
}

export const editTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema: editInputSchema,
  execute,
  generateDataPart: (toolPart: EditToolUIPart) => {
    const { state, input } = toolPart;

    // Show file path and expected replacements during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      if (!input?.file_path) return null;
      
      const expectedReplacements = input.expected_replacements ?? 1;
      const replacementText = expectedReplacements === 1 ? "replacement" : "replacements";
      
      return {
        path: input.file_path,
        context: `${expectedReplacements} ${replacementText}`,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;
      
      // Handle error output
      if (output && 'error' in output) {
        return {
          path: input?.file_path,
          context: "(error)",
        };
      }
      
      // Handle success output
      if (output && 'replacementsMade' in output) {
        const replacementText = output.replacementsMade === 1 ? "replacement" : "replacements";
        
        return {
          path: input.file_path,
          lines: `${output.replacementsMade} ${replacementText}`,
        };
      }
    }

    if (state === "output-error") {
      return {
        path: input?.file_path,
        context: "(error)",
      };
    }

    return null;
  },
};
