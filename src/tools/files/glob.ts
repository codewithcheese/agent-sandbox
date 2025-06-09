import { z } from "zod";
import { tool } from "ai";
import {
  normalizePath,
  TFile,
  TFolder,
  type TAbstractFile,
  type Vault,
} from "obsidian";
import { relative, sep } from "path-browserify"; // Using browserify version
import { minimatch } from "minimatch"; // Import minimatch
import { createDebug } from "$lib/debug";
import type {
  ToolDefinition,
  ToolExecutionOptionsWithContext,
} from "../types.ts";
import { invariant } from "@epic-web/invariant";

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
 * - Minimatch library provides fast pattern matching
 * - Results are limited and sorted to maintain responsiveness
 * - Validation occurs before expensive operations
 */

const debug = createDebug();

export const defaultConfig = {
  RESULT_LIMIT: 100, // Max number of files to return
  DEFAULT_IGNORE_PATTERNS: [
    // Patterns to always ignore, relative to the search root
    "**/.obsidian/**", // Obsidian config folder
    "**/.trash/**", // Obsidian trash folder
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

type GlobToolOutput =
  | {
      filenames: string[];
      numFiles: number;
      totalMatchesBeforeLimit: number;
      truncated: boolean;
    }
  | {
      error: string;
      message?: string;
      meta?: any;
    };

async function validateInput(
  params: z.infer<typeof globInputSchema>,
  vault: Vault,
  config: typeof defaultConfig,
): Promise<{ result: boolean; message?: string; meta?: any }> {
  const rootPath = normalizePath(params.path || "/");
  const rootEntry = vault.getAbstractFileByPath(rootPath);

  if (!rootEntry) {
    return {
      result: false,
      message: `Specified search path does not exist: ${rootPath}`,
    };
  }
  if (!(rootEntry instanceof TFolder)) {
    return {
      result: false,
      message: `Specified search path is not a directory: ${rootPath}`,
    };
  }

  return {
    result: true,
  };
}

export async function execute(
  params: z.infer<typeof globInputSchema>,
  toolExecOptions: ToolExecutionOptionsWithContext,
): Promise<GlobToolOutput> {
  const { abortSignal } = toolExecOptions;
  const { vault, config: contextConfig } = toolExecOptions.getContext();

  const config = { ...defaultConfig, ...contextConfig };

  invariant(vault, "Vault not available in execution context.");

  const validation = await validateInput(params, vault, config);
  if (!validation.result) {
    return {
      error: "Input Validation Failed",
      message: validation.message,
      meta: validation.meta,
    };
  }

  try {
    const rootPath = normalizePath(params.path || "/");
    const rootEntry = vault.getFolderByPath(rootPath);

    const matchedFiles: TFile[] = [];
    // For minimatch, paths should be relative to the CWD it's operating on.
    // We'll make paths relative to `rootPath` for matching.
    const minimatchOptions = { dot: true, matchBase: false }; // dot:true allows matching hidden files if pattern intends

    const effectiveIgnorePatterns = [
      ...config.DEFAULT_IGNORE_PATTERNS,
      ...(params.ignore || []),
    ];

    function isPathIgnored(pathRelativeToSearchRoot: string): boolean {
      for (const ignorePattern of effectiveIgnorePatterns) {
        if (
          minimatch(pathRelativeToSearchRoot, ignorePattern, minimatchOptions)
        ) {
          return true;
        }
      }
      return false;
    }

    async function traverse(currentVaultEntry: TAbstractFile) {
      if (abortSignal.aborted) throw new Error("Operation aborted by user.");

      // Get path relative to the initial search root for matching
      // Note: Obsidian paths are already relative to vault root if not starting with '/'
      // If rootPath is '/', currentVaultEntry.path is fine.
      // Otherwise, we need `relative(rootPath, currentVaultEntry.path)`
      const pathRelativeToSearchRoot =
        rootPath === "/" || rootPath === ""
          ? currentVaultEntry.path
          : relative(rootPath, currentVaultEntry.path);

      if (currentVaultEntry instanceof TFile) {
        if (
          !isPathIgnored(pathRelativeToSearchRoot) &&
          minimatch(pathRelativeToSearchRoot, params.pattern, minimatchOptions)
        ) {
          matchedFiles.push(currentVaultEntry);
        }
      } else if (currentVaultEntry instanceof TFolder) {
        // Check if the folder itself (path ending with /) or its path representation should be ignored
        if (
          isPathIgnored(
            pathRelativeToSearchRoot + (pathRelativeToSearchRoot ? sep : ""),
          ) ||
          isPathIgnored(pathRelativeToSearchRoot)
        ) {
          return; // Don't traverse ignored directories
        }
        for (const child of currentVaultEntry.children) {
          await traverse(child);
        }
      }
    }

    await traverse(rootEntry);
    if (abortSignal.aborted)
      return {
        error: "Operation aborted",
        message: "Glob operation aborted by user.",
      };

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
};
