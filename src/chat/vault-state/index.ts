/**
 * VaultState: Operations log-based vault tree system.
 *
 * This module provides an alternative to Loro CRDT for managing the vault tree.
 * It uses an append-only operations log where all mutations are recorded,
 * enabling efficient rollback and human-readable debugging.
 *
 * Main exports:
 * - VaultState: Core tree + operations log manager
 * - TreeNode: Node in the vault tree (file or directory)
 * - Operation types: CreateOperation, DeleteOperation, ModifyOperation, etc.
 * - Utility types: NodeID, NodeData, FileStats, SerializedState
 */

// Type definitions
export type {
  NodeID,
  FileStats,
  NodeData,
  Operation,
  CreateOperation,
  DeleteOperation,
  ModifyOperation,
  MoveOperation,
  RenameOperation,
  SerializedOperation,
  SerializedState
} from './types';

// Classes
export { TreeNode } from './tree-node';
export { VaultState } from './vault-state';

// Operation execution functions
export {
  executeCreate,
  executeDelete,
  executeModify,
  executeMove,
  executeRename,
  executeOperation
} from './operations';
