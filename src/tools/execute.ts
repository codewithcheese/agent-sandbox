import { PyodideExecutor } from "$lib/pyodide/executor";
import { usePlugin } from "$lib/utils";
import { fileTree } from "$lib/utils/file-tree.ts";
import type { Artifact } from "$lib/artifacts/artifact-vew.svelte.ts";

// Keep track of file edits for undo functionality
const fileEditHistory = new Map<string, string[]>();

export * from "./reddit.ts";

/**
 * Opens AI-generated HTML content in the ArtifactView
 */
export async function writeArtifact(artifact: Artifact) {
  try {
    console.log("Writing artifact:", artifact);
    const plugin = usePlugin();
    await plugin.openArtifactView(artifact);

    return {
      success: true,
      message: "Successfully opened content in ArtifactView",
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to open content in ArtifactView: ${error.message}`,
    };
  }
}

/**
 * Read a file from the Obsidian vault
 */
export async function readFile({ path }) {
  try {
    const plugin = usePlugin();
    // Remove leading slash if present as Obsidian doesn't support root path syntax
    const normalizedPath = path.startsWith("/") ? path.substring(1) : path;
    const file = plugin.app.vault.getFileByPath(normalizedPath);
    if (!file) {
      return { error: `File not found: ${path}` };
    }
    const content = await plugin.app.vault.read(file);
    return { content };
  } catch (error) {
    return { error: `Failed to read file: ${error.message}` };
  }
}

/**
 * List files in a directory in the Obsidian vault
 */
export async function listFiles({ path }) {
  try {
    // Coerce '.' into '/' since there's no concept of working directory in Obsidian
    const normalizedPath = path === "." ? "/" : path;
    const result = await fileTree(normalizedPath);
    return { result };
  } catch (error) {
    return { error: `Failed to list files: ${error.message}` };
  }
}

/**
 * Execute Python code using Pyodide
 */
export async function executePython({ code, installPackages = [] }) {
  try {
    const pyodide = new PyodideExecutor();
    await pyodide.load();

    // Install any requested packages
    if (installPackages.length > 0) {
      for (const pkg of installPackages) {
        await pyodide.installPackage(pkg);
      }
    }

    // Execute the Python code
    const result = await pyodide.execute(code);

    return {
      success: result.success,
      result: result.result,
      stdout: result.stdout,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      result: null,
      stdout: "",
      error: error?.message || String(error),
    };
  }
}

/**
 * Think tool for structured reasoning
 */
export function think({ thought }) {
  // This is a no-op tool - it simply returns the thought that was passed in
  // The value comes from giving the AI space to think in a structured way
  return thought;
}

/**
 * Text Editor tool for viewing and editing files in the Obsidian vault
 * Compatible with Anthropic's text editor tool
 */
export async function textEditor({
  command,
  path,
  file_text,
  insert_line,
  new_str,
  old_str,
  view_range,
}) {
  try {
    const plugin = usePlugin();
    // Remove leading slash if present as Obsidian doesn't support root path syntax
    const normalizedPath = path.startsWith("/") ? path.substring(1) : path;

    switch (command) {
      case "view": {
        // View a file or directory
        const abstractFile =
          plugin.app.vault.getAbstractFileByPath(normalizedPath);

        if (!abstractFile) {
          return { error: `File or directory not found: ${path}` };
        }

        // If it's a directory, list its contents
        if (abstractFile.children) {
          const { fileTree } = await import("$lib/utils/file-tree.ts");
          const result = await fileTree(normalizedPath);
          return { content: result };
        }

        // It's a file, read its contents
        const file = plugin.app.vault.getFileByPath(normalizedPath);
        if (!file) {
          return { error: `File not found: ${path}` };
        }

        const content = await plugin.app.vault.read(file);

        // If view_range is specified, return only the specified lines
        if (
          view_range &&
          Array.isArray(view_range) &&
          view_range.length === 2
        ) {
          const lines = content.split("\n");
          const [startLine, endLine] = view_range;

          // Adjust for 1-indexed line numbers
          const start = Math.max(0, startLine - 1);
          const end = endLine === -1 ? lines.length : endLine;

          // Add line numbers to each line
          const numberedLines = lines
            .slice(start, end)
            .map((line, i) => `${start + i + 1}: ${line}`)
            .join("\n");
          return { content: numberedLines };
        }

        // Add line numbers to each line
        const numberedLines = content
          .split("\n")
          .map((line, i) => `${i + 1}: ${line}`)
          .join("\n");
        return { content: numberedLines };
      }

      case "create": {
        // Create a new file
        if (!file_text) {
          return { error: "file_text is required for create command" };
        }

        // Check if file already exists
        const existingFile =
          plugin.app.vault.getAbstractFileByPath(normalizedPath);
        if (existingFile) {
          return { error: `File already exists: ${path}` };
        }

        // Create parent directories if they don't exist
        const dirPath = normalizedPath.substring(
          0,
          normalizedPath.lastIndexOf("/"),
        );
        if (dirPath && !plugin.app.vault.getAbstractFileByPath(dirPath)) {
          await plugin.app.vault.createFolder(dirPath);
        }

        // Create the file
        await plugin.app.vault.create(normalizedPath, file_text);
        return { content: `Successfully created file: ${path}` };
      }

      case "str_replace": {
        // Replace text in a file
        if (!old_str) {
          return { error: "old_str is required for str_replace command" };
        }

        if (!new_str) {
          return { error: "new_str is required for str_replace command" };
        }

        const file = plugin.app.vault.getFileByPath(normalizedPath);
        if (!file) {
          return { error: `File not found: ${path}` };
        }

        const content = await plugin.app.vault.read(file);

        // Check if old_str exists in the file
        if (!content.includes(old_str)) {
          return { error: `Text to replace not found in file: ${path}` };
        }

        // Count occurrences of old_str
        const occurrences = (
          content.match(
            new RegExp(old_str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          ) || []
        ).length;

        if (occurrences > 1) {
          return {
            error: `Multiple occurrences (${occurrences}) of text to replace found in file: ${path}`,
          };
        }

        return {
          content: "Successfully replaced text at exactly one location.",
        };
      }

      case "insert": {
        // Insert text at a specific line
        if (insert_line === undefined) {
          return { error: "insert_line is required for insert command" };
        }

        if (!new_str) {
          return { error: "new_str is required for insert command" };
        }

        const file = plugin.app.vault.getFileByPath(normalizedPath);
        if (!file) {
          return { error: `File not found: ${path}` };
        }

        const content = await plugin.app.vault.read(file);
        const lines = content.split("\n");

        // Validate insert_line
        if (insert_line < 0 || insert_line > lines.length) {
          return {
            error: `Invalid insert_line: ${insert_line}. File has ${lines.length} lines.`,
          };
        }

        // Instead of applying the change, return a confirmation
        return {
          content: `Proposed to insert text at line ${insert_line} in ${path}. Changes require review.`,
          status: "pending_review",
        };
      }

      case "undo_edit": {
        // Undo the last edit
        const file = plugin.app.vault.getFileByPath(normalizedPath);
        if (!file) {
          return { error: `File not found: ${path}` };
        }

        // Check if we have history for this file
        if (
          !fileEditHistory.has(normalizedPath) ||
          fileEditHistory.get(normalizedPath)?.length === 0
        ) {
          return { error: `No edit history found for file: ${path}` };
        }

        // Get the last saved content
        const previousContent = fileEditHistory.get(normalizedPath)?.pop();
        if (!previousContent) {
          return {
            error: `Failed to retrieve previous content for file: ${path}`,
          };
        }

        // Restore the previous content
        await plugin.app.vault.modify(file, previousContent);

        return { content: `Successfully undid last edit to file: ${path}` };
      }

      default:
        return { error: `Unknown command: ${command}` };
    }
  } catch (error) {
    return { error: `Failed to execute ${command}: ${error.message}` };
  }
}
