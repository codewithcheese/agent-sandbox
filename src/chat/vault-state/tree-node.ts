/**
 * TreeNode represents a single node in the vault tree (file or directory).
 *
 * Mutations on TreeNode automatically record operations to VaultState,
 * making it impossible to accidentally skip operation recording.
 */

import type { NodeID, NodeData, FileStats } from './types';
import type { VaultState } from './vault-state';

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
    this.vaultState.modifyNode(this.id, changes);
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
   */
  move(newParentNode: TreeNode): void {
    // Delegate to VaultState which handles circular reference checking
    this.vaultState.moveNode(this.id, newParentNode.id);
  }

  /**
   * Rename this node (change the path segment, not the parent).
   * Only changes the name, not the parent. See move() for moving to different directory.
   *
   * Example:
   *   node.rename('new-filename.md');
   *
   * @param newName New basename for this node
   */
  rename(newName: string): void {
    if (this.id === 'root') {
      throw new Error('Cannot rename root node');
    }
    this.vaultState.renameNode(this.id, newName);
  }

  /**
   * Delete this node and all its descendants.
   * Recorded as a single atomic DELETE operation capturing the entire subtree.
   *
   * Example:
   *   node.delete();  // Deletes node and all children
   */
  delete(): void {
    if (this.id === 'root') {
      throw new Error('Cannot delete root node');
    }
    this.vaultState.deleteNode(this.id);
  }
}
