import { z } from "zod";
import {
  normalizePath,
  TFile,
  TFolder,
  type TAbstractFile,
  type Vault,
} from "obsidian";
import picomatch from "picomatch";
import { createDebug } from "$lib/debug";
import type { ToolDefinition, ToolCallOptionsWithContext } from "../types.ts";
import { invariant } from "@epic-web/invariant";
import {
  COMMON_IGNORE_PATTERNS,
  ignoreMatchOptions,
  patternMatchOptions,
} from "./shared.ts";
import { type ToolUIPart } from "ai";

/**
 * Features:
 * - Fast file pattern matching using glob syntax
 * - Supports complex patterns like "**\/*.js", "src/**\/*.{ts,tsx}", "notes/**\/draft-*.md"
 * - Optional directory scoping to search within specific vault folders
 * - Customizable ignore patterns to exclude unwanted files/folders
 * - Results sorted by modification time (newest first) for relevance
 * - Configurable result limits to prevent overwhelming output
 * - Handles hidden files/folders when explicitly included in patterns
 * - Built-in ignore patterns for common Obsidian folders (.obsidian, .trash)
 * - Comprehensive error handling with detailed validation messages
 * - Path normalization for cross-platform compatibility
 *
 * Common Use Cases:
 * - Find all markdown files: "**\/*.md"
 * - Find TypeScript files in src: "src/**\/*.ts"
 * - Find files with specific naming: "**\/draft-*.md"
 * - Find files in a specific folder: "projects/**\/*" with path="/work"
 * - Exclude certain patterns: pattern="**\/*.md", ignore=["**\/archive/**"]
 *
 * Performance Notes:
 * - Efficiently traverses vault structure using Obsidian's native file system
 * - Micromatch library provides fast pattern matching
 * - Results are limited and sorted to maintain responsiveness
 * - Validation occurs before expensive operations
 */

const debug = createDebug();

// Define the UI tool type for the glob tool
type GlobUITool = {
  input: {
    pattern: string;
    path?: string;
    ignore?: string[];
  };
  output: {
    filenames: string[];
    numFiles: number;
    totalMatchesBeforeLimit: number;
    truncated: boolean;
  } | {
    error: string;
    message?: string;
    humanMessage?: string;
    meta?: any;
  };
};

type GlobToolUIPart = ToolUIPart<{ Glob: GlobUITool }>;

export const defaultConfig = {
  RESULT_LIMIT: 100, // Max number of files to return
  DEFAULT_IGNORE_PATTERNS: [
    // Patterns to always ignore, relative to the search root
    "**/.obsidian/**", // Obsidian config folder
    "**/.trash/**", // Obsidian trash folder
    "**/.overlay-trash/**",
    ...COMMON_IGNORE_PATTERNS,
  ],
};

export const TOOL_NAME = "Glob";
export const TOOL_DESCRIPTION =
  'Fast file pattern matching tool. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time (newest first).';
export const TOOL_PROMPT_GUIDANCE = `Use this tool to find files by name patterns using glob syntax.
- The 'pattern' parameter is required and specifies the glob pattern (e.g., "notes/**/*.md", "*.txt").
- The 'path' parameter is optional and specifies the directory to search within. If omitted, searches from the vault root. Paths should be absolute within the vault (e.g., "/My Folder").
- The 'ignore' parameter is an optional array of glob patterns to exclude from results.
- Results are sorted by last modification time, newest first.
- A maximum of {{ RESULT_LIMIT }} files will be returned.
- Hidden files/folders (starting with '.') are matched if the pattern explicitly includes them (e.g., ".*" or ".config/**"). Default ignore patterns include common Obsidian folders like '.obsidian'.`;

const globInputSchema = z.strictObject({
  pattern: z
    .string()
    .describe('The glob pattern to match files against (e.g., "**/*.md")'),
  path: z
    .string()
    .optional()
    .describe(
      'The absolute path within the vault to search in (e.g., "/documents/projects"). Defaults to vault root if omitted.',
    ),
  ignore: z
    .array(z.string())
    .optional()
    .describe(
      'List of glob patterns to ignore (e.g., ["**/drafts/**", "*.tmp"])',
    ),
});

type GlobToolOutput = {
  filenames: string[];
  numFiles: number;
  totalMatchesBeforeLimit: number;
  truncated: boolean;
} | {
  error: string;
  message?: string;
  humanMessage?: string;
  meta?: any;
};

async function validateInput(
  params: z.infer<typeof globInputSchema>,
  vault: Vault,
  config: typeof defaultConfig,
): Promise<{ result: boolean; message?: string; humanMessage?: string; meta?: any }> {
  const rootPath = normalizePath(params.path || "/");
  const rootEntry = vault.getAbstractFileByPath(rootPath);

  if (!rootEntry) {
    return {
      result: false,
      message: `Specified search path does not exist: ${rootPath}`,
      humanMessage: "Path not found",
    };
  }
  if (!(rootEntry instanceof TFolder)) {
    return {
      result: false,
      message: `Specified search path is not a directory: ${rootPath}`,
      humanMessage: "Path is not a directory",
    };
  }

  return {
    result: true,
  };
}

export async function execute(
  params: z.infer<typeof globInputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<GlobToolOutput> {
  const { abortSignal } = toolExecOptions;
  const { vault, config: contextConfig } = toolExecOptions.getContext();

  const config = { ...defaultConfig, ...contextConfig };

  if (!vault) {
    throw new Error("Vault not available in execution context");
  }

  const validation = await validateInput(params, vault, config);
  if (!validation.result) {
    return {
      error: "Input Validation Failed",
      message: validation.message,
      humanMessage: validation.humanMessage,
      meta: validation.meta,
    };
  }

  try {
    const rootPath = normalizePath(params.path || "/");
    const rootEntry = vault.getFolderByPath(rootPath);

    const matchedFiles: TFile[] = [];
    const ignorePatterns = [
      ...config.DEFAULT_IGNORE_PATTERNS,
      ...(params.ignore || []),
    ];

    // Pre-compile matchers for better performance
    const isIgnoredMatcher = picomatch(ignorePatterns, ignoreMatchOptions);
    const patternMatcher = picomatch(params.pattern, {
      ...patternMatchOptions,
      // match basename is pattern does not include '/'
      basename: !params.pattern.includes("/"),
    });

    function isPathIgnored(path: string): boolean {
      return isIgnoredMatcher(path);
    }

    async function traverse(currentVaultEntry: TAbstractFile) {
      if (abortSignal.aborted) throw new Error("Operation aborted by user.");

      const path = currentVaultEntry.path;

      if (currentVaultEntry instanceof TFile) {
        if (!isPathIgnored(path) && patternMatcher(path)) {
          matchedFiles.push(currentVaultEntry);
        }
      } else if (currentVaultEntry instanceof TFolder) {
        if (isPathIgnored(path)) {
          return; // Don't traverse ignored directories
        }
        for (const child of currentVaultEntry.children) {
          await traverse(child);
        }
      }
    }

    await traverse(rootEntry);
    if (abortSignal.aborted) {
      throw new Error("Operation aborted");
    }

    matchedFiles.sort((a, b) => b.stat.mtime - a.stat.mtime); // Newest first

    const totalMatchesBeforeLimit = matchedFiles.length;
    const limitedFiles = matchedFiles.slice(0, config.RESULT_LIMIT);
    const truncated = totalMatchesBeforeLimit > config.RESULT_LIMIT;

    const resultFilePaths = limitedFiles.map((f) => `/${f.path}`); // Return absolute vault paths

    return {
      filenames: resultFilePaths,
      numFiles: resultFilePaths.length,
      totalMatchesBeforeLimit,
      truncated,
    };
  } catch (e: any) {
    debug(`Error during glob execution for pattern '${params.pattern}':`, e);
    return {
      error: "Tool execution failed",
      message: e.message || String(e),
      humanMessage: "Search failed",
    };
  }
}

export const globTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema: globInputSchema,
  execute,
  generateDataPart: (toolPart: GlobToolUIPart) => {
    const { state, input } = toolPart;

    // Helper function to format context with pattern and optional path
    const formatContext = (
      pattern: string,
      path?: string,
      hasError = false,
    ) => {
      const quotedPattern = `${pattern}`;
      const pathInfo = path && path !== "/" ? ` in ${normalizePath(path)}` : "";
      const errorSuffix = hasError ? " (error)" : "";
      return `${quotedPattern}${pathInfo}${errorSuffix}`;
    };

    // Show pattern (and path) during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      return {
        title: "Glob",
        context: input?.pattern
          ? formatContext(input.pattern, input.path)
          : undefined,
        contextStyle: "mono",
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;

      // Handle recoverable error output
      if (output && "error" in output) {
        return {
          title: "Glob",
          context: output.humanMessage || output.message || output.error || "Search failed",
          contextStyle: "mono",
          error: true,
        };
      }

      // Handle success output
      if (output && "filenames" in output) {
        const { numFiles, totalMatchesBeforeLimit, truncated } = output;

        let filesText = `${numFiles} files`;
        if (truncated && totalMatchesBeforeLimit > numFiles) {
          filesText = `${numFiles}/${totalMatchesBeforeLimit}+ files`;
        }

        return {
          title: "Glob",
          context: input?.pattern
            ? formatContext(input.pattern, input.path)
            : undefined,
          contextStyle: "mono",
          lines: filesText,
        };
      }
    }

    if (state === "output-error") {
      // Show actual error message instead of generic "(error)"
      const errorText = toolPart.errorText || "Unknown error";
      
      return {
        title: "Glob",
        context: input?.pattern
          ? formatContext(input.pattern, input.path, false)
          : undefined,
        contextStyle: "mono",
        lines: errorText,
      };
    }

    return null;
  },
};
