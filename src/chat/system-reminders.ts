/**
 * Generate a system reminder about files that were externally modified and synced
 */
export function syncChangesReminder(
  syncResult: { path: string; diff: string }[],
): string {
  if (syncResult.length === 0) {
    return "";
  }

  const sections: string[] = [];

  // Add system reminder header
  sections.push("<system-reminder>");
  sections.push("The following files were modified:");
  sections.push("");

  // Process each diff
  for (const { diff } of syncResult) {
    sections.push(diff);
    sections.push("");
  }

  sections.push(
    "Please consider these changes when making tool calls to avoid redundant operations.",
  );
  sections.push("</system-reminder>");

  return sections.join("\n");
}
