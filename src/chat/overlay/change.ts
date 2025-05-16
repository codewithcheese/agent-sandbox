export enum ChangeKind {
  CREATE = "create",
  MODIFY = "modify",
  DELETE = "delete",
  RENAME = "rename",
}

interface BaseChange {
  path: string;
  kind: ChangeKind;
}

export interface CreateChange extends BaseChange {
  kind: ChangeKind.CREATE;
  before: undefined;
  after: string;
}

export interface ModifyChange extends BaseChange {
  kind: ChangeKind.MODIFY;
  before: string;
  after: string;
}

export interface DeleteChange extends BaseChange {
  kind: ChangeKind.DELETE;
  before: string;
}

export interface RenameChange extends BaseChange {
  kind: ChangeKind.RENAME;
  oldPath: string;
}

export type Change = CreateChange | ModifyChange | DeleteChange | RenameChange;

export type TrackedChange = Change & {
  id: string;
  turn: number;
  timestamp: number;
  description: string;
  messageId: string;
};
