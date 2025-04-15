import type { TFile } from "obsidian";
import * as diff from "diff";

export type ToolRequest =
  | CreateRequest
  | ModifyRequest
  | DeleteRequest
  | TrashRequest;

// todo will not implement yet
export type CreateRequest = {
  toolCallId: string;
  type: "create";
  path: string;
  content: string;
};

export type ModifyRequest = {
  toolCallId: string;
  type: "modify";
  file: TFile;
  patch: string;
};

export type DeleteRequest = {
  toolCallId: string;
  type: "delete";
  path: string;
};

export type TrashRequest = {
  toolCallId: string;
  type: "trash";
  path: string;
};

function getPatchStats(patchString: string) {
  const stats = {
    added: 0,
    removed: 0,
  };

  // parsePatch returns an array of patch objects
  const parsedPatches = diff.parsePatch(patchString);

  for (const patchInfo of parsedPatches) {
    for (const hunk of patchInfo.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+")) {
          stats.added++;
        } else if (line.startsWith("-")) {
          stats.removed++;
        }
        // Ignore context lines (starting with ' ')
        // Ignore '\ No newline at end of file' lines
      }
    }
  }

  return stats;
}
