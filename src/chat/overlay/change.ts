export enum ChangeKind {
  CREATE = "create",
  MODIFY = "modify",
  DELETE = "delete",
  RENAME = "rename",
}

interface BaseChange {
  id: string;
  timestamp: number;
  description: string;
  messageId: string; // A change can originate from one or more messages
}

export interface CreateChange extends BaseChange {
  kind: ChangeKind.CREATE;
  path: string;
  before?: undefined;
  after: string;
}

export interface ModifyChange extends BaseChange {
  kind: ChangeKind.MODIFY;
  path: string;
  before: string;
  after: string;
}

export interface DeleteChange extends BaseChange {
  kind: ChangeKind.DELETE;
  path: string;
  before: string;
  after?: undefined;
}

export interface RenameChange extends BaseChange {
  kind: ChangeKind.RENAME;
  oldPath: string;
  path: string; // new path
  // Rename itself doesn't carry content snapshots for 'before'/'after' of the file content
  before?: undefined;
  after?: undefined;
}

export type TrackedChange =
  | CreateChange
  | ModifyChange
  | DeleteChange
  | RenameChange;

export type CompositeChange = {
  id: string;
  timestamp: number;
  description: string;

  path: string; // The current, final path of the file
  kind: ChangeKind.CREATE | ChangeKind.MODIFY | ChangeKind.DELETE; // The effective *content* operation
  before?: string; // The initial state of the content (from first relevant op)
  after?: string; // The final state of the content (undefined if deleted)
  renamedFrom?: string; // If the current path is due to a rename, this is the path before the last rename
};
