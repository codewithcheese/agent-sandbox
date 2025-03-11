import { usePlugin } from "$lib/utils/index";
import type { TFile, TFolder } from "../../obsidian";

export async function fileTree(path: string = "/") {
  const plugin = usePlugin();
  const vault = plugin.app.vault;
  const files = vault.getFiles();

  // Group files by folder path
  const fileTree: { [key: string]: any[] } = {};
  files.forEach((file) => {
    const dir = file.parent?.path || "/";
    if (!fileTree[dir]) {
      fileTree[dir] = [];
    }
    fileTree[dir].push(file);
  });

  // Build markdown tree recursively
  const buildTree = (currentPath: string, depth: number = 0): string => {
    const indent = "  ".repeat(depth);
    let result = "";

    // Add folder name if not root
    if (currentPath !== "/") {
      result += `${indent}- 📁 ${currentPath}\n`;
      depth++;
    }

    // Add files in current folder
    const filesInDir = fileTree[currentPath] || [];
    for (const file of filesInDir) {
      result += `${indent}${depth > 0 ? "  " : ""}- 📄 ${file.name}\n`;
    }

    // Recursively process subfolders
    const subfolders = Object.keys(fileTree).filter((dir) => {
      if (currentPath === "/") {
        // For root, get only top-level folders
        return dir !== "/" && !dir.slice(1).includes("/");
      }
      // For other folders, get direct children
      return (
        dir.startsWith(currentPath) &&
        dir !== currentPath &&
        !dir.slice(currentPath.length + 1).includes("/")
      );
    });

    for (const subfolder of subfolders.sort()) {
      result += buildTree(subfolder, depth);
    }

    return result;
  };

  // If a specific path is provided, only show that part of the tree
  if (path !== "/") {
    const folder = vault.getAbstractFileByPath(path);
    if (!folder) {
      return `Folder not found: ${path}`;
    }

    if (folder.constructor.name === "TFolder") {
      return `${path} is a file, not a folder`;
    }

    return buildTree(path);
  }

  return buildTree("/");
}
