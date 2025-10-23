/**
 * VaultState represents the complete state of the vault as an operations log.
 *
 * The vault is represented as a tree of nodes (files and directories).
 * All mutations are recorded as Operation objects in the operationsLog.
 * The tree can be rebuilt at any checkpoint by replaying operations.
 *
 * This replaces Loro CRDT with a simpler, more efficient system where:
 * - Rollback is O(n) rebuild, not O(n*m) with accumulated inverse operations
 * - Serialization is JSON, not binary WASM snapshots
 * - Change detection is O(m) on staged operations, not O(n) on all nodes
 */

import type {
  NodeID,
  NodeData,
  Operation,
  CreateOperation,
  DeleteOperation,
  ModifyOperation,
  MoveOperation,
  RenameOperation,
  SerializedState,
  SerializedOperation
} from './types';
import { TreeNode } from './tree-node';

export class VaultState {
  private tree: TreeNode;  // Root of the tree
  private nodeIndex: Map<NodeID, TreeNode> = new Map();  // Fast node lookup
  private operationsLog: Operation[] = [];  // Append-only log of all mutations
  private recordingEnabled: boolean = true;  // Flag to enable/disable recording during rebuild

  constructor(private peerId: 'tracking' | 'proposed') {
    // Create empty root node
    this.tree = new TreeNode('root', this);
    this.tree.data = {
      name: '',
      isDirectory: true
    };
    this.tree.parentId = null;
    this.nodeIndex.set('root', this.tree);
  }

  // ===== TREE QUERIES =====

  /**
   * Get a node by its ID.
   * Returns null if node not found.
   *
   * @param nodeId The NodeID to look up
   * @returns The TreeNode, or null if not found
   */
  getNode(nodeId: NodeID): TreeNode | null {
    return this.nodeIndex.get(nodeId) ?? null;
  }

  /**
   * Find a node by its full path.
   * Simple tree traversal: split path and walk down the tree.
   *
   * @param path The full path to search for (e.g., 'folder/file.md')
   * @returns The TreeNode, or null if not found
   */
  findByPath(path: string): TreeNode | null {
    if (path === '') return this.tree;  // Root

    const parts = path.split('/');
    let current = this.tree;

    for (const part of parts) {
      // Find child with matching name
      const childId = current.childIds.find(id => {
        const child = this.nodeIndex.get(id);
        return child?.data.name === part;
      });

      if (!childId) return null;
      current = this.nodeIndex.get(childId)!;
    }

    return current;
  }

  /**
   * Get the full path of a node by walking up the parent chain.
   *
   * @param nodeId The NodeID to get path for
   * @returns Full path (e.g., 'folder/file.md'), or empty string for root
   */
  getNodePath(nodeId: NodeID): string {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return '';
    if (node.id === 'root') return '';

    const parts: string[] = [];
    let current: TreeNode | null = node;

    while (current && current.id !== 'root') {
      parts.unshift(current.data.name);
      current = current.parentId ? this.nodeIndex.get(current.parentId) : null;
    }

    return parts.join('/');
  }

  /**
   * Get all descendants of a node (for directory traversal).
   *
   * @param nodeId The NodeID of the subtree root
   * @returns Array of all descendant TreeNodes
   */
  getDescendants(nodeId: NodeID): TreeNode[] {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return [];

    const descendants: TreeNode[] = [];

    const collect = (n: TreeNode) => {
      for (const childId of n.childIds) {
        const child = this.nodeIndex.get(childId);
        if (child) {
          descendants.push(child);
          collect(child);
        }
      }
    };

    collect(node);
    return descendants;
  }

  // ===== MUTATIONS (record operations) =====

  /**
   * Create a new node.
   * Records a CreateOperation and adds node to tree.
   *
   * @param nodeId Unique ID for the new node
   * @param parentId ID of the parent directory
   * @param data NodeData including name and isDirectory
   * @returns The created TreeNode
   */
  createNode(nodeId: NodeID, parentId: NodeID, data: NodeData): TreeNode {
    const parent = this.nodeIndex.get(parentId);
    if (!parent) {
      throw new Error(`Parent node not found: ${parentId}`);
    }

    // Create the node
    const newNode = new TreeNode(nodeId, this);
    newNode.parentId = parentId;
    newNode.data = { ...data };

    // Add to parent's children
    parent.childIds.push(nodeId);

    // Add to index
    this.nodeIndex.set(nodeId, newNode);

    // Record operation
    this.recordOperation({
      type: 'create',
      nodeId,
      parentId,
      data
    });

    return newNode;
  }

  /**
   * Delete a node and all its descendants.
   * Records a single atomic DeleteOperation.
   *
   * @param nodeId The NodeID to delete
   */
  deleteNode(nodeId: NodeID): void {
    if (nodeId === 'root') {
      throw new Error('Cannot delete root node');
    }

    const node = this.nodeIndex.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    // Remove from parent
    if (node.parentId) {
      const parent = this.nodeIndex.get(node.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter(id => id !== nodeId);
      }
    }

    // Recursively delete children from index
    this.deleteNodeAndChildren(nodeId);

    // Record operation
    this.recordOperation({
      type: 'delete',
      nodeId
    });
  }

  /**
   * Recursively delete a node and all its descendants from the index.
   * Does NOT record operations (called during delete or rebuild).
   *
   * @param nodeId The NodeID to delete
   */
  private deleteNodeAndChildren(nodeId: NodeID): void {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return;

    // Recursively delete children
    for (const childId of [...node.childIds]) {
      this.deleteNodeAndChildren(childId);
    }

    // Delete the node itself
    this.nodeIndex.delete(nodeId);
  }

  /**
   * Modify fields on a node.
   * Records a ModifyOperation with all changes.
   *
   * @param nodeId The NodeID to modify
   * @param changes Object with fields to modify
   */
  modifyNode(nodeId: NodeID, changes: Partial<NodeData>): void {
    const node = this.nodeIndex.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    // Apply all changes
    Object.entries(changes).forEach(([field, value]) => {
      node.data[field] = value;
    });

    // Record operation
    this.recordOperation({
      type: 'modify',
      nodeId,
      changes
    });
  }

  /**
   * Move a node to a different parent.
   * Records a MoveOperation.
   *
   * @param nodeId The NodeID to move
   * @param newParentId The new parent NodeID
   */
  moveNode(nodeId: NodeID, newParentId: NodeID): void {
    const node = this.nodeIndex.get(nodeId);
    const newParent = this.nodeIndex.get(newParentId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    if (!newParent) {
      throw new Error(`Parent node not found: ${newParentId}`);
    }

    // Detect circular references
    let current: TreeNode | null = newParent;
    while (current) {
      if (current.id === nodeId) {
        throw new Error(`Cannot move node under its own descendant (circular reference)`);
      }
      current = current.parentId ? this.nodeIndex.get(current.parentId) : null;
    }

    // Remove from old parent
    if (node.parentId) {
      const oldParent = this.nodeIndex.get(node.parentId);
      if (oldParent) {
        oldParent.childIds = oldParent.childIds.filter(id => id !== nodeId);
      }
    }

    // Add to new parent
    newParent.childIds.push(nodeId);
    node.parentId = newParentId;

    // Record operation
    this.recordOperation({
      type: 'move',
      nodeId,
      newParentId
    });
  }

  /**
   * Rename a node (change path segment).
   * Records a RenameOperation.
   *
   * @param nodeId The NodeID to rename
   * @param newName The new basename
   */
  renameNode(nodeId: NodeID, newName: string): void {
    if (nodeId === 'root') {
      throw new Error('Cannot rename root node');
    }

    const node = this.nodeIndex.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    node.data.name = newName;

    // Record operation
    this.recordOperation({
      type: 'rename',
      nodeId,
      newName
    });
  }

  // ===== OPERATION LOG MANAGEMENT =====

  /**
   * Get all operations in the log, optionally filtered by type.
   *
   * @param type Optional operation type to filter by
   * @returns Array of operations
   */
  getOperations(type?: string): Operation[] {
    if (!type) {
      return [...this.operationsLog];
    }
    return this.operationsLog.filter(op => op.type === type);
  }

  /**
   * Get operations affecting a specific node.
   *
   * @param nodeId The NodeID to filter by
   * @returns Array of operations that mention this nodeId
   */
  getOperationsForNode(nodeId: NodeID): Operation[] {
    return this.operationsLog.filter(op => {
      // All operation types have a nodeId field
      return 'nodeId' in op && op.nodeId === nodeId;
    });
  }

  /**
   * Create a checkpoint (saves current position in log).
   * Returns the index that can be passed to rollback().
   *
   * @returns Current length of operationsLog
   */
  checkpoint(): number {
    return this.operationsLog.length;
  }

  /**
   * Rollback to a specific checkpoint.
   * Truncates the operations log and rebuilds the tree.
   *
   * @param checkpointIndex The checkpoint index (from checkpoint())
   */
  rollback(checkpointIndex: number): void {
    if (checkpointIndex < 0 || checkpointIndex > this.operationsLog.length) {
      throw new Error(`Invalid checkpoint: ${checkpointIndex}`);
    }

    // Truncate log
    this.operationsLog = this.operationsLog.slice(0, checkpointIndex);

    // Rebuild tree from log
    this.rebuildTreeFromLog();
  }

  /**
   * Get current length of the operations log.
   * Useful for debugging and testing.
   *
   * @returns Number of operations recorded so far
   *
   * Phase 1: Simple getter, implemented now
   */
  getLogLength(): number {
    return this.operationsLog.length;
  }

  // ===== OPERATION EXECUTION (Internal) =====

  /**
   * Execute a single operation on the tree.
   * Called during rebuildTreeFromLog().
   * Dispatches to specific executeXxx() methods based on operation type.
   *
   * @param op The operation to execute
   */
  private executeOperation(op: Operation): void {
    switch (op.type) {
      case 'create':
        this.executeCreate(op);
        break;
      case 'delete':
        this.executeDelete(op);
        break;
      case 'modify':
        this.executeModify(op);
        break;
      case 'move':
        this.executeMove(op);
        break;
      case 'rename':
        this.executeRename(op);
        break;
    }
  }

  /**
   * Execute a CREATE operation.
   * Creates new TreeNode and adds to parent's children.
   *
   * @param op The CreateOperation
   */
  private executeCreate(op: CreateOperation): void {
    const parent = this.nodeIndex.get(op.parentId);
    if (!parent) {
      throw new Error(`Parent node not found during CREATE: ${op.parentId}`);
    }

    const newNode = new TreeNode(op.nodeId, this);
    newNode.parentId = op.parentId;
    newNode.data = { ...op.data };

    parent.childIds.push(op.nodeId);
    this.nodeIndex.set(op.nodeId, newNode);
  }

  /**
   * Execute a DELETE operation.
   * Removes node from parent and deletes all descendants from index.
   *
   * @param op The DeleteOperation
   */
  private executeDelete(op: DeleteOperation): void {
    const node = this.nodeIndex.get(op.nodeId);
    if (!node) {
      throw new Error(`Node not found during DELETE: ${op.nodeId}`);
    }

    // Remove from parent
    if (node.parentId) {
      const parent = this.nodeIndex.get(node.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter(id => id !== op.nodeId);
      }
    }

    // Recursively delete children
    this.deleteNodeAndChildren(op.nodeId);
  }

  /**
   * Execute a MODIFY operation.
   * Updates fields on the node.
   *
   * @param op The ModifyOperation
   */
  private executeModify(op: ModifyOperation): void {
    const node = this.nodeIndex.get(op.nodeId);
    if (!node) {
      throw new Error(`Node not found during MODIFY: ${op.nodeId}`);
    }

    Object.entries(op.changes).forEach(([field, value]) => {
      node.data[field] = value;
    });
  }

  /**
   * Execute a MOVE operation.
   * Changes the parent of a node.
   *
   * @param op The MoveOperation
   */
  private executeMove(op: MoveOperation): void {
    const node = this.nodeIndex.get(op.nodeId);
    const newParent = this.nodeIndex.get(op.newParentId);

    if (!node) {
      throw new Error(`Node not found during MOVE: ${op.nodeId}`);
    }
    if (!newParent) {
      throw new Error(`Parent node not found during MOVE: ${op.newParentId}`);
    }

    // Remove from old parent
    if (node.parentId) {
      const oldParent = this.nodeIndex.get(node.parentId);
      if (oldParent) {
        oldParent.childIds = oldParent.childIds.filter(id => id !== op.nodeId);
      }
    }

    // Add to new parent
    newParent.childIds.push(op.nodeId);
    node.parentId = op.newParentId;
  }

  /**
   * Execute a RENAME operation.
   * Changes the name (path segment) of a node.
   *
   * @param op The RenameOperation
   */
  private executeRename(op: RenameOperation): void {
    const node = this.nodeIndex.get(op.nodeId);
    if (!node) {
      throw new Error(`Node not found during RENAME: ${op.nodeId}`);
    }

    node.data.name = op.newName;
  }

  /**
   * Rebuild the entire tree by replaying all operations from the log.
   * Used by rollback() and deserialization (Phase 6).
   *
   * Deterministic: Same log always produces same tree.
   * Idempotent: Rebuilding multiple times produces identical result.
   */
  private rebuildTreeFromLog(): void {
    // Disable recording during rebuild to prevent duplicate operations
    this.recordingEnabled = false;

    try {
      // Start fresh
      this.nodeIndex.clear();

      // Create empty root
      const root = new TreeNode('root', this);
      root.data = {
        name: '',
        isDirectory: true
      };
      root.parentId = null;
      this.nodeIndex.set('root', root);
      this.tree = root;

      // Replay all operations in order
      for (let i = 0; i < this.operationsLog.length; i++) {
        const op = this.operationsLog[i];
        try {
          this.executeOperation(op);
        } catch (e) {
          throw new Error(
            `Failed to replay operation #${i} (${op.type}): ${(e as Error).message}`
          );
        }
      }
    } finally {
      // Always re-enable recording, even if rebuild fails
      this.recordingEnabled = true;
    }
  }

  /**
   * Record an operation in the log.
   * Respects the recordingEnabled flag (disabled during rebuild).
   *
   * @param op The operation to record
   */
  recordOperation(op: Operation): void {
    if (!this.recordingEnabled) return;  // No-op during rebuild
    this.operationsLog.push(op);
  }

  /**
   * Execute and record an operation in one step.
   * Used during approval workflows where operations from one state
   * are replayed in another state.
   *
   * @param op The operation to execute and record
   */
  executeAndRecord(op: Operation): void {
    this.executeOperation(op);
    this.recordOperation(op);
  }

  // ===== PERSISTENCE (Phase 6) =====

  /**
   * Serialize the vault state to JSON.
   * Used for chat snapshot persistence.
   *
   * @returns SerializedState ready to JSON.stringify()
   *
   * Phase 6: Implement (encode buffers as base64, return operationsLog)
   */
  serialize(): SerializedState {
    throw new Error('Phase 6: Not yet implemented');
  }

  /**
   * Deserialize a vault state from JSON.
   * Creates a new VaultState and replays all operations.
   *
   * @param data SerializedState from JSON.parse()
   * @returns A new VaultState with all operations replayed
   *
   * Phase 6: Implement (decode base64 buffers, replay ops)
   */
  static deserialize(data: SerializedState): VaultState {
    throw new Error('Phase 6: Not yet implemented');
  }
}
