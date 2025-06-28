/**
 * Detects if the cursor is positioned after typing "/" to trigger prompt insertion
 */
export function detectSlashTrigger(
  text: string,
  cursorPos: number,
): boolean {
  // Check if we're at the start of the text or after whitespace/newline
  const beforeChar = cursorPos > 0 ? text[cursorPos - 2] : '';
  const slashChar = cursorPos > 0 ? text[cursorPos - 1] : '';
  
  return slashChar === "/" && (cursorPos === 1 || beforeChar === ' ' || beforeChar === '\n' || beforeChar === '\t');
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
