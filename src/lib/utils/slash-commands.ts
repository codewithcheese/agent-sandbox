import { BRACKET_LINK_REGEX } from "$lib/markdown/remark.ts";

/**
 * Detects if the cursor is positioned after typing "/" as the first character to trigger prompt insertion
 */
export function detectSlashTrigger(text: string, cursorPos: number): boolean {
  // Only trigger if "/" is the very first character
  return cursorPos === 1 && text[0] === "/";
}

/**
 * Removes the slash trigger from the text at the specified cursor position
 */
export function removeSlashTrigger(
  text: string,
  cursorPos: number,
): { newText: string; newCursorPos: number } {
  const before = text.slice(0, cursorPos - 1); // Remove the "/"
  const after = text.slice(cursorPos);

  const newText = `${before}${after}`;
  const newCursorPos = before.length;

  return { newText, newCursorPos };
}

/**
 * Parses a complete slash command of the format /[[prompt-name]] arguments
 * Uses the same wikilink regex from markdown processing for consistency
 */
export function parseSlashCommand(
  text: string,
): { promptName: string; arguments: string } | null {
  // Match pattern: /[[prompt-name]] optional arguments
  if (!text.startsWith("/")) return null;

  const textAfterSlash = text.slice(1); // Remove the leading "/"

  // Use the existing wikilink regex to parse the [[prompt-name]] part
  BRACKET_LINK_REGEX.lastIndex = 0;
  const wikilinkMatch = BRACKET_LINK_REGEX.exec(textAfterSlash);
  if (!wikilinkMatch || wikilinkMatch.index !== 0) return null;

  const promptName = wikilinkMatch[1].trim();
  const fullMatch = wikilinkMatch[0];
  const args = textAfterSlash.slice(fullMatch.length).trim();

  return { promptName, arguments: args };
}
