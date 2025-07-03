import type { Vault } from "obsidian";
import { usePlugin } from "$lib/utils/index.ts";

/**
 * Detects if the cursor is positioned after typing "[[" to trigger backlink lookup
 */
export function detectBacklinkTrigger(
  text: string,
  cursorPos: number,
): boolean {
  return cursorPos >= 2 && text.slice(cursorPos - 2, cursorPos) === "[[";
}

/**
 * Checks if a file basename is unique in the vault
 */
export function isFileNameUnique(fileName: string, vault: Vault): boolean {
  const filesWithSameName = vault
    .getFiles()
    .filter((file) => file.basename === fileName);
  return filesWithSameName.length === 1;
}

/**
 * Inserts a backlink at the specified cursor position and returns the new text and cursor position
 */
export function insertBacklink(
  text: string,
  cursorPos: number,
  fileName: string,
): { newText: string; newCursorPos: number } {
  const before = text.slice(0, cursorPos - 2); // Remove the "[["
  const after = text.slice(cursorPos);

  // fileName is already processed by the modal to be either basename or full path
  const backlink = `[[${fileName}]]`;

  const newText = `${before}${backlink}${after}`;
  const newCursorPos = before.length + backlink.length;

  return { newText, newCursorPos };
}

/**
 * Transforms backlinks for submission by adding pipe operator with full paths
 * Converts [[filename]] to [[full/path/to/file|filename]] for model context
 */
export function expandBacklinks(text: string): string {
  const plugin = usePlugin();
  return text.replace(/\[\[([^\]]+)\]\]/g, (match, linkText) => {
    // Skip if already has pipe operator
    if (linkText.includes("|")) return match;

    // Try to find file by exact path first, then by basename
    let file = plugin.app.metadataCache.getFirstLinkpathDest(linkText, "/");

    // Transform only if file exists and link text is not already the full path
    if (file && file.path !== linkText) {
      return `[[${file.path}|${linkText}]]`;
    }

    return match; // Keep original if no transformation needed
  });
}
