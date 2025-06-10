import { type FileStats, normalizePath } from "obsidian";
import {
  type LoroDoc,
  LoroText,
  type LoroTree,
  type LoroTreeNode,
  type TreeID,
} from "loro-crdt/base64";
import { invariant } from "@epic-web/invariant";
import { basename, dirname } from "path-browserify";
import { encodeBase64 } from "$lib/utils/base64.ts";

const trashPath = ".overlay-trash" as const;
const deletedFrom = "deletedFrom" as const;
// differentiate between directories created explicitly and those created ensure a path
export const wasCreatedKey = "wasCreated" as const;

export type NodeData = {
  isDirectory?: boolean;
  text?: string;
  buffer?: ArrayBuffer;
  stat?: FileStats;
};

export class TreeFS {
  private pathCache = new Map<string, TreeID>();
  private deletedFromIndex = new Set<string>();
  private cacheValid = false;
  private tree: LoroTree;

  constructor(private doc: LoroDoc) {
    this.tree = doc.getTree("vault");
  }

  findByPath(path: string): LoroTreeNode | undefined {
    path = normalizePath(path);

    if (path === "." || path === "/" || path === "" || path === "./") {
      return this.tree.roots()[0];
    }

    if (!this.cacheValid) {
      this.rebuildCache();
    }

    const id = this.pathCache.get(path);
    return id && this.tree.getNodeByID(id);
  }

  createNode(path: string, data: NodeData): LoroTreeNode {
    path = normalizePath(path);
    const root = this.tree.roots()[0];
    const parts = path.split("/").filter((part) => part.length > 0);
    let parent = root;

    // optimization: if parent path not root and exists in path cache, skip path traversal, and create directly
    if (dirname(path) !== ".") {
      const parentId = this.pathCache.get(dirname(path));
      const parent = parentId && this.findById(parentId);
      if (parent) {
        return this.createChildNode(parent, path, data);
      }
    }

    for (const [idx, part] of parts.entries()) {
      const isLeaf = idx === parts.length - 1;
      const children = parent.children();
      let node = children?.find((n) => n.data.get("name") === part);

      if (node && isLeaf) {
        throw Error(`Node already exists: ${path}`);
      }

      if (isLeaf) {
        return this.createChildNode(parent, path, data);
      }

      if (!node) {
        node = parent.createNode();
        node.data.set("name", part);
        node.data.set("isDirectory", true);
        if (data.stat) {
          node.data.set("stat", data.stat);
        }
        const currentPath = parts.slice(0, idx + 1).join("/");
        this.pathCache.set(currentPath, node.id);
      }

      parent = node;
    }

    return parent;
  }

  createChildNode(
    parent: LoroTreeNode,
    path: string,
    data: {
      isDirectory?: boolean;
      text?: string;
      buffer?: ArrayBuffer;
      stat?: any;
    },
  ) {
    const c = parent.createNode();
    invariant(
      data.isDirectory || data.text != null || data.buffer != null,
      "Cannot create node, must be directory or file with text or binary data",
    );
    if (data.isDirectory && (data.text || data.buffer)) {
      throw new Error("Cannot create directory with text or binary data");
    }
    c.data.set("name", basename(path));
    if (data.isDirectory) {
      c.data.set("isDirectory", data.isDirectory);
      c.data.set(wasCreatedKey, true);
    }
    if (data.text != null) {
      c.data.setContainer("text", new LoroText());
      (c.data.get("text") as LoroText).insert(0, data.text);
    }
    if (data.buffer != null) {
      c.data.set("buffer", encodeBase64(data.buffer));
    }
    if (data.stat) {
      c.data.set("stat", data.stat);
    }
    this.pathCache.set(path, c.id);
    return c;
  }

  moveNode(node: LoroTreeNode, parentId: TreeID): void {
    const newParent = this.findById(parentId);
    invariant(newParent, `Cannot move node. Parent not found: ${parentId}`);
    const oldPath = this.getNodePath(node);
    node.move(newParent);
    const newPath = this.getNodePath(node);

    // Update cache
    this.pathCache.delete(oldPath);
    this.pathCache.set(newPath, node.id);
  }

  deleteNode(nodeId: TreeID): void {
    const node = this.tree.getNodeByID(nodeId);
    invariant(node, `Cannot delete node. Node not found: ${nodeId}`);
    this.tree.delete(nodeId);
    // invalidate cache, a deleted folder could remove many paths
    this.invalidateCache();
  }

  trashNode(node: LoroTreeNode, originalPath: string): void {
    const trashFolder = this.findByPath(trashPath);
    invariant(trashFolder, `Trash folder not found: ${trashPath}`);

    node.move(trashFolder);
    node.data.set(deletedFrom, normalizePath(originalPath));

    // invalidate cache, a deleted folder could remove many paths
    this.invalidateCache();
  }

  // Create or restore nodes to ensure a directory exists
  ensureDirs(path: string) {
    path = normalizePath(path);

    const root = this.tree.roots()[0];
    const parts = path === "." ? [] : path.split("/");
    let parent = root;

    // optimization: if path in cache then all directories exist
    if (this.pathCache.get(path)) {
      return this.findById(this.pathCache.get(path));
    }

    for (const [idx, part] of parts.entries()) {
      const currentPath = parts.slice(0, idx + 1).join("/");
      const children = parent.children();
      let node = children?.find((n) => n.data.get("name") === part);
      if (node && !node.data.get("isDirectory")) {
        throw Error(
          `Path is not a directory: ${parts.slice(0, idx + 1).join("/")}`,
        );
      } else if (!node) {
        // check for trashed node
        node = this.findTrashed(currentPath);
        if (node) {
          this.restoreNode(node, parent);
        } else {
          node = parent.createNode();
          node.data.set("name", part);
          node.data.set("isDirectory", true);
          node.data.set("stat", {
            size: 0,
            mtime: Date.now(),
            ctime: Date.now(),
          });
          const currentPath = parts.slice(0, idx + 1).join("/");
          this.pathCache.set(currentPath, node.id);
        }
      }
      parent = node;
    }

    return parent;
  }

  renameNode(nodeId: TreeID, newName: string): void {
    const node = this.tree.getNodeByID(nodeId);
    invariant(node, `Cannot renamed node. Node not found: ${nodeId}`);
    node.data.set("name", basename(newName));
    this.invalidateCache();
  }

  restoreNode(node: LoroTreeNode, parent: LoroTreeNode) {
    node.data.delete(deletedFrom);
    node.move(parent);
    this.invalidateCache();
  }

  updateNodePath(oldPath: string, newPath: string, nodeId: TreeID): void {
    oldPath = normalizePath(oldPath);
    newPath = normalizePath(newPath);
    this.pathCache.delete(oldPath);
    this.pathCache.set(newPath, nodeId);
  }

  findById(id: TreeID): LoroTreeNode | undefined {
    return this.tree.getNodeByID(id);
  }

  findTrashed(path: string): LoroTreeNode | undefined {
    path = normalizePath(path);
    const trashRoot = this.findByPath(trashPath);
    invariant(trashRoot, `Trash root not found: ${trashPath}`);

    // walk just this subtree; tomb-stones are direct children
    return trashRoot
      .children()
      ?.find((n) => n.data.get("deletedFrom") === path);
  }

  isDeleted(path: string): boolean {
    path = normalizePath(path);
    if (!this.cacheValid) {
      this.rebuildCache();
    }
    return this.deletedFromIndex.has(path);
  }

  invalidateCache(): void {
    this.cacheValid = false;
  }

  private rebuildCache(): void {
    this.pathCache.clear();
    this.rebuildDeletedIndex();
    const root = this.tree.roots()[0];
    if (root) {
      this.buildCacheFromNode(root, "");
    }
    this.cacheValid = true;
  }

  private rebuildDeletedIndex(): void {
    this.deletedFromIndex.clear();

    // Find trash node directly without triggering cache rebuild
    const root = this.tree.roots()[0];
    if (root) {
      const children = root.children();
      const trashNode = children?.find((n) => n.data.get("name") === trashPath);
      if (trashNode) {
        const trashedNodes = trashNode.children() || [];
        for (const trashedNode of trashedNodes) {
          const deletedFromPath = trashedNode.data.get(deletedFrom) as
            | string
            | undefined;
          if (deletedFromPath) {
            this.deletedFromIndex.add(normalizePath(deletedFromPath));
          }
        }
      }
    }
  }

  private buildCacheFromNode(node: LoroTreeNode, parentPath: string): void {
    const name = node.data.get("name") as string;
    const path = parentPath ? `${parentPath}/${name}` : name;

    // Only cache non-root nodes with actual paths
    if (path && path !== "") {
      this.pathCache.set(path, node.id);
    }

    const children = node.children();
    if (children) {
      for (const child of children) {
        this.buildCacheFromNode(child, path);
      }
    }
  }

  getNodePath(node: LoroTreeNode): string {
    const parts = [];
    let cur = node;
    while (cur) {
      parts.unshift(cur.data.get("name"));
      cur = cur.parent();
    }
    return normalizePath(parts.join("/"));
  }
}
