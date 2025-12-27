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
import { TRASH_FOLDER, TMP_FOLDER, DELETED_FROM_KEY } from './types';
import { encodeBase64, decodeBase64 } from '$lib/utils/base64';

export class VaultState {
  private tree: TreeNode;  // Root of the tree
  private nodeIndex: Map<NodeID, TreeNode> = new Map();  // Fast node lookup
  private deletedNodes: Map<NodeID, TreeNode> = new Map();  // Tombstones for deleted nodes
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
    if (node.parentId === null) return '';  // Root has no parent

    const parts: string[] = [];
    let current: TreeNode | null = node;

    while (current && current.parentId !== null) {  // Stop at root
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

  // ===== CONVENIENCE METHODS (TreeFS compatibility) =====

  /**
   * Create a node at an arbitrary path, creating intermediate directories as needed.
   * Mirrors TreeFS.createNode(path, data) pattern for easy migration.
   *
   * Example:
   *   state.createAtPath('folder/subfolder/file.md', { isDirectory: false, text: 'content' })
   *   // Creates 'folder' and 'subfolder' if they don't exist, then creates 'file.md'
   *
   * @param path Full path from root (e.g., 'folder/subfolder/file.md')
   * @param data Node data (name should NOT be included, extracted from path)
   * @param nodeId Optional explicit ID for the final node (for ID consistency during sync/approval)
   * @returns The created TreeNode at the path
   * @throws Error if path contains non-directory nodes
   */
  createAtPath(path: string, data: NodeData, nodeId?: NodeID): TreeNode {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length === 0) {
      throw new Error('Cannot create node with empty path');
    }

    let current = this.tree;

    // Create all parent directories
    for (const part of parts.slice(0, -1)) {
      let child = current.childIds
        .map(id => this.nodeIndex.get(id))
        .find(n => n?.data.name === part);

      if (!child) {
        child = current.createChild({ name: part, isDirectory: true });
      } else if (!child.data.isDirectory) {
        throw new Error(`Path is not a directory: ${part}`);
      }
      current = child;
    }

    // Create final node with provided data
    const name = parts[parts.length - 1];
    if (nodeId) {
      return current.createChildWithId({ ...data, name }, nodeId);
    }
    return current.createChild({ ...data, name });
  }

  /**
   * Find or create directories along a path.
   * Mirrors TreeFS.ensureDirs(path) pattern for easy migration.
   *
   * If any parent directory is in trash, it will be deleted and recreated.
   * Returns the last directory in the path.
   *
   * Example:
   *   const parent = state.ensureDirs('folder/subfolder')
   *   // Returns the 'subfolder' node, creating both if needed
   *
   * @param path Directory path to ensure exists
   * @returns The directory TreeNode at the path
   * @throws Error if any part of path exists as a non-directory
   */
  ensureDirs(path: string): TreeNode {
    if (path === '' || path === '/') return this.tree;

    const parts = path.split('/').filter(p => p.length > 0);
    let current = this.tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let child = current.childIds
        .map(id => this.nodeIndex.get(id))
        .find(n => n?.data.name === part);

      if (!child) {
        // Check if trashed and restore or recreate
        const partialPath = parts.slice(0, i + 1).join('/');
        const trashed = this.findTrashed(partialPath);
        if (trashed) {
          // Delete the trashed node and recreate
          const parent = this.nodeIndex.get(trashed.parentId!);
          if (parent) {
            parent.childIds = parent.childIds.filter(id => id !== trashed.id);
          }
          this.removeNode(trashed.id);
          child = current.createChild({ name: part, isDirectory: true });
        } else {
          child = current.createChild({ name: part, isDirectory: true });
        }
      } else if (!child.data.isDirectory) {
        throw new Error(`Path is not a directory: ${parts.slice(0, i + 1).join('/')}`);
      }
      current = child;
    }

    return current;
  }

  /**
   * Alias for getNode() for TreeFS compatibility.
   * Find a node by its ID.
   *
   * @param nodeId The NodeID to look up
   * @returns The TreeNode, or null if not found
   */
  findById(nodeId: NodeID): TreeNode | null {
    return this.getNode(nodeId);
  }

  /**
   * Get all children of a node as TreeNode objects.
   * Convenience method for iterating children without manual lookup.
   *
   * Example:
   *   const children = state.getChildren(parentNode.id);
   *   for (const child of children) {
   *     console.log(child.data.name);
   *   }
   *
   * @param nodeId The NodeID of the parent
   * @returns Array of child TreeNodes (empty array if node not found or has no children)
   */
  getChildren(nodeId: NodeID): TreeNode[] {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return [];
    return node.childIds
      .map(id => this.nodeIndex.get(id))
      .filter((child): child is TreeNode => child !== undefined);
  }

  /**
   * Get the parent of a node.
   * Mirrors Loro's node.parent() pattern.
   *
   * Example:
   *   const parent = state.getParent(nodeId);
   *   if (parent) {
   *     console.log(parent.data.name);
   *   }
   *
   * @param nodeId The NodeID of the node
   * @returns The parent TreeNode, or null if node not found or is root
   */
  getParent(nodeId: NodeID): TreeNode | null {
    const node = this.nodeIndex.get(nodeId);
    if (!node || !node.parentId) return null;
    return this.nodeIndex.get(node.parentId) ?? null;
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
   * Remove a node from the index and move it to deleted nodes.
   * Used by deleteNodeAndChildren helper.
   * Does NOT record an operation.
   *
   * Deleted nodes are kept as tombstones so that references to them
   * can still check isDeleted() like Loro's behavior.
   *
   * @param nodeId The NodeID to remove
   */
  removeNode(nodeId: NodeID): void {
    const node = this.nodeIndex.get(nodeId);
    if (node) {
      this.deletedNodes.set(nodeId, node);
    }
    this.nodeIndex.delete(nodeId);
  }

  /**
   * Get a deleted node by its ID (tombstone lookup).
   * Returns null if node was never deleted or doesn't exist.
   *
   * @param nodeId The NodeID to look up
   * @returns The deleted TreeNode, or null if not found
   */
  getDeletedNode(nodeId: NodeID): TreeNode | null {
    return this.deletedNodes.get(nodeId) ?? null;
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
   * Get operations since a specific index.
   * Used by mergeDocs() to get new operations since last merge.
   *
   * @param sinceIndex The index to start from (exclusive of operations before this)
   * @returns Array of operations from sinceIndex to end
   */
  getOperationsSince(sinceIndex: number): Operation[] {
    return this.operationsLog.slice(sinceIndex);
  }

  /**
   * Replay a single operation from another state.
   * Used by mergeDocs() to sync operations between tracking and proposed.
   * The operation is executed and recorded in this state's log.
   *
   * @param op The operation to replay (contains nodeId for creates)
   */
  replayOperation(op: Operation): void {
    executeOperation(this, op);
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
      this.deletedNodes.clear();

      // Create root as literal (infrastructure, not recorded)
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

  /**
   * No-op commit method for Loro compatibility.
   * VaultState records operations automatically, so explicit commits are not needed.
   * This method exists to allow VaultOverlay code to call .commit() during migration.
   * TODO: Phase 4b.2 - Remove this method after removing all .commit() calls from VaultOverlay.
   */
  commit(): void {
    // no-op: VaultState records operations automatically
  }

  // ===== PERSISTENCE =====

  /**
   * Serialize the vault state to JSON.
   * Encodes binary buffers as base64 strings for JSON compatibility.
   * Used for chat snapshot persistence.
   *
   * @returns SerializedState ready to JSON.stringify()
   */
  serialize(): SerializedState {
    const serialized: SerializedOperation[] = this.operationsLog.map(op => {
      if (op.type === 'create') {
        // Encode buffer in create operation's data
        const data = { ...op.data };
        if (data.buffer instanceof Uint8Array) {
          return {
            type: 'create',
            nodeId: op.nodeId,
            parentId: op.parentId,
            data: {
              ...data,
              buffer: encodeBase64(data.buffer) as string
            }
          } as SerializedOperation;
        }
        return op as SerializedOperation;
      } else if (op.type === 'modify') {
        // Encode buffer in modify operation's changes
        const changes = { ...op.changes };
        if (changes.buffer instanceof Uint8Array) {
          return {
            type: 'modify',
            nodeId: op.nodeId,
            changes: {
              ...changes,
              buffer: encodeBase64(changes.buffer) as string
            }
          } as SerializedOperation;
        }
        return op as SerializedOperation;
      }
      // DELETE, MOVE, RENAME don't have buffers
      return op as SerializedOperation;
    });

    return { operationsLog: serialized };
  }

  /**
   * Deserialize a vault state from JSON.
   * Decodes base64 buffers back to Uint8Array and replays all operations.
   *
   * @param peerId The peer ID ('tracking' or 'proposed') for the new state
   * @param data SerializedState from JSON.parse()
   * @returns A new VaultState with all operations replayed
   */
  static deserialize(peerId: 'tracking' | 'proposed', data: SerializedState): VaultState {
    // Create a fresh VaultState
    const state = new VaultState(peerId);

    if (data.operationsLog.length === 0) {
      return state;  // Nothing to restore
    }

    // Decode buffers in operations
    const decodedOps: Operation[] = data.operationsLog.map((serializedOp, i) => {
      let op: Operation = serializedOp as Operation;

      if (op.type === 'create') {
        // Decode buffer if present in create operation
        const nodeData = { ...op.data };
        if (typeof nodeData.buffer === 'string') {
          nodeData.buffer = new Uint8Array(decodeBase64(nodeData.buffer));
        }
        op = { type: 'create', nodeId: op.nodeId, parentId: op.parentId, data: nodeData };
      } else if (op.type === 'modify') {
        // Decode buffer if present in modify operation
        const changes = { ...op.changes };
        if (typeof changes.buffer === 'string') {
          changes.buffer = new Uint8Array(decodeBase64(changes.buffer));
        }
        op = { type: 'modify', nodeId: op.nodeId, changes };
      }

      return op;
    });

    // Copy operations log into the state
    state.operationsLog = decodedOps;

    // Rebuild the tree from the operations log
    state.rebuildTreeFromLog();

    return state;
  }
}
