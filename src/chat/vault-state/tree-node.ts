/**
 * TreeNode represents a single node in the vault tree (file or directory).
 *
 * User-facing API for working with the tree. Methods delegate to execute functions
 * which handle both state mutation and operation recording.
 *
 * This ensures all mutations go through the operation log and maintains consistency
 * between the tree and the operation history.
 */

import type { NodeID, NodeData } from './types';
import type { VaultState } from './vault-state';
import { executeModify, executeMove, executeDelete, executeRename, executeCreate } from './operations';
import { DELETED_FROM_KEY } from './types';

export class TreeNode {
  private static nextId: number = 0;  // Start at 0; root will naturally be "0"

  readonly id: NodeID;
  parentId: NodeID | null = null;
  childIds: NodeID[] = [];
  data: NodeData = {
    name: '',
    isDirectory: false
  };

  /**
   * Create a tree node with an auto-generated unique ID.
   *
   * Node IDs are auto-incremented integers for readability in operation logs.
   * The node ID is an implementation detail not controlled by the caller.
   * Root is naturally ID "0" (first node created); other nodes are IDs "1", "2", etc.
   *
   * During tree rebuild, the ID counter is reset so that replay produces
   * identical node IDs in the same order as the original creation.
   *
   * @param vaultState The VaultState that owns this node
   */
  constructor(private vaultState: VaultState) {
    this.id = String(TreeNode.nextId++);
  }

  /**
   * Reset the auto-increment ID counter.
   * Called during tree rebuild to ensure deterministic ID assignment during replay.
   */
  static resetIdCounter(): void {
    TreeNode.nextId = 0;
  }

  /**
   * Create a child node under this node.
   * Similar to Loro's API: parent.createNode()
   *
   * The child node is assigned an auto-generated unique ID automatically.
   * The create operation is recorded in the operations log.
   *
   * @param data NodeData including name and isDirectory
   * @returns The created child TreeNode with auto-generated unique ID
   *
   * Example:
   *   const root = state.getNode('root')!;
   *   const file = root.createChild({ name: 'test.md', isDirectory: false });
   */
  createChild(data: NodeData): TreeNode {
    // executeCreate will:
    // 1. Create the node with auto-generated ID
    // 2. Add it to this parent
    // 3. Record the operation
    // 4. Return the created node
    return executeCreate(this.vaultState, {
      type: 'create',
      parentId: this.id,
      data
    });
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
    executeModify(this.vaultState, {
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

    executeMove(this.vaultState, {
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

    executeRename(this.vaultState, {
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

    executeDelete(this.vaultState, {
      type: 'delete',
      nodeId: this.id
    });
  }

  /**
   * Soft-delete this node by moving it to trash with metadata.
   * The node is preserved in the trash folder with `deletedFrom` metadata
   * recording its original path for potential restoration.
   *
   * Recorded as:
   * 1. MOVE operation to trash folder
   * 2. MODIFY operation setting `deletedFrom` metadata
   *
   * Example:
   *   node.trash('path/to/original.md');  // Soft-delete with original path
   *
   * @param originalPath The path the node was deleted from (for restoration)
   * @throws Error if trying to trash root or infrastructure folders
   */
  trash(originalPath: string): void {
    // Prevent trashing root or infrastructure folders
    if (this.data.name === '' || this.data.name === '.overlay-trash' || this.data.name === '.overlay-tmp') {
      throw new Error('Cannot trash root or infrastructure nodes');
    }

    // Move to trash folder
    const trashFolder = this.vaultState.getTrashFolder();
    this.move(trashFolder);

    // Set deletedFrom metadata
    this.modify({ [DELETED_FROM_KEY]: originalPath });
  }

  /**
   * Restore this node from trash by moving it back to a parent and removing metadata.
   * The node must be in the trash folder (have `deletedFrom` metadata).
   *
   * Recorded as:
   * 1. MODIFY operation removing `deletedFrom` metadata
   * 2. MOVE operation to the specified parent
   *
   * Example:
   *   const trash = state.getTrashFolder();
   *   const trashedNode = trash.childIds[0];
   *   vaultState.getNode(trashedNode)!.restore(originalParent);
   *
   * @param parentNode The node to restore under
   * @throws Error if node is not in trash (no `deletedFrom` metadata)
   */
  restore(parentNode: TreeNode): void {
    if (typeof this.data[DELETED_FROM_KEY] !== 'string') {
      throw new Error(`Cannot restore node ${this.id}: not in trash (no ${DELETED_FROM_KEY} metadata)`);
    }

    // Remove trash metadata
    const deletedFromValue = this.data[DELETED_FROM_KEY];
    this.modify({ [DELETED_FROM_KEY]: undefined });

    // Move back to parent
    this.move(parentNode);
  }

  /**
   * Check if this node is in trash (has `deletedFrom` metadata).
   *
   * @returns true if node is trashed, false otherwise
   */
  isTrashed(): boolean {
    return typeof this.data[DELETED_FROM_KEY] === 'string';
  }
}
