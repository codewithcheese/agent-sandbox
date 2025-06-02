import { type FileStats, normalizePath, type TAbstractFile } from "obsidian";
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
import { encodeBase64 } from "$lib/utils/base64.ts";

const trashPath = ".overlay-trash" as const;
const deletedFrom = "deletedFrom" as const;

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

  createNode(
    path: string,
    data: {
      isDirectory?: boolean;
      text?: string;
      buffer?: ArrayBuffer;
      stat?: FileStats;
    },
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
    c.data.set("name", basename(path));
    if (data.isDirectory) {
      c.data.set("isDirectory", data.isDirectory);
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

  trashNode(node: LoroTreeNode, originalPath: string): void {
    const trashFolder = this.findByPath(trashPath);
    invariant(trashFolder, `Trash folder not found: ${trashPath}`);

    node.move(trashFolder);
    node.data.set(deletedFrom, normalizePath(originalPath));

    // Incrementally update the deletion index
    this.pathCache.delete(originalPath);
    this.deletedFromIndex.add(normalizePath(originalPath));
  }

  restoreNode(
    node: LoroTreeNode,
    newParent: LoroTreeNode,
    newData: { text?: string; buffer?: ArrayBuffer; stat?: FileStats },
  ): void {
    const originalPath = node.data.get(deletedFrom) as string | undefined;

    // Move back from trash to new parent
    node.move(newParent);
    node.data.delete(deletedFrom);

    // Overwrite with new content
    if (newData.text != null) {
      const text = node.data.get("text") as LoroText;
      if (text) {
        text.update(newData.text);
      } else {
        node.data.setContainer("text", new LoroText());
        (node.data.get("text") as LoroText).insert(0, newData.text);
      }
    }
    if (newData.buffer != null) {
      node.data.set("buffer", encodeBase64(newData.buffer));
    }
    if (newData.stat) {
      node.data.set("stat", newData.stat);
    }

    // Remove from deletion index and update path cache
    if (originalPath) {
      this.deletedFromIndex.delete(normalizePath(originalPath));
    }
    this.pathCache.set(normalizePath(originalPath), node.id);
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
