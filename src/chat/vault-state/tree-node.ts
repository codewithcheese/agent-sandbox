/**
 * TreeNode represents a single node in the vault tree (file or directory).
 *
 * Primary API for mutations. Each method:
 * 1. Validates preconditions
 * 2. Calls standalone execute function to apply changes
 * 3. Records the operation to VaultState
 *
 * This ensures all mutations go through the operation log.
 */

import type { NodeID, NodeData, FileStats } from './types';
import type { VaultState } from './vault-state';
import { executeModify, executeMove, executeDelete, executeRename } from './operations';

export class TreeNode {
  id: NodeID;
  parentId: NodeID | null = null;
  childIds: NodeID[] = [];
  data: NodeData = {
    name: '',
    isDirectory: false
  };

  constructor(id: NodeID, private vaultState: VaultState) {
    this.id = id;
  }

  /**
   * Modify multiple fields on this node atomically.
   * All changes are applied and recorded as a single MODIFY operation.
   *
   * Example:
   *   node.modify({ text: 'new content', mtime: Date.now() });
   *
   * @param changes Object with fields to modify
   */
  modify(changes: Partial<NodeData>): void {
    // Execute the operation
    executeModify(this.vaultState, {
      type: 'modify',
      nodeId: this.id,
      changes
    });

    // Record the operation
    this.vaultState.recordOperation({
      type: 'modify',
      nodeId: this.id,
      changes
    });
  }

  /**
   * Move this node to a different parent directory.
   * Only changes the parent, not the name. See rename() for renaming.
   *
   * Example:
   *   const newParent = vaultState.findByPath('folder');
   *   node.move(newParent);
   *
   * @param newParentNode The new parent node
   * @throws Error if move would create circular reference
   */
  move(newParentNode: TreeNode): void {
    // Validate: prevent circular references
    let current: TreeNode | null = newParentNode;
    while (current) {
      if (current.id === this.id) {
        throw new Error(`Cannot move node under its own descendant (circular reference)`);
      }
      current = current.parentId ? this.vaultState.getNode(current.parentId) : null;
    }

    // Execute the operation
    executeMove(this.vaultState, {
      type: 'move',
      nodeId: this.id,
      newParentId: newParentNode.id
    });

    // Record the operation
    this.vaultState.recordOperation({
      type: 'move',
      nodeId: this.id,
      newParentId: newParentNode.id
    });
  }

  /**
   * Rename this node (change the path segment, not the parent).
   * Only changes the name, not the parent. See move() for moving to different directory.
   *
   * Example:
   *   node.rename('new-filename.md');
   *
   * @param newName New basename for this node
   * @throws Error if trying to rename root node
   */
  rename(newName: string): void {
    if (this.id === 'root') {
      throw new Error('Cannot rename root node');
    }

    // Execute the operation
    executeRename(this.vaultState, {
      type: 'rename',
      nodeId: this.id,
      newName
    });

    // Record the operation
    this.vaultState.recordOperation({
      type: 'rename',
      nodeId: this.id,
      newName
    });
  }

  /**
   * Delete this node and all its descendants.
   * Recorded as a single atomic DELETE operation capturing the entire subtree.
   *
   * Example:
   *   node.delete();  // Deletes node and all children
   *
   * @throws Error if trying to delete root node
   */
  delete(): void {
    if (this.id === 'root') {
      throw new Error('Cannot delete root node');
    }

    // Execute the operation
    executeDelete(this.vaultState, {
      type: 'delete',
      nodeId: this.id
    });

    // Record the operation
    this.vaultState.recordOperation({
      type: 'delete',
      nodeId: this.id
    });
  }
}
