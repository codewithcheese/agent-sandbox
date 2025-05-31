import { normalizePath } from "obsidian";
import {
  type LoroTree,
  type LoroTreeNode,
  type TreeID,
  LoroText,
  type LoroDoc,
} from "loro-crdt/base64";
import { invariant } from "@epic-web/invariant";
import { basename, dirname } from "path-browserify";
import type { Tree } from "@lezer/common";

const trashPath = ".overlay-trash" as const;

export class TreeFS {
  private pathCache = new Map<string, TreeID>();
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

  createNode(
    path: string,
    data: { isDirectory?: boolean; text?: string },
  ): LoroTreeNode {
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
    data: { isDirectory?: boolean; text?: string },
  ) {
    const c = parent.createNode();
    c.data.set("name", basename(path));
    if (data.isDirectory) {
      c.data.set("isDirectory", data.isDirectory);
    }
    if (data.text) {
      c.data.setContainer("text", new LoroText());
      (c.data.get("text") as LoroText).insert(0, data.text);
    }
    this.pathCache.set(path, c.id);
    return c;
  }

  moveNode(node: LoroTreeNode, parentId: TreeID): void {
    const newParent = this.findById(parentId);
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
    const path = this.getNodePath(node);
    this.pathCache.delete(path);
    this.tree.delete(nodeId);
  }

  renameNode(nodeId: TreeID, newName: string): void {
    const node = this.tree.getNodeByID(nodeId);
    invariant(node, `Cannot renamed node. Node not found: ${nodeId}`);
    node.data.set("name", basename(newName));
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

  findDeleted(path: string): LoroTreeNode | undefined {
    path = normalizePath(path);
    const trashRoot = this.findByPath(trashPath);
    invariant(trashRoot, `Trash root not found: ${trashPath}`);

    // walk just this subtree; tomb-stones are direct children
    return trashRoot
      .children()
      ?.find((n) => n.data.get("deletedFrom") === path);
  }

  invalidateCache(): void {
    this.cacheValid = false;
  }

  private rebuildCache(): void {
    this.pathCache.clear();
    const root = this.tree.roots()[0];
    if (root) {
      this.buildCacheFromNode(root, "");
    }
    this.cacheValid = true;
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
