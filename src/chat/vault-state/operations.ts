/**
 * Standalone operation execution functions.
 *
 * These functions apply operations to the tree without any coupling to TreeNode instances.
 * They are used by both:
 * 1. TreeNode methods (for user mutations): validate → execute → record
 * 2. VaultState.rebuildTreeFromLog() (for replay): just execute
 *
 * This design allows:
 * - Pure functions (no hidden state)
 * - Easy testing (no node coupling)
 * - Code reuse (same functions for mutations and replay)
 */

import type { VaultState } from './vault-state';
import type {
  Operation,
  CreateOperation,
  DeleteOperation,
  ModifyOperation,
  MoveOperation,
  RenameOperation
} from './types';
import { TreeNode } from './tree-node';

/**
 * Execute a CREATE operation on the tree.
 * Creates a new node with the given data and adds it to the parent.
 */
export function executeCreate(state: VaultState, op: CreateOperation): void {
  const parent = state.getNode(op.parentId);
  if (!parent) {
    throw new Error(`Parent node not found during CREATE: ${op.parentId}`);
  }

  const newNode = new TreeNode(op.nodeId, state);
  newNode.parentId = op.parentId;
  newNode.data = { ...op.data };

  parent.childIds.push(op.nodeId);
  state.addNode(newNode);
}

/**
 * Execute a DELETE operation on the tree.
 * Removes node from parent and recursively deletes all descendants.
 */
export function executeDelete(state: VaultState, op: DeleteOperation): void {
  const node = state.getNode(op.nodeId);
  if (!node) {
    throw new Error(`Node not found during DELETE: ${op.nodeId}`);
  }

  // Remove from parent
  if (node.parentId) {
    const parent = state.getNode(node.parentId);
    if (parent) {
      parent.childIds = parent.childIds.filter(id => id !== op.nodeId);
    }
  }

  // Recursively delete children
  deleteNodeAndChildren(state, op.nodeId);
}

/**
 * Execute a MODIFY operation on the tree.
 * Updates fields on a node.
 */
export function executeModify(state: VaultState, op: ModifyOperation): void {
  const node = state.getNode(op.nodeId);
  if (!node) {
    throw new Error(`Node not found during MODIFY: ${op.nodeId}`);
  }

  Object.entries(op.changes).forEach(([field, value]) => {
    node.data[field] = value;
  });
}

/**
 * Execute a MOVE operation on the tree.
 * Changes the parent of a node.
 */
export function executeMove(state: VaultState, op: MoveOperation): void {
  const node = state.getNode(op.nodeId);
  const newParent = state.getNode(op.newParentId);

  if (!node) {
    throw new Error(`Node not found during MOVE: ${op.nodeId}`);
  }
  if (!newParent) {
    throw new Error(`Parent node not found during MOVE: ${op.newParentId}`);
  }

  // Remove from old parent
  if (node.parentId) {
    const oldParent = state.getNode(node.parentId);
    if (oldParent) {
      oldParent.childIds = oldParent.childIds.filter(id => id !== op.nodeId);
    }
  }

  // Add to new parent
  newParent.childIds.push(op.nodeId);
  node.parentId = op.newParentId;
}

/**
 * Execute a RENAME operation on the tree.
 * Changes the name (path segment) of a node.
 */
export function executeRename(state: VaultState, op: RenameOperation): void {
  const node = state.getNode(op.nodeId);
  if (!node) {
    throw new Error(`Node not found during RENAME: ${op.nodeId}`);
  }

  node.data.name = op.newName;
}

/**
 * Dispatcher function that executes any operation.
 * Routes to the appropriate execute* function based on operation type.
 */
export function executeOperation(state: VaultState, op: Operation): void {
  switch (op.type) {
    case 'create':
      executeCreate(state, op);
      break;
    case 'delete':
      executeDelete(state, op);
      break;
    case 'modify':
      executeModify(state, op);
      break;
    case 'move':
      executeMove(state, op);
      break;
    case 'rename':
      executeRename(state, op);
      break;
  }
}

/**
 * Recursively delete a node and all its descendants from the state.
 * Used by executeDelete and doesn't record operations.
 *
 * @param state The VaultState
 * @param nodeId The NodeID to delete
 */
function deleteNodeAndChildren(state: VaultState, nodeId: string): void {
  const node = state.getNode(nodeId);
  if (!node) return;

  // Recursively delete children
  for (const childId of [...node.childIds]) {
    deleteNodeAndChildren(state, childId);
  }

  // Delete the node itself
  state.removeNode(nodeId);
}
