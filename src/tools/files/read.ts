import { z } from "zod";
import { tool, type ToolUIPart } from "ai";
import { normalizePath, TFile, TFolder, type Vault } from "obsidian";
import { createDebug } from "$lib/debug";
import type { ToolDefinition, ToolCallOptionsWithContext } from "../types.ts";

// Define the UI tool type for the read tool
type ReadUITool = {
  input: {
    file_path: string;
    offset?: number;
    limit?: number;
  };
  output:
    | {
        type: "image";
        file: {
          base64: string;
          type: string;
          originalSize: number;
          file_path: string;
        };
      }
    | string;
};

type ReadToolUIPart = ToolUIPart<{ Read: ReadUITool }>;

/**
 * Features:
 * - Reads text and image files (common formats like PNG, JPG, GIF, WEBP).
 * - Expects absolute paths within the vault (e.g., "/folder/file.md").
 * - For text files:
 *   - Supports reading a specified range of lines (offset & limit).
 *   - Defaults to reading up to `DEFAULT_LINE_LIMIT` lines.
 *   - Truncates individual lines longer than `MAX_LINE_LENGTH`.
 *   - Formats output with 1-indexed line numbers (similar to `cat -n`).
 *   - Returns an error for text files larger than `MAX_TEXT_FILE_SIZE_NO_OFFSET_LIMIT` if no offset/limit is given.
 *   - Truncates overall text output if it becomes excessively long after formatting.
 * - For image files:
 *   - Returns base64 encoded data and metadata for images up to `MAX_IMAGE_SIZE_BYTES`.
 *   - Returns a placeholder/error for images exceeding this size.
 * - Validates against disallowed binary file types (e.g., executables, archives).
 * - Returns specific error messages for common issues (file not found, path is directory, empty image, etc.).
 * - Cancellation using abort signal from tool execution options.
 */

const debug = createDebug();

export const defaultConfig = {
  DEFAULT_LINE_OFFSET: 1,
  DEFAULT_LINE_LIMIT: 2000,
  MAX_LINE_LENGTH: 2000,
  MAX_TEXT_FILE_SIZE: 256 * 1024,
  MAX_IMAGE_SIZE_BYTES: 3.75 * 1024 * 1024,
  IMAGE_EXTENSIONS: new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]),
  BINARY_EXTENSIONS_NO_IMAGE: new Set([
    "mp3",
    "wav",
    "flac",
    "ogg",
    "aac",
    "m4a",
    "wma",
    "aiff",
    "opus",
    "mp4",
    "avi",
    "mov",
    "wmv",
    "flv",
    "mkv",
    "webm",
    "m4v",
    "mpeg",
    "mpg",
    "zip",
    "rar",
    "tar",
    "gz",
    "bz2",
    "7z",
    "xz",
    "z",
    "tgz",
    "iso",
    "exe",
    "dll",
    "so",
    "dylib",
    "app",
    "msi",
    "deb",
    "rpm",
    "bin",
    "dat",
    "db",
    "sqlite",
    "sqlite3",
    "mdb",
    "idx",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "ods",
    "odp",
    "ttf",
    "otf",
    "woff",
    "woff2",
    "eot",
    "psd",
    "ai",
    "eps",
    "sketch",
    "fig",
    "xd",
    "blend",
    "obj",
    "3ds",
    "max",
    "class",
    "jar",
    "war",
    "pyc",
    "pyo",
    "rlib",
    "swf",
    "fla",
  ]),
};

const TOOL_NAME = "Read";
const TOOL_DESCRIPTION = "Reads a file from the local filesystem.";
const TOOL_PROMPT_GUIDANCE = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path within the vault (e.g., /folder/file.md).
- By default, it reads up to {{ DEFAULT_LINE_LIMIT }} lines starting from the beginning of the file.
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters if unsure.
- Any lines longer than {{ MAX_LINE_LENGTH }} characters will be truncated.
- Results are returned using cat -n format, with line numbers starting at 1.
- This tool allows {{ AGENT_NAME }} to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as {{ AGENT_NAME }} is a multimodal LLM.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`;

// --- Input Schema ---
const inputSchema = z.strictObject({
  file_path: z
    .string()
    .describe(
      "The absolute path to the file to read within the vault (e.g., /folder/file.md)",
    ),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The 1-indexed line number to start reading from. Only provide if the file is too large to read at once.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The number of lines to read. Only provide if the file is too large to read at once.",
    ),
});

async function validateReadInput(
  params: z.infer<typeof inputSchema>,
  vault: Vault,
  config: typeof defaultConfig,
): Promise<{
  result: boolean;
  message?: string;
  meta?: any;
}> {
  const path = normalizePath(params.file_path);

  const abstractFile = vault.getAbstractFileByPath(path);

  if (!abstractFile) {
    let message = "File does not exist.";
    return { result: false, message };
  }

  const folder = vault.getFolderByPath(path);
  if (folder) {
    return {
      result: false,
      message:
        "Path is a directory, not a file. Use LS tool to list directory contents.",
    };
  }

  const file = vault.getFileByPath(path);
  const fileSize = file.stat.size;
  const fileExt = file.extension.toLowerCase();

  if (config.BINARY_EXTENSIONS_NO_IMAGE.has(fileExt)) {
    return {
      result: false,
      message: `This tool cannot read binary files of type .${fileExt}. Please use appropriate tools for binary file analysis.`,
    };
  }

  if (fileSize === 0 && config.IMAGE_EXTENSIONS.has(fileExt)) {
    return {
      result: false,
      message: "Empty image files cannot be processed.",
    };
  }

  if (!config.IMAGE_EXTENSIONS.has(fileExt)) {
    if (
      fileSize > config.MAX_TEXT_FILE_SIZE &&
      !params.offset &&
      !params.limit
    ) {
      const errorMsg = `File content (${Math.round(fileSize / 1024)}KB) exceeds maximum allowed size (${Math.round(config.MAX_TEXT_FILE_SIZE / 1024)}KB). Please use offset and limit parameters to read specific portions of the file, or use the GrepTool to search for specific content.`;
      return {
        result: false,
        message: errorMsg,
        meta: { fileSize },
      };
    }
  }
  return { result: true };
}

/**
 * Formats file content with line numbers (emulates cat -n) and handles truncation
 */
export function formatWithLineNumbers(
  lines: string[],
  filePath: string,
  offset: number, // 1-indexed
  limit: number,
  maxLineLength: number,
  maxOutputLength: number,
): string {
  const actualOffset = Math.max(0, offset - 1);
  const selectedLines = lines.slice(actualOffset, actualOffset + limit);

  const processedLines = selectedLines.map((line) =>
    line.length > maxLineLength
      ? line.substring(0, maxLineLength) + "...[truncated]"
      : line,
  );

  const numberedLines = processedLines.map(
    (line, index) => `${String(actualOffset + index + 1).padStart(6)}\t${line}`,
  );

  let outputString = numberedLines.join("\n");

  // Simplified output length check (vs. token check in original)
  if (outputString.length > maxOutputLength) {
    outputString =
      outputString.substring(0, maxOutputLength) +
      "\n...[output truncated due to excessive length]";
  }

  return `File: ${filePath}\nLines ${offset}-${offset + processedLines.length - 1} of ${lines.length}:\n\`\`\`\n${outputString}\n\`\`\``;
}

export async function execute(
  params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
) {
  const { abortSignal } = toolExecOptions;
  const {
    vault,
    config: contextConfig,
    sessionStore,
  } = toolExecOptions.getContext();
  const config = { ...defaultConfig, ...contextConfig };

  if (!vault) {
    return { error: "Vault not available in execution context." };
  }

  const validation = await validateReadInput(params, vault, config);
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
    const fileExt = file.extension.toLowerCase();

    if (config.IMAGE_EXTENSIONS.has(fileExt)) {
      if (file.stat.size > config.MAX_IMAGE_SIZE_BYTES) {
        return {
          error: "Image too large",
          file_path: params.file_path,
          message: `Image is too large (${(file.stat.size / 1024 / 1024).toFixed(2)}MB). Max size is ${(config.MAX_IMAGE_SIZE_BYTES / 1024 / 1024).toFixed(2)}MB.`,
        };
      }
      const binaryContents = await vault.readBinary(file);
      if (abortSignal.aborted)
        return {
          error: "Operation aborted",
          message: "Read operation aborted by user",
          file_path: params.file_path,
        };
      const base64 = Buffer.from(binaryContents).toString("base64");

      // Update read state for image files
      await sessionStore.readState.setLastRead(
        normalizedFilePath,
        file.stat.mtime,
      );

      return {
        type: "image",
        file: {
          base64: base64,
          type: `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
          originalSize: file.stat.size,
          file_path: params.file_path, // Include for context
        },
      };
    }

    // Text file handling
    const fileContentString = await vault.read(file);
    if (abortSignal.aborted)
      return {
        error: "Operation aborted",
        message: "Read operation aborted by user",
        file_path: params.file_path,
      };

    const lines = fileContentString.split("\n");
    const offset = params.offset ?? config.DEFAULT_LINE_OFFSET;
    const limit = params.limit ?? config.DEFAULT_LINE_LIMIT;

    if (params.offset && params.offset > lines.length) {
      return `<system-reminder>Warning: the file ${params.file_path} exists but the requested content (lines ${params.offset}-${params.offset + (params.limit ?? config.DEFAULT_LINE_LIMIT - 1)}) is out of bounds.</system-reminder>`;
    } else if (fileContentString.length === 0) {
      return `<system-reminder>Warning: the file ${params.file_path} exists but the requested content is empty.</system-reminder>`;
    }

    // Update read state for text files
    await sessionStore.readState.setLastRead(
      normalizedFilePath,
      file.stat.mtime,
    );

    return formatWithLineNumbers(
      lines,
      params.file_path,
      offset,
      limit,
      config.MAX_LINE_LENGTH,
      config.MAX_TEXT_FILE_SIZE * 1.5,
    );
  } catch (e) {
    debug(`Error reading file '${params.file_path}':`, e);
    return {
      error: "Tool execution failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export const readTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: ReadToolUIPart, streamingInfo) => {
    const { state, input } = toolPart;
    debugger;

    // Streaming state
    if (state === "input-streaming") {
      return {
        title: "Read File",
        description: "Preparing to read file...",
        status: "streaming",
        streamingInfo: {
          tokenCount: streamingInfo?.tokenCount || 0,
          isStreaming: true,
        },
        infoItems: [
          {
            icon: "clock",
            label: "Status",
            value: "Streaming",
            color: "accent",
          },
          {
            icon: "hash",
            label: "Tokens",
            value: String(streamingInfo?.tokenCount || 0),
            color: "muted",
          },
        ],
      };
    }

    // Input available - show what file will be read
    if (state === "input-available") {
      return {
        title: "Read File",
        description: "Reading file...",
        status: "loading",
        infoItems: [
          {
            icon: "file",
            label: "File",
            value: input?.file_path || "Unknown",
            color: "normal",
          },
          {
            icon: "hash",
            label: "Lines",
            value: input?.limit ? String(input.limit) : "All",
            color: "muted",
          },
          {
            icon: "clock",
            label: "Status",
            value: "Processing",
            color: "accent",
          },
        ],
      };
    }

    // Success - show file content
    if (state === "output-available") {
      const { output } = toolPart;
      if (output && typeof output === "object" && output.type === "image") {
        return {
          title: "Image File",
          description: "Image loaded successfully",
          status: "success",
          infoItems: [
            {
              icon: "file",
              label: "Path",
              value: input.file_path,
              color: "normal",
            },
            {
              icon: "ruler",
              label: "Size",
              value: `${(output.file.originalSize / 1024).toFixed(1)} KB`,
              color: "muted",
            },
            {
              icon: "image",
              label: "Type",
              value: output.file.type,
              color: "success",
            },
          ],
          preview: {
            type: "image",
            content: output.file.base64,
            maxHeight: "12rem",
          },
        };
      } else if (typeof output === "string") {
        // Extract file info from formatted output
        const lines = output.split("\n");
        const filePathMatch = lines[0]?.match(/^File: (.+)$/);
        const linesMatch = lines[1]?.match(/^Lines (\d+)-(\d+) of (\d+):$/);

        return {
          title: "Text File",
          description: "File read successfully",
          status: "success",
          infoItems: [
            {
              icon: "file",
              label: "Path",
              value: filePathMatch?.[1] || input.file_path,
              color: "normal",
            },
            {
              icon: "hash",
              label: "Lines Read",
              value: linesMatch
                ? `${linesMatch[1]}-${linesMatch[2]}`
                : "Unknown",
              color: "muted",
            },
            {
              icon: "type",
              label: "Total Lines",
              value: linesMatch?.[3] || "Unknown",
              color: "muted",
            },
            {
              icon: "check",
              label: "Status",
              value: "Completed",
              color: "success",
            },
          ],
          preview: {
            type: "text",
            content:
              output.length > 800 ? output.substring(0, 800) + "..." : output,
            truncated: output.length > 800,
            maxHeight: "8rem",
          },
        };
      }
    }

    // Error state
    if (state === "output-error") {
      return {
        title: "Read File",
        description: "Failed to read file",
        status: "error",
        infoItems: [
          {
            icon: "file",
            label: "Path",
            value: input.file_path,
            color: "normal",
          },
          { icon: "x", label: "Status", value: "Error", color: "error" },
        ],
      };
    }

    return null;
  },
};
