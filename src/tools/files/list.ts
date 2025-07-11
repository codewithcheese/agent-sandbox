import { z } from "zod";
import { relative, sep, join, basename } from "path-browserify";
import picomatch from "picomatch";
import { createDebug } from "$lib/debug.ts";
import { type Vault, type TAbstractFile, normalizePath } from "obsidian";
import { TFolder, TFile } from "obsidian";
import type { ToolDefinition, ToolCallOptionsWithContext } from "../types.ts";
import { COMMON_IGNORE_PATTERNS, ignoreMatchOptions } from "./shared.ts";
import { type ToolUIPart } from "ai";

/**
 * Features:
 * - Lists contents of a directory specified by an absolute path within the vault (e.g., "/folder/notes").
 * - If no path is provided, or "." is used, it lists contents of the vault's root directory.
 * - Output is formatted as a hierarchical tree structure, showing nesting.
 * - Directories are indicated with a trailing path separator (e.g., "folder/").
 * - **Ignoring Files/Directories:**
 *   - Ignores dotfiles and dot-directories by default (e.g., ".hiddenfile", ".obsidian/").
 *   - Supports custom ignore patterns (basic string matching for includes/excludes, not full glob).
 *   - Skips configured `DEFAULT_IGNORE_PATTERNS` (e.g., common large binary/cache directories) to improve performance and relevance, unless they are the target path itself.
 * - **Output Truncation:**
 *   - If the total character length of the formatted file list exceeds `MAX_OUTPUT_CHARS`, the output is truncated, and a message indicating truncation is appended.
 * - Handles unreadable subdirectories gracefully by skipping them without halting the entire listing.
 * - Cancellation using abort signal from tool execution options.
 */

export interface FileSystemNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileSystemNode[];
}

const debug = createDebug();

// Define the UI tool type for the list tool
type ListUITool = {
  input: {
    path: string;
    ignore?: string[];
  };
  output:
    | string
    | {
        error: string;
        message?: string;
        humanMessage?: string;
      };
};

type ListToolUIPart = ToolUIPart<{ List: ListUITool }>;

export const TOOL_NAME = "List";
export const TOOL_DESCRIPTION =
  "Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.";
export const TOOL_PROMPT_GUIDANCE = `Lists files and directories in a hierarchical tree structure.

Usage:
- The 'path' parameter must be an absolute path within the vault (e.g., "/folder/notes").
- The 'ignore' parameter is optional and accepts an array of glob patterns to exclude.
- Output shows directories with trailing "/" and files without.
- Hidden files/folders (starting with '.') are ignored by default.
- Large outputs are truncated to improve readability.
- Generally prefer using Glob or Grep tools when you know specific directories to search.`;
export const MAX_OUTPUT_CHARS = 40000;
export const TRUNCATION_MESSAGE = `There are more than ${MAX_OUTPUT_CHARS} characters in the vault (ie. either there are lots of files, or there are many long filenames). Use the LS tool (passing a specific path), and other tools to explore nested directories. The first ${MAX_OUTPUT_CHARS} characters are included below:\n\n`;
export const DEFAULT_IGNORE_PATTERNS = [...COMMON_IGNORE_PATTERNS];

const inputSchema = z.strictObject({
  path: z
    .string()
    .describe(
      "The absolute path to the directory to list (must be absolute, not relative)",
    ),
  ignore: z
    .array(z.string())
    .optional()
    .describe("List of glob patterns to ignore"),
});

function listDirectoryContentsRecursive(
  targetPath: string,
  abortSignal: AbortSignal,
  vault: Vault,
  ignorePatterns: string[] = [],
): string[] {
  const listedPaths: string[] = [];
  let currentOutputLength = 0;

  const effectiveIgnorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...ignorePatterns,
  ];

  // Pre-compile matcher for better performance
  const isIgnoredMatcher = picomatch(
    effectiveIgnorePatterns,
    ignoreMatchOptions,
  );

  // Cache for already checked paths to avoid redundant pattern matching
  const ignoreCache = new Map<string, boolean>();

  function isIgnored(itemPath: string, relativeItemPath: string): boolean {
    // Check cache first
    const cacheKey = relativeItemPath;
    if (ignoreCache.has(cacheKey)) {
      return ignoreCache.get(cacheKey)!;
    }

    const itemName = basename(itemPath);

    // Check if any part of the path starts with a dot (fastest check first)
    const pathParts = relativeItemPath.split(sep);
    if (pathParts.some((part) => part.startsWith("."))) {
      ignoreCache.set(cacheKey, true);
      return true;
    }

    // Use pre-compiled matcher for optimized pattern matching
    const isPathIgnored = isIgnoredMatcher(relativeItemPath);
    const isNameIgnored = isIgnoredMatcher(itemName);

    const result = isPathIgnored || isNameIgnored;
    ignoreCache.set(cacheKey, result);
    return result;
  }

  const queue: string[] = [targetPath];

  while (queue.length > 0) {
    if (currentOutputLength > MAX_OUTPUT_CHARS) {
      break;
    }
    if (abortSignal.aborted) {
      throw new Error("Operation aborted"); // Or a custom AbortError
    }

    const currentPath = queue.shift()!;
    const relativeCurrentPath = relative(targetPath, currentPath);

    if (
      currentPath !== targetPath &&
      isIgnored(currentPath, relativeCurrentPath)
    ) {
      continue;
    }

    if (currentPath !== targetPath) {
      const pathToAdd = relativeCurrentPath + sep;
      listedPaths.push(pathToAdd);
      currentOutputLength += pathToAdd.length;
    }

    // Skip default ignore patterns early if they are part of the path itself
    if (
      DEFAULT_IGNORE_PATTERNS.some(
        (ignoredDir) =>
          (currentPath + sep).includes(sep + ignoredDir + sep) &&
          !targetPath.startsWith(currentPath + sep + ignoredDir), // unless it's the target
      )
    ) {
      continue;
    }

    let entries: TAbstractFile[] = [];
    try {
      // Normalize the path for vault operations
      const normalizedPath = normalizePath(currentPath);
      const folder = vault.getFolderByPath(normalizedPath) as TFolder;
      if (folder && folder.children) {
        entries = folder.children;
      }
    } catch (e) {
      debug(`Could not read directory ${currentPath}: ${e.message}`);
      continue; // Skip unreadable directories
    }

    for (const entry of entries) {
      if (abortSignal.aborted) throw new Error("Operation aborted");

      const entryFullPath = join(currentPath, entry.name);
      const entryRelativePath = relative(targetPath, entryFullPath);

      if (isIgnored(entryFullPath, entryRelativePath)) {
        continue;
      }

      if ("children" in entry) {
        queue.push(entryFullPath);
      } else {
        listedPaths.push(entryRelativePath);
        currentOutputLength += entryRelativePath.length;
        if (currentOutputLength > MAX_OUTPUT_CHARS) break;
      }
    }
  }
  return listedPaths.sort();
}

function formatFileTree(
  root: string,
  nodes: FileSystemNode[],
  indentLevel = 0,
  prefix = "",
): string {
  let output = "";
  if (indentLevel === 0) {
    // Add prefix slash for root and suffix slash for folders
    // Obsidian normalizePath removes leading slashes, so "" means root "/"
    const rootWithSlashes = root === "" ? "/" : `/${root}/`;
    output += `- ${rootWithSlashes}\n`;
    prefix = "  ";
  }

  for (const node of nodes) {
    // Use file system separators and add suffix slash for directories
    const nodeName = node.name.replace(/\//g, sep);
    output += `${prefix}- ${nodeName}${node.type === "directory" ? sep : ""}\n`;
    if (node.children && node.children.length > 0) {
      output += formatFileTree(
        root,
        node.children,
        indentLevel + 1,
        `${prefix}  `,
      );
    }
  }
  return output;
}

function buildFileTree(paths: string[]): FileSystemNode[] {
  const rootNodes: FileSystemNode[] = [];
  const map: Record<string, FileSystemNode> = {};

  for (const p of paths) {
    const parts = p.split(sep).filter((part) => part !== "");
    let currentLevelNodes = rootNodes;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}${sep}${part}` : part;
      const isLastPart = i === parts.length - 1;
      const nodeType = p.endsWith(sep) || !isLastPart ? "directory" : "file";

      let node = map[currentPath];
      if (!node) {
        node = { name: part, path: currentPath, type: nodeType };
        if (nodeType === "directory") {
          node.children = [];
        }
        map[currentPath] = node;
        currentLevelNodes.push(node);
      }
      if (node.type === "directory") {
        currentLevelNodes = node.children!;
      }
    }
  }
  return rootNodes;
}

export async function execute(
  params: z.infer<typeof inputSchema>,
  options: ToolCallOptionsWithContext,
) {
  const { getContext, abortSignal } = options;
  const { vault } = getContext();

  debug("Executing list tool", params);

  try {
    const targetPath = normalizePath(params.path);
    const ignorePatterns = params.ignore || [];

    const folder = vault.getFolderByPath(targetPath);
    if (!folder) {
      return {
        error: true,
        message: `The folder "${targetPath}" does not exist.`,
        humanMessage: "Not found",
      };
    }

    const listedFilesArray = listDirectoryContentsRecursive(
      targetPath,
      abortSignal,
      vault,
      ignorePatterns,
    );

    abortSignal.throwIfAborted();

    const fileNodes = buildFileTree(listedFilesArray);
    const formattedTreeString = formatFileTree(targetPath, fileNodes);

    let resultData: string;
    if (formattedTreeString.length < MAX_OUTPUT_CHARS) {
      resultData = formattedTreeString;
    } else {
      // Truncate the formatted string itself if it's too long
      resultData = `${TRUNCATION_MESSAGE}${formattedTreeString.substring(0, MAX_OUTPUT_CHARS - TRUNCATION_MESSAGE.length)}`;
    }

    return resultData.trimEnd();
  } catch (e) {
    console.error(`Error executing LS tool for path '${params.path}':`, e);
    if (typeof e === "object" && "name" in e && e.name === "AbortError") {
      // Rethrow AbortError so that tool is marked a error not warning
      throw e;
    }
    return {
      error: "Tool execution failed",
      message: e instanceof Error ? e.message : String(e),
      humanMessage: "List failed",
    };
  }
}

export const listTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: ListToolUIPart) => {
    const { state, input } = toolPart;

    // Show directory path during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      if (!input?.path) return null;

      return {
        title: "List",
        context: input.path,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;

      // Handle recoverable error output
      if (output && typeof output === "object" && "error" in output) {
        return {
          title: "List",
          context: output.humanMessage || output.message || output.error,
          error: true,
        };
      }

      // Handle success output (string result)
      if (typeof output === "string") {
        // Count items in the directory listing
        const lines = output
          .split("\n")
          .filter((line) => line.trim() && line.includes("- "));
        const itemCount = lines.length;

        return {
          title: "List",
          context: input?.path || "",
          lines: itemCount === 1 ? "1 item" : `${itemCount} items`,
        };
      }
    }

    if (state === "output-error") {
      // Show actual error message instead of generic "(error)"
      const errorText = toolPart.errorText || "Unknown error";

      return {
        title: "List",
        context: input?.path,
        lines: errorText,
      };
    }

    return null;
  },
};
