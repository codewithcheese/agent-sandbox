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
  path: string;
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

export function getRequestStats(requests: ToolRequest[]) {
  const stats = {
    added: 0,
    removed: 0,
  };

  for (const request of requests) {
    if ("patch" in request) {
      const parsedPatches = diff.parsePatch(request.patch);
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
    }
  }

  return stats;
}
