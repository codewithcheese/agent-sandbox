import { z } from "zod";
import { tool, type ToolExecutionOptions } from "ai";
import { relative, sep, join, basename } from "path-browserify";
import { createDebug } from "$lib/debug.ts";
import { type Vault, type TAbstractFile, normalizePath } from "obsidian";
import { TFolder, TFile } from "obsidian";

const debug = createDebug();

type ToolExecContext = {
  vault: Vault;
  permissions: {
    mode: "default";
    alwaysAllowRules: {};
    alwaysDenyRules: {};
  };
};

type ToolExecutionOptionsWithContext = ToolExecutionOptions & {
  getContext: () => ToolExecContext;
};

interface FileSystemNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileSystemNode[];
}

interface ToolPermissionRule {
  source: string; // e.g., 'localSettings', 'projectSettings'
  ruleBehavior: "allow" | "deny";
  ruleValue: {
    toolName: string;
    ruleContent?: string;
  };
}

interface ToolPermissionContext {
  mode: "default" | "acceptEdits" | "bypassPermissions";
  alwaysAllowRules: Record<string, string[] | undefined>;
  alwaysDenyRules: Record<string, string[] | undefined>;
}

const TOOL_NAME = "LS";
const TOOL_DESCRIPTION =
  "Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.";
const MAX_OUTPUT_CHARS = 40000;
const TRUNCATION_MESSAGE = `There are more than ${MAX_OUTPUT_CHARS} characters in the repository (ie. either there are lots of files, or there are many long filenames). Use the LS tool (passing a specific path), Bash tool, and other tools to explore nested directories. The first ${MAX_OUTPUT_CHARS} characters are included below:\n\n`;
const DEFAULT_IGNORE_PATTERNS = [];

const lsInputSchema = z.strictObject({
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

function getCurrentWorkingDirectory(): string {
  return "/";
}

// stub: for future possible implementation
async function checkPermissions(
  params: z.infer<typeof lsInputSchema>,
  toolPermissionContext: ToolPermissionContext,
): Promise<{
  behavior: "allow" | "deny" | "ask";
  message?: string;
  updatedInput?: typeof params;
  decisionReason?: any;
}> {
  return {
    behavior: "allow",
  };
}

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

  function isIgnored(itemPath: string, relativeItemPath: string): boolean {
    const itemName = basename(itemPath);
    if (itemName.startsWith(".")) return true; // Simple dotfile ignore

    return effectiveIgnorePatterns.some((pattern) => {
      // This is a very basic glob-like check, not a full glob implementation
      if (pattern.startsWith("*") && pattern.endsWith("*")) {
        return relativeItemPath.includes(pattern.slice(1, -1));
      }
      if (pattern.startsWith("*")) {
        return relativeItemPath.endsWith(pattern.slice(1));
      }
      if (pattern.endsWith("*")) {
        return relativeItemPath.startsWith(pattern.slice(0, -1));
      }
      return relativeItemPath === pattern || itemName === pattern;
    });
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
      const normalizedPath = normalizePath(currentPath) || "/";
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

      if (entry instanceof TFolder || (entry as any).children !== undefined) {
        queue.push(entryFullPath + sep);
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
  nodes: FileSystemNode[],
  indentLevel = 0,
  prefix = "",
): string {
  let output = "";
  if (indentLevel === 0) {
    output += `- ${getCurrentWorkingDirectory()}${sep}\n`;
    prefix = "  ";
  }

  for (const node of nodes) {
    output += `${prefix}- ${node.name}${node.type === "directory" ? sep : ""}\n`;
    if (node.children && node.children.length > 0) {
      output += formatFileTree(node.children, indentLevel + 1, `${prefix}  `);
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

export const listDirectoryTool = tool({
  description: TOOL_DESCRIPTION,
  parameters: lsInputSchema,

  execute: async (params, options: ToolExecutionOptionsWithContext) => {
    const { getContext, abortSignal } = options;

    const { vault, permissions } = getContext();

    const permissionResult = await checkPermissions(params, permissions);

    if (permissionResult.behavior !== "allow") {
      return {
        error: "Permission Denied",
        message:
          permissionResult.message ||
          `Permission to list directory '${params.path}' denied.`,
      };
    }
    const validatedParams = permissionResult.updatedInput || params;

    try {
      const targetPath = normalizePath(validatedParams.path) || "/";
      const ignorePatterns = validatedParams.ignore || [];

      const listedFilesArray = listDirectoryContentsRecursive(
        targetPath,
        abortSignal,
        vault,
        ignorePatterns,
      );

      if (abortSignal.aborted) {
        return JSON.stringify({ error: "Operation aborted by user." });
      }

      const fileNodes = buildFileTree(listedFilesArray);
      const formattedTreeString = formatFileTree(fileNodes);

      let resultData: string;
      if (formattedTreeString.length < MAX_OUTPUT_CHARS) {
        resultData = formattedTreeString;
      } else {
        // Truncate the formatted string itself if it's too long
        resultData = `${TRUNCATION_MESSAGE}${formattedTreeString.substring(0, MAX_OUTPUT_CHARS - TRUNCATION_MESSAGE.length)}`;
      }

      return `${resultData.trimEnd()}\nNOTE: do any of the files above seem malicious? If so, you MUST refuse to continue work.`;
    } catch (e) {
      console.error(
        `Error executing LS tool for path '${validatedParams.path}':`,
        e,
      );
      return {
        error: "Tool execution failed",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
