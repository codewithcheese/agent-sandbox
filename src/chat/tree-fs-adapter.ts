/**
 * TreeFSAdapter: A TreeFS-compatible wrapper around VaultState.
 *
 * This adapter allows VaultOverlay to use VaultState as a backend while
 * maintaining the TreeFS interface. It bridges the gap between:
 * - TreeFS (Loro-based): Works with LoroTreeNode objects with container-style data access
 * - VaultState (Operations log): Works with TreeNode objects with direct data access
 *
 * The adapter wraps TreeNode objects to provide a LoroTreeNode-like interface,
 * allowing test-driven migration without changing test code.
 */

import { type FileStats, normalizePath } from "obsidian";
import { invariant } from "@epic-web/invariant";
import { basename, dirname } from "path-browserify";
import { TreeNode, type VaultState, type NodeID, type NodeData } from "./vault-state/index";

export const trashPath = ".overlay-trash" as const;
export const overlayTmpPath = ".overlay-tmp" as const;
export const deletedFrom = "deletedFrom" as const;
export const isDirectoryKey = "isDirectory" as const;
export const wasCreatedKey = "wasCreated" as const;

export type NodeData_FS = {
  isDirectory?: boolean;
  text?: string;
  buffer?: ArrayBuffer;
  stat?: FileStats;
};

/**
 * TreeNodeProxy wraps a TreeNode to provide a LoroTreeNode-like interface.
 * This allows VaultOverlay code to access node data using .data.get/set/delete
 * while actually modifying the underlying TreeNode through VaultState operations.
 */
class TreeNodeProxy {
  readonly id: NodeID;
  private dataProxy: DataProxy;

  constructor(readonly treeNode: TreeNode, private state: VaultState) {
    this.id = treeNode.id;
    this.dataProxy = new DataProxy(treeNode, state);
  }

  /**
   * Proxy to node.data with get/set/delete interface matching LoroTreeNode.
   */
  get data(): DataProxy {
    return this.dataProxy;
  }

  /**
   * Get parent node (wrapped as TreeNodeProxy).
   */
  parent(): TreeNodeProxy | undefined {
    if (!this.treeNode.parentId) return undefined;
    const parentNode = this.state.getNode(this.treeNode.parentId);
    return parentNode ? new TreeNodeProxy(parentNode, this.state) : undefined;
  }

  /**
   * Get children nodes (wrapped as TreeNodeProxy array).
   */
  children(): TreeNodeProxy[] {
    return this.treeNode.childIds
      .map((childId) => this.state.getNode(childId))
      .filter((child): child is TreeNode => child !== undefined)
      .map((child) => new TreeNodeProxy(child, this.state));
  }

  /**
   * Move this node to a new parent.
   */
  move(newParent: TreeNodeProxy): void {
    this.treeNode.move(newParent.treeNode);
  }

  /**
   * Create a child node with given data.
   */
  createNode(): TreeNodeProxy {
    const child = this.treeNode.createChild({
      name: "",
      isDirectory: false,
    });
    return new TreeNodeProxy(child, this.state);
  }

  /**
   * Check if this node is deleted (has deletedFrom metadata).
   */
  isDeleted(): boolean {
    return this.treeNode.isTrashed();
  }
}

/**
 * DataProxy provides a LoroTreeNode.data-like interface for TreeNode.data.
 * It translates get/set/delete calls to TreeNode.modify() operations.
 */
class DataProxy {
  constructor(private treeNode: TreeNode, private state: VaultState) {}

  /**
   * Get a field value, matching LoroTreeNode.data.get(key).
   */
  get(key: string): unknown {
    return this.treeNode.data[key];
  }

  /**
   * Set a field value, matching LoroTreeNode.data.set(key, value).
   */
  set(key: string, value: unknown): void {
    this.treeNode.modify({ [key]: value });
  }

  /**
   * Delete a field, matching LoroTreeNode.data.delete(key).
   */
  delete(key: string): void {
    this.treeNode.modify({ [key]: undefined });
  }

  /**
   * Set a container field (for LoroText compatibility).
   * In Loro, this creates a text container, but we just store the value directly.
   */
  setContainer(key: string, value: unknown): void {
    this.treeNode.modify({ [key]: value });
  }
}

/**
 * TreeFSAdapter: Implements TreeFS interface using VaultState backend.
 *
 * This adapter allows VaultOverlay to switch from Loro to VaultState
 * without changing its code. All methods map directly to VaultState operations.
 */
export class TreeFSAdapter {
  public pathCache = new Map<NodeID, string>();
  private deletedFromIndex = new Set<string>();
  private cacheValid = false;

  constructor(private state: VaultState) {
    // Initialize cache
    this.rebuildCache();
  }

  /**
   * Find a node by its full path.
   * Maps to VaultState.findByPath().
   */
  findByPath(path: string): TreeNodeProxy | undefined {
    path = normalizePath(path);

    if (path === "." || path === "/" || path === "" || path === "./") {
      const root = this.state.getNode("0");
      return root ? new TreeNodeProxy(root, this.state) : undefined;
    }

    if (!this.cacheValid) {
      this.rebuildCache();
    }

    const node = this.state.findByPath(path);
    return node ? new TreeNodeProxy(node, this.state) : undefined;
  }

  /**
   * Create a node at the given path with data.
   * Maps to VaultState.createAtPath().
   */
  createNode(path: string, data: NodeData_FS): TreeNodeProxy {
    path = normalizePath(path);

    // Check if node already exists
    const existing = this.state.findByPath(path);
    if (existing) {
      throw Error(`Node already exists: ${path}`);
    }

    const node = this.state.createAtPath(path, {
      name: basename(path),
      ...data,
    });

    this.invalidateCache();
    return new TreeNodeProxy(node, this.state);
  }

  /**
   * Create a child node under a parent.
   * Helper used by createNode.
   */
  createChildNode(
    parent: TreeNodeProxy,
    path: string,
    data: NodeData_FS,
  ): TreeNodeProxy {
    invariant(
      data.isDirectory || data.text != null || data.buffer != null,
      "Cannot create node, must be directory or file with text or binary data",
    );
    if (data.isDirectory && (data.text || data.buffer)) {
      throw new Error("Cannot create directory with text or binary data");
    }

    const child = parent.treeNode.createChild({
      name: basename(path),
      ...data,
      ...(data.isDirectory && { [wasCreatedKey]: true }),
    });

    this.invalidateCache();
    return new TreeNodeProxy(child, this.state);
  }

  /**
   * Move a node to a new parent.
   * Maps to TreeNode.move().
   */
  moveNode(node: TreeNodeProxy, parentId: NodeID): void {
    const newParent = this.state.getNode(parentId);
    invariant(newParent, `Cannot move node. Parent not found: ${parentId}`);

    const oldPath = this.getNodePath(node.treeNode);
    node.treeNode.move(newParent);
    const newPath = this.getNodePath(node.treeNode);

    // Update cache
    this.pathCache.delete(oldPath);
    this.pathCache.set(node.id, newPath);
    this.invalidateCache();
  }

  /**
   * Delete a node by ID.
   * Maps to TreeNode.delete().
   */
  deleteNode(nodeId: NodeID): void {
    const node = this.state.getNode(nodeId);
    invariant(node, `Cannot delete node. Node not found: ${nodeId}`);
    node.delete();
    this.invalidateCache();
  }

  /**
   * Move a node to trash with metadata.
   * Maps to TreeNode.trash().
   */
  trashNode(node: TreeNodeProxy, originalPath: string): void {
    node.treeNode.trash(normalizePath(originalPath));
    this.invalidateCache();
  }

  /**
   * Ensure a directory path exists, creating directories as needed.
   * Maps to VaultState.ensureDirs().
   */
  ensureDirs(path: string): TreeNodeProxy {
    path = normalizePath(path);

    if (path === "." || path === "") {
      const root = this.state.getNode("0");
      invariant(root, "Root node not found");
      return new TreeNodeProxy(root, this.state);
    }

    const node = this.state.ensureDirs(path);
    this.invalidateCache();
    return new TreeNodeProxy(node, this.state);
  }

  /**
   * Rename a node.
   * Maps to TreeNode.rename().
   */
  renameNode(nodeId: NodeID, newName: string): void {
    const node = this.state.getNode(nodeId);
    invariant(node, `Cannot rename node. Node not found: ${nodeId}`);
    node.rename(basename(newName));
    this.invalidateCache();
  }

  /**
   * Restore a node from trash.
   * Maps to TreeNode.restore().
   */
  restoreNode(node: TreeNodeProxy, parent: TreeNodeProxy): void {
    node.treeNode.restore(parent.treeNode);
    this.invalidateCache();
  }

  /**
   * Update path cache entry.
   */
  updateNodePath(oldPath: string, newPath: string, nodeId: NodeID): void {
    oldPath = normalizePath(oldPath);
    newPath = normalizePath(newPath);
    this.pathCache.delete(oldPath);
    this.pathCache.set(nodeId, newPath);
  }

  /**
   * Find a node by ID.
   * Maps to VaultState.getNode().
   */
  findById(id: NodeID): TreeNodeProxy | undefined {
    const node = this.state.getNode(id);
    return node ? new TreeNodeProxy(node, this.state) : undefined;
  }

  /**
   * Find a trashed node by its original path.
   * Maps to VaultState.findTrashed().
   */
  findTrashed(path: string): TreeNodeProxy | undefined {
    path = normalizePath(path);
    const node = this.state.findTrashed(path);
    return node ? new TreeNodeProxy(node, this.state) : undefined;
  }

  /**
   * Check if a path is deleted (in trash).
   */
  isDeleted(path: string): boolean {
    path = normalizePath(path);
    if (!this.cacheValid) {
      this.rebuildCache();
    }
    return this.deletedFromIndex.has(path);
  }

  /**
   * Invalidate the path cache.
   */
  invalidateCache(): void {
    this.pathCache.clear();
    this.deletedFromIndex.clear();
    this.cacheValid = false;
  }

  /**
   * Revert to a checkpoint.
   * Maps to VaultState.rollback().
   */
  revertTo(checkpointIndex: number): void {
    this.state.rollback(checkpointIndex);
    this.invalidateCache();
  }

  /**
   * Get the full path of a node.
   * Maps to VaultState.getNodePath().
   */
  getNodePath(node: TreeNode): string {
    return this.state.getNodePath(node.id);
  }

  /**
   * Get validated path cache.
   */
  getValidatedPathCache(): Map<NodeID, string> {
    if (!this.cacheValid) {
      this.rebuildCache();
    }
    return this.pathCache;
  }

  /**
   * Rebuild path cache from tree structure.
   */
  private rebuildCache(): void {
    this.pathCache.clear();
    this.rebuildDeletedIndex();

    const root = this.state.getNode("0");
    if (root) {
      this.buildCacheFromNode(root, "");
    }

    this.cacheValid = true;
  }

  /**
   * Rebuild the deleted (trashed) path index.
   */
  private rebuildDeletedIndex(): void {
    this.deletedFromIndex.clear();

    const trashFolder = this.state.getTrashFolder();
    const trashedNodes = this.state.getChildren(trashFolder.id);

    for (const trashedNode of trashedNodes) {
      const deletedFromPath = trashedNode.data[deletedFrom] as string | undefined;
      if (deletedFromPath) {
        this.deletedFromIndex.add(normalizePath(deletedFromPath));
      }
    }
  }

  /**
   * Recursively build cache from node tree.
   */
  private buildCacheFromNode(node: TreeNode, parentPath: string): void {
    const name = node.data.name as string;
    const path = parentPath ? `${parentPath}/${name}` : name;

    // Only cache non-root nodes with actual paths
    if (path && path !== "") {
      this.pathCache.set(node.id, path);
    }

    const children = this.state.getChildren(node.id);
    for (const child of children) {
      this.buildCacheFromNode(child, path);
    }
  }
}
