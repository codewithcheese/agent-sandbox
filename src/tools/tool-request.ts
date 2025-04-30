import * as diff from "diff";

export type ToolRequest =
  | CreateToolRequest
  | ModifyToolRequest
  | DeleteToolRequest
  | TrashToolRequest
  | ReadToolRequest;

interface BaseRequest {
  id: string;
  toolCallId: string;
  path: string;
  status: "pending" | "success" | "failure";
}

// todo will not implement yet
export interface CreateToolRequest extends BaseRequest {
  id: string;
  toolCallId: string;
  type: "create";
  path: string;
  content: string;
}

export interface ModifyToolRequest extends BaseRequest {
  id: string;
  toolCallId: string;
  type: "modify";
  path: string;
  patch: string;
  stats: {
    added: number;
    removed: number;
  };
}

export interface DeleteToolRequest extends BaseRequest {
  id: string;
  toolCallId: string;
  type: "delete";
  path: string;
}

export interface TrashToolRequest extends BaseRequest {
  id: string;
  toolCallId: string;
  type: "trash";
  path: string;
}

export interface ReadToolRequest extends BaseRequest {
  id: string;
  toolCallId: string;
  type: "read";
  path: string;
}

export function getPatchStats(patch: string) {
  const stats = {
    added: 0,
    removed: 0,
  };
  const parsedPatches = diff.parsePatch(patch);
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
