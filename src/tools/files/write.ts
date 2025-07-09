import { z } from "zod";
import { normalizePath, TFile, type Vault } from "obsidian";
import { createDebug } from "$lib/debug";
import type { ToolDefinition, ToolCallOptionsWithContext } from "../types.ts";
import { invariant } from "@epic-web/invariant";
import { type ToolUIPart } from "ai";

// Define the UI tool type for the write tool
type WriteUITool = {
  input: {
    file_path: string;
    content: string;
  };
  output: {
    type: "update" | "create";
    filePath: string;
    message: string;
    contentSnippet?: string;
  } | {
    error: string;
    message?: string;
    humanMessage?: string;
    meta?: any;
  };
};

type WriteToolUIPart = ToolUIPart<{ Write: WriteUITool }>;

/**
 * Features:
 * - Creates new files or completely overwrites existing files with the provided content.
 * - Expects absolute paths within the vault (e.g., "/folder/file.md").
 * - Normalizes line endings in the provided content to `\n`.
 * - (Future Feature) Consistency Checks:
 *   - Requires a file to have been read recently. To prevent accidental overwrites of unseen content.
 *   - Prevent writing if the file has been modified on disk since it was last read, prompting a re-read to resolve conflicts.
 *   - Updates last read state with the new content and modification timestamp upon successful write.
 * - Relies on vault overlay to create parent directories if they do not exist.
 * - Validates against writing to disallowed paths (e.g., `.obsidian/` folder).
 * - Returns an error if the target path is an existing directory.
 * - Returns a success message indicating whether a file was created or updated, along with a snippet of the written content.
 * - (Future Feature) Returns a structured diff of the changes if the file was updated.
 * - Cancellation using abort signal from tool execution options.
 */

const debug = createDebug();

export const defaultConfig = {};

export const TOOL_NAME = "Write";
export const TOOL_DESCRIPTION = "Writes a file to the local filesystem.";
export const TOOL_PROMPT_GUIDANCE = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST have used the Read tool recently to read the file's contents. This tool will fail if you did not read the file first or if the file was modified since the last read.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- The file_path parameter must be an absolute path within the vault (e.g., /folder/file.md).
- The content provided will completely replace the file's existing content.`;

const writeInputSchema = z.strictObject({
  file_path: z
    .string()
    .describe(
      "The absolute path to the file to write within the vault (e.g., /folder/file.md)",
    ),
  content: z.string().describe("The content to write to the file"),
});

type WriteToolOutput = {
  type: "update" | "create";
  filePath: string;
  message: string;
  contentSnippet?: string;
} | {
  error: string;
  message?: string;
  humanMessage?: string;
  meta?: any;
};

async function validateWriteInput(
  params: z.infer<typeof writeInputSchema>,
  vault: Vault,
  config: typeof defaultConfig,
  readState: any, // ReadState accessed through sessionStore
): Promise<{ result: boolean; message?: string; humanMessage?: string; meta?: any }> {
  const path = normalizePath(params.file_path);

  // Check if any part of the path starts with a dot
  const pathParts = path.split("/");
  if (pathParts.some((part) => part.startsWith("."))) {
    return {
      result: false,
      message:
        "Writing to hidden files/folders (starting with '.') is not allowed.",
      humanMessage: "Hidden path not allowed",
    };
  }

  if (vault.getFolderByPath(path)) {
    return {
      result: false,
      message: "Path is a directory, cannot write file content to a directory.",
      humanMessage: "Path is a directory",
    };
  }

  // Check if file exists - if it does, it must have been read recently
  // const existingFile = vault.getFileByPath(path);
  // if (existingFile) {
  // Read-before-write check
  // const hasBeenRead = await readState.hasBeenRead(path);
  // if (!hasBeenRead) {
  //   return {
  //     result: false,
  //     message:
  //       "File has not been read yet. Read it first before writing to it.",
  //   };
  // }

  // Modified-since-read check
  // const isModified = await readState.isModifiedSinceRead(
  //   path,
  //   existingFile.stat.mtime,
  // );
  // if (isModified) {
  //   return {
  //     result: false,
  //     message:
  //       "File has been modified since read. Read it again before attempting to write.",
  //   };
  // }
  // }

  return { result: true };
}

export async function execute(
  params: z.infer<typeof writeInputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<WriteToolOutput> {
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

  const validation = await validateWriteInput(
    params,
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

  const normalizedFilePath = normalizePath(params.file_path);
  const abstractFile = vault.getAbstractFileByPath(normalizedFilePath);
  const fileExists = !!abstractFile;

  try {
    if (abortSignal.aborted) {
      throw new Error("Operation aborted");
    }

    const newContent = params.content.replace(/\r\n/g, "\n");

    if (fileExists) {
      await vault.modify(abstractFile as TFile, newContent);
    } else {
      await vault.create(normalizedFilePath, newContent);
    }

    // Update read state after successful write
    // const updatedFile = vault.getFileByPath(normalizedFilePath);
    // if (updatedFile) {
    //   await sessionStore.readState.setLastRead(
    //     normalizedFilePath,
    //     updatedFile.stat.mtime,
    //   );
    // }

    return {
      type: fileExists ? "update" : "create",
      filePath: params.file_path,
      message: fileExists
        ? `Successfully updated ${params.file_path}.`
        : `Successfully created ${params.file_path}.`,
      contentSnippet:
        newContent.substring(0, 200) + (newContent.length > 200 ? "..." : ""),
    };
  } catch (e: any) {
    debug(`Error writing file '${params.file_path}':`, e);
    return {
      error: "Tool execution failed",
      message: e.message || String(e),
      humanMessage: "Write failed",
    };
  }
}

export const writeTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema: writeInputSchema,
  execute,
  generateDataPart: (toolPart: WriteToolUIPart) => {
    const { state, input } = toolPart;

    // Helper function to get content size info
    const getContentSize = (content: string) => {
      const lines = content.split("\n").length;
      const chars = content.length;

      // If it's a small file, show line count
      if (lines <= 1000) {
        return `${lines} lines`;
      }
      // For larger files, show KB size
      const kb = (chars / 1024).toFixed(1);
      return `${kb} KB`;
    };

    // Show path and content size as soon as we have input
    if (state === "input-available" || state === "input-streaming") {
      if (!input?.file_path) return null;

      return {
        path: input.file_path,
        lines: input.content ? getContentSize(input.content) : undefined,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;
      if (!output) return null;
      
      // Handle recoverable error output
      if ("error" in output) {
        return {
          path: input?.file_path,
          context: output.humanMessage || output.message || output.error,
          error: true,
        };
      }

      return {
        path: input.file_path,
        lines: input.content ? getContentSize(input.content) : undefined,
      };
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
