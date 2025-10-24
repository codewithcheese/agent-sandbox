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
  SerializedState,
  SerializedOperation
} from './types';
import { TreeNode } from './tree-node';
import { executeOperation } from './operations';
import { TRASH_FOLDER, TMP_FOLDER } from './types';

export class VaultState {
  private tree: TreeNode;  // Root of the tree
  private nodeIndex: Map<NodeID, TreeNode> = new Map();  // Fast node lookup
  private operationsLog: Operation[] = [];  // Append-only log of all mutations
  private recordingEnabled: boolean = true;  // Flag to enable/disable recording during rebuild

  constructor(private peerId: 'tracking' | 'proposed') {
    // Reset ID counter to ensure root gets ID "0"
    TreeNode.resetIdCounter();

    // Create root node as literal (infrastructure, not recorded)
    // Root naturally gets ID "0" as the first node created
    this.tree = new TreeNode(this);
    this.tree.data = {
      name: '',
      isDirectory: true
    };
    this.tree.parentId = null;
    this.nodeIndex.set(this.tree.id, this.tree);

    // Create infrastructure folders as literals (not recorded in operations log)
    // Disable recording while creating these infrastructure nodes
    this.recordingEnabled = false;
    try {
      this.tree.createChild({
        name: TRASH_FOLDER,
        isDirectory: true
      });

      this.tree.createChild({
        name: TMP_FOLDER,
        isDirectory: true
      });
    } finally {
      // Always restore recording, even if construction fails
      this.recordingEnabled = true;
    }
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

  /**
   * Get the trash folder infrastructure node.
   * Used for soft-delete operations.
   * Finds the trash folder by its name since it's created with an auto-generated ID.
   *
   * @returns The trash folder TreeNode
   * @throws Error if trash folder not found
   */
  getTrashFolder(): TreeNode {
    const root = this.tree;
    for (const childId of root.childIds) {
      const child = this.nodeIndex.get(childId);
      if (child && child.data.name === TRASH_FOLDER) {
        return child;
      }
    }
    throw new Error(`Trash folder not found: ${TRASH_FOLDER}`);
  }

  /**
   * Find a trashed node by its original path.
   * Searches direct children of trash folder for matching `deletedFrom` metadata.
   *
   * @param originalPath The path the node was deleted from
   * @returns The trashed TreeNode, or null if not found
   */
  findTrashed(originalPath: string): TreeNode | null {
    const trash = this.getTrashFolder();
    for (const childId of trash.childIds) {
      const child = this.nodeIndex.get(childId);
      if (child && child.data[DELETED_FROM_KEY] === originalPath) {
        return child;
      }
    }
    return null;
  }

  // ===== MUTATIONS (record operations) =====

  /**
   * Add a node to the index.
   * Used by execute functions during rebuild.
   * Does NOT record an operation.
   *
   * @param node The TreeNode to add
   */
  addNode(node: TreeNode): void {
    this.nodeIndex.set(node.id, node);
  }

  /**
   * Remove a node from the index.
   * Used by deleteNodeAndChildren helper.
   * Does NOT record an operation.
   *
   * @param nodeId The NodeID to remove
   */
  removeNode(nodeId: NodeID): void {
    this.nodeIndex.delete(nodeId);
  }

  /**
   * Recursively delete a node and all its descendants from the index.
   * Private helper used by execute functions during deletion and rebuild.
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


  /**
   * Rebuild the entire tree by replaying all operations from the log.
   * Used by rollback() and deserialization (Phase 6).
   *
   * Deterministic: Same log always produces same tree.
   * Idempotent: Rebuilding multiple times produces identical result.
   *
   * The node ID counter is reset to ensure replaying produces identical IDs.
   */
  private rebuildTreeFromLog(): void {
    // Disable recording during rebuild to prevent duplicate operations
    this.recordingEnabled = false;

    try {
      // Reset node ID counter for deterministic replay
      // Root will naturally get ID "0" as the first node created
      TreeNode.resetIdCounter();

      // Start fresh
      this.nodeIndex.clear();

      // Create empty root as literal (infrastructure, not recorded)
      // Root naturally gets ID "0" as the first node
      this.tree = new TreeNode(this);
      this.tree.data = {
        name: '',
        isDirectory: true
      };
      this.tree.parentId = null;
      this.nodeIndex.set(this.tree.id, this.tree);

      // Recreate infrastructure folders using createChild
      // (createChild will record operations, but recording is disabled, so they won't be added to log again)
      this.tree.createChild({
        name: TRASH_FOLDER,
        isDirectory: true
      });

      this.tree.createChild({
        name: TMP_FOLDER,
        isDirectory: true
      });

      // Replay all operations in order using standalone execute functions
      for (let i = 0; i < this.operationsLog.length; i++) {
        const op = this.operationsLog[i];
        try {
          executeOperation(this, op);
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
