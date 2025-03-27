import { PyodideExecutor } from "$lib/pyodide/executor";
import { usePlugin } from "$lib/utils";

export * from "./reddit.ts";

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
    const { fileTree } = await import("$lib/utils/file-tree.ts");
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