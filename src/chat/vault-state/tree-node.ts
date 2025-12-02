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
import { DELETED_FROM_KEY, TRASH_FOLDER, TMP_FOLDER } from './types';

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
   * Create a tree node with either an explicit ID or auto-generated ID.
   *
   * Node IDs are auto-incremented integers for readability in operation logs.
   * When replaying operations or merging between states, the explicit ID from
   * the operation is used to ensure consistent node identity.
   *
   * @param vaultState The VaultState that owns this node
   * @param explicitId Optional explicit ID (used during replay/merge)
   */
  constructor(private vaultState: VaultState, explicitId?: NodeID) {
    if (explicitId !== undefined) {
      this.id = explicitId;
      // Update counter to stay ahead of explicit IDs
      const numericId = parseInt(explicitId, 10);
      if (!isNaN(numericId) && numericId >= TreeNode.nextId) {
        TreeNode.nextId = numericId + 1;
      }
    } else {
      this.id = String(TreeNode.nextId++);
    }
  }

  /**
   * Generate the next auto-increment ID without creating a node.
   * Used by createChild to generate ID before calling executeCreate.
   */
  static generateNextId(): NodeID {
    return String(TreeNode.nextId++);
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
   * The ID is generated first, then recorded in the operation for replay/merge.
   *
   * @param data NodeData including name and isDirectory
   * @returns The created child TreeNode with auto-generated unique ID
   *
   * Example:
   *   const root = state.getNode('root')!;
   *   const file = root.createChild({ name: 'test.md', isDirectory: false });
   */
  createChild(data: NodeData): TreeNode {
    // Generate ID first, then include in operation for replay/merge support
    const nodeId = TreeNode.generateNextId();

    return executeCreate(this.vaultState, {
      type: 'create',
      nodeId,
      parentId: this.id,
      data
    });
  }

  /**
   * Create a child node with an explicit ID.
   * Used for ID reconciliation during sync when we need to create a node
   * in tracking with the same ID that already exists in proposed.
   *
   * @param data NodeData including name and isDirectory
   * @param nodeId Explicit ID to use for the new node
   * @returns The created child TreeNode with the specified ID
   *
   * Example:
   *   // Create directory in tracking with same ID as proposed
   *   const proposedId = proposedNode.id;
   *   parent.createChildWithId({ name: 'folder', isDirectory: true }, proposedId);
   */
  createChildWithId(data: NodeData, nodeId: NodeID): TreeNode {
    return executeCreate(this.vaultState, {
      type: 'create',
      nodeId,
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
    if (this.parentId === null) {
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
    if (this.parentId === null) {
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
    if (this.parentId === null || this.data.name === TRASH_FOLDER || this.data.name === TMP_FOLDER) {
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
