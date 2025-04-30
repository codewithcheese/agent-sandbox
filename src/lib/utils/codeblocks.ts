export function extractCodeBlockContent(
  blockText: string,
  blockIndex: number,
  filePath: string,
): string {
  const lines = blockText.split("\n");

  // Validate first line starts with ```
  if (!lines[0].startsWith("```")) {
    throw new Error(
      `Invalid code block format in ${filePath}: code block #${blockIndex + 1} is missing opening backticks`,
    );
  }

  // Validate last line is just ```
  if (!lines[lines.length - 1].startsWith("```")) {
    throw new Error(
      `Invalid code block format in ${filePath}: code block #${blockIndex + 1} is missing closing backticks`,
    );
  }

  // Return everything except first and last lines
  return lines.slice(1, lines.length - 1).join("\n");
}
