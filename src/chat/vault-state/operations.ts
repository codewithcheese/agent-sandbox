/**
 * Standalone operation execution functions.
 *
 * Each execute function:
 * 1. Applies the operation to the tree
 * 2. Records the operation in the log (respecting recordingEnabled flag)
 *
 * They are used by both:
 * 1. TreeNode methods (for user mutations): operation is recorded
 * 2. VaultState.rebuildTreeFromLog() (for replay): recording is disabled, so operation is not recorded twice
 *
 * This design allows:
 * - Single responsibility per operation type
 * - Automatic recording without wrapper methods
 * - Code reuse for mutations and replay
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
 * Creates a new node with the given data, adds it to the parent,
 * and records the operation in the log.
 *
 * The node ID comes from the operation (op.nodeId). This enables:
 * - Deterministic replay: operations contain the exact ID to use
 * - Cross-state merging: operations can be copied between states with preserved IDs
 *
 * @returns The newly created TreeNode
 */
export function executeCreate(state: VaultState, op: CreateOperation): TreeNode {
  const parent = state.getNode(op.parentId);
  if (!parent) {
    throw new Error(`Parent node not found during CREATE: ${op.parentId}`);
  }

  // Create node with explicit ID from operation
  const newNode = new TreeNode(state, op.nodeId);
  newNode.parentId = op.parentId;
  newNode.data = { ...op.data };

  parent.childIds.push(newNode.id);
  state.addNode(newNode);

  // Record operation (no-op if recordingEnabled is false)
  state.recordOperation(op);

  return newNode;
}

/**
 * Execute a DELETE operation on the tree.
 * Removes node from parent and recursively deletes all descendants.
 * Automatically records the operation in the log.
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

  // Record operation (no-op if recordingEnabled is false)
  state.recordOperation(op);
}

/**
 * Execute a MODIFY operation on the tree.
 * Updates fields on a node.
 * Automatically records the operation in the log.
 *
 * When text is being modified and `previousText` is not already set,
 * captures the current text value before applying changes. This enables
 * three-way merge during `mergeDocs()`.
 */
export function executeModify(state: VaultState, op: ModifyOperation): void {
  const node = state.getNode(op.nodeId);
  if (!node) {
    throw new Error(`Node not found during MODIFY: ${op.nodeId}`);
  }

  // Capture previousText if text is being changed and not already provided
  let opToRecord: ModifyOperation = op;
  if ('text' in op.changes && op.previousText === undefined) {
    const currentText = node.data.text;
    if (typeof currentText === 'string') {
      opToRecord = { ...op, previousText: currentText };
    }
  }

  Object.entries(op.changes).forEach(([field, value]) => {
    node.data[field] = value;
  });

  // Record operation with previousText (no-op if recordingEnabled is false)
  state.recordOperation(opToRecord);
}

/**
 * Execute a MOVE operation on the tree.
 * Changes the parent of a node.
 * Automatically records the operation in the log.
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

  // Record operation (no-op if recordingEnabled is false)
  state.recordOperation(op);
}

/**
 * Execute a RENAME operation on the tree.
 * Changes the name (path segment) of a node.
 * Automatically records the operation in the log.
 */
export function executeRename(state: VaultState, op: RenameOperation): void {
  const node = state.getNode(op.nodeId);
  if (!node) {
    throw new Error(`Node not found during RENAME: ${op.nodeId}`);
  }

  node.data.name = op.newName;

  // Record operation (no-op if recordingEnabled is false)
  state.recordOperation(op);
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
