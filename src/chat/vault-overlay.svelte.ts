import {
  type DataAdapter,
  type DataWriteOptions,
  type EventRef,
  normalizePath,
  TAbstractFile,
  TFile,
  TFolder,
  type Vault,
} from "obsidian";
import { invariant } from "@epic-web/invariant";
import { createDebug } from "$lib/debug.ts";
import {
  LoroDoc,
  LoroText,
  LoroTree,
  type LoroTreeNode,
  type TreeID,
} from "loro-crdt/base64";
import { basename, dirname } from "path-browserify";
import type { CurrentChatFile } from "./chat-serializer.ts";

const debug = createDebug();

const trashPath = ".overlay-trash" as const;
const deletedFrom = "deletedFrom" as const;
const isDirectory = "isDirectory" as const;

const trackingPeerId = 1 as const;
const proposedPeerId = 2 as const;

export type Change = {
  path: string;
  type: "added" | "deleted" | "modified" | "identical";
};

export class VaultOverlay implements Vault {
  trackingDoc: LoroDoc;
  proposedDoc: LoroDoc;
  changes = $state<Change[]>([]);

  constructor(
    private vault: Vault,
    snapshots?: CurrentChatFile["payload"]["overlay"],
  ) {
    if (snapshots) {
      this.trackingDoc = LoroDoc.fromSnapshot(snapshots.tracking);
      this.proposedDoc = LoroDoc.fromSnapshot(snapshots.proposed);
    } else {
      this.trackingDoc = new LoroDoc();
      this.trackingDoc.setPeerId(trackingPeerId);
      // insert root not
      const tree = this.trackingDoc.getTree("vault");
      const root = tree.createNode();
      root.data.set("name", "");
      root.data.set(isDirectory, true);
      // create proposed from snapshot of tracking
      this.proposedDoc = LoroDoc.fromSnapshot(
        this.trackingDoc.export({ mode: "snapshot" }),
      );
      this.proposedDoc.setPeerId(proposedPeerId);
    }
    this.computeChanges();
  }

  getName() {
    return this.vault.getName();
  }

  get configDir() {
    return this.vault.configDir;
  }

  getFileByPath(path: string): TFile {
    path = normalizePath(path);
    debug("getFileByPath", path);
    invariant(!path.endsWith("/"), "File path must not end with a slash");

    const proposedNode = this.findNode("proposed", path);
    if (proposedNode) {
      // If the file is tracked and exists, create a TFile
      return this.createTFile(path);
    }

    const trackingNode = this.findNode("tracking", path);
    if (trackingNode && !proposedNode) {
      return null; // file in overlay but no longer accessible at this path
    }

    // If the file is not tracked, check the vault
    const file = this.vault.getFileByPath(normalizePath(path));
    if (file) {
      file.vault = this as unknown as Vault;
    }
    return file;
  }

  getFolderByPath(path: string): TFolder {
    path = normalizePath(path);
    debug("getFolderByPath", path);

    const proposedNode = this.findNode("proposed", path);
    if (!proposedNode.data.get(isDirectory)) {
      return null;
    }

    if (proposedNode) {
      // If the file is tracked and exists, create a TFolder for it
      return this.createTFolder(path);
    }

    const trackingNode = this.findNode("tracking", path);
    if (trackingNode && !proposedNode) {
      return null; // file in overlay but no longer accessible at this path
    }

    const folder = this.vault.getFolderByPath(normalizePath(path));
    if (folder) {
      folder.vault = this as unknown as Vault;
    }
    return folder;
  }

  getAbstractFileByPath(path: string) {
    path = normalizePath(path);
    debug("getAbstractFileByPath", path);
    const proposedNode = this.findNode("proposed", path);
    if (proposedNode) {
      // If the file is tracked and exists, create a TFolder for it
      return this.createAbstractFile(path);
    }

    const trackingNode = this.findNode("tracking", path);
    if (trackingNode && !proposedNode) {
      return null; // file in overlay but no longer accessible at this path
    }

    const abstractFile = this.vault.getAbstractFileByPath(path);
    if (abstractFile) {
      abstractFile.vault = this as unknown as Vault;
    }
    return abstractFile;
  }

  getRoot() {
    return this.vault.getRoot();
  }

  async create(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    path = normalizePath(path);
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }
    // todo: reject existing case insensitive file name

    // File/Folder must not yet exist.
    const proposedNode = this.findNode("proposed", path);
    if (proposedNode) {
      throw new Error(`File ${path} already exists.`);
    }
    const existsInVault = this.vault.getFileByPath(normalizePath(path));
    invariant(!existsInVault, `File already exists`);

    this.createTextFile("proposed", path, data);
    this.proposedDoc.commit();
    this.computeChanges();

    return this.createTFile(path);
  }

  async createBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    path = normalizePath(path);
    throw new Error("createBinary not supported");
  }

  async createFolder(path: string) {
    path = normalizePath(path);
    invariant(path.endsWith("/"), "Path must be a folder");

    const existing = this.vault.getAbstractFileByPath(normalizePath(path));
    if (existing) {
      throw new Error("File already exists.");
    }

    this.createNode("proposed", path, { isDirectory: true });
    this.proposedDoc.commit();
    this.computeChanges();

    return this.createTFolder(path);
  }

  /**
   *  Read
   */
  async read(file: TFile): Promise<string> {
    const proposedNode = this.findNode("proposed", file.path);
    if (proposedNode) {
      return (proposedNode.data.get("text") as LoroText).toString();
    } else if (this.findNode("tracking", file.path)) {
      // if no proposed and tracking exists, then file has been renamed or deleted
      throw new Error(`File does not exist: ${file.path} `);
    }

    // If not tracked, read from vault
    return this.vault.read(file);
  }

  async cachedRead(file: TFile): Promise<string> {
    throw new Error("cachedRead not supported");
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    throw new Error("readBinary not supported");
  }

  getResourcePath(file: TFile): string {
    throw new Error("getResourcePath not supported");
  }

  /**
   * Cannot delete a file already deleted.
   * Cannot delete a file that does not exist in proposed after sync.
   * If proposed exists, do not try sync
   * If proposed does not exist and tracking does not exist
   *   - try sync if in vault
   *   - throw if not in vault
   * If after sync proposed does not exist then return.
   */
  async delete(file: TAbstractFile): Promise<void> {
    // If the file is already deleted, nothing to do
    const deleted = this.findDeletedNode(file.path);
    if (deleted) {
      return;
    }

    let proposedNode = this.findNode("proposed", file.path);
    let trackingNode = this.findNode("tracking", file.path);
    if (!proposedNode && !trackingNode) {
      const abstractFile = this.vault.getFileByPath(normalizePath(file.path));
      if (!abstractFile) {
        invariant(abstractFile, `Cannot delete file not found: ${file.path}`);
      }
      await this.syncPath(file.path);
    }

    proposedNode = this.findNode("proposed", file.path);
    invariant(proposedNode, `Cannot delete file not found: ${file.path} `);

    const trashFolder = this.createNode("proposed", trashPath, {
      isDirectory: true,
    });
    proposedNode.move(trashFolder);
    proposedNode.data.set(deletedFrom, normalizePath(file.path));
    this.proposedDoc.commit();
    this.computeChanges();
  }

  async trash(file: TAbstractFile): Promise<void> {
    throw new Error("trash not supported");
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    newPath = normalizePath(newPath);
    // todo: test renaming a file and a folder
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (newPath.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    const destProposedNode = this.findNode("proposed", newPath);
    if (destProposedNode) {
      throw new Error(`Cannot rename to path that already exists: ${newPath}`);
    }

    const deletedNode = this.findDeletedNode(file.path);
    if (deletedNode) {
      throw new Error(`Cannot rename file that was deleted: ${file.path}`);
    }

    // Check if new path exists in vault
    const newPathTracking = this.findNode("tracking", newPath);
    const newPathExists = this.vault.getFileByPath(newPath);
    if (!newPathTracking && newPathExists) {
      throw new Error(`Cannot rename to path that already exists: ${newPath}`);
    }

    // Check if the file is tracked
    let trackingNode = this.findNode("tracking", file.path);
    // Import if the file exists in the vault, but not in overlay
    if (!trackingNode && !this.findNode("proposed", file.path)) {
      const vaultFile = this.vault.getFileByPath(normalizePath(file.path));
      invariant(
        vaultFile,
        `Cannot rename file not found in vault: ${file.path}`,
      );
      await this.syncPath(file.path);
    }

    const proposedNode = this.findNode("proposed", file.path);
    invariant(
      proposedNode,
      `Cannot rename file not found after sync: ${file.path}`,
    );
    // todo: verify dirname gets parent/root
    let newParent = this.findNode("proposed", dirname(newPath));
    if (!newParent) {
      newParent = this.createNode("proposed", dirname(newPath), {
        isDirectory: true,
      });
    }

    // todo: test renaming a file and a folder
    const newName = basename(newPath);
    proposedNode.data.set("name", newName);
    if (proposedNode.parent().id !== newParent.id) {
      proposedNode.move(newParent);
    }
    this.proposedDoc.commit();
    this.computeChanges();
  }

  async modify(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    const trackingNode = this.findNode("tracking", file.path);
    const existsInVault = this.vault.getFileByPath(normalizePath(file.path));

    if (!trackingNode && existsInVault) {
      await this.syncPath(file.path);
    }
    let node = this.findNode("proposed", file.path);
    if (!node) {
      node = this.createTextFile("proposed", file.path, data);
    }
    const text = node.data.get("text") as LoroText;
    // Loro recommends updateByLine for texts > 50_000 characters).
    if (data.length > 50_000) {
      text.updateByLine(data);
    } else {
      text.update(data);
    }
    // todo: test modifying a file in a path that was deleted
    this.proposedDoc.commit();
    this.computeChanges();
  }

  async modifyBinary(
    file: TFile,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    throw new Error("modifyBinary not supported");
  }

  async append(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    throw new Error("append not supported");
  }

  async process(
    file: TFile,
    fn: (data: string) => string,
    options?: DataWriteOptions,
  ): Promise<string> {
    throw new Error("process not supported");
  }

  async copy<T extends TAbstractFile>(file: T, newPath: string): Promise<T> {
    throw new Error("copy not supported");
  }

  getAllLoadedFiles(): TAbstractFile[] {
    throw new Error("getAllLoadedFiles not supported");
  }

  getAllFolders(includeRoot?: boolean): TFolder[] {
    throw new Error("getAllFolders not supported");
  }

  getMarkdownFiles(): TFile[] {
    throw new Error("getMarkdownFiles not supported");
  }

  getFiles(): TFile[] {
    throw new Error("getFiles not supported");
  }

  on(
    name: "create" | "modify" | "delete" | "rename",
    callback: (...args: any[]) => any,
    ctx?: any,
  ): EventRef {
    throw new Error("on not supported");
  }

  private createTFolder(path: string): TFolder {
    path = normalizePath(path);
    const abstractFile = this.createAbstractFile(path);
    // todo: implement children
    return { ...abstractFile, children: [], isRoot: () => path === "/" };
  }

  private createTFile(path: string): TFile {
    path = normalizePath(path);
    const abstractFile = this.createAbstractFile(path);

    const lastSlash = path.lastIndexOf("/");
    const name = lastSlash === -1 ? path : path.substring(lastSlash + 1);
    const extension = name.includes(".")
      ? name.substring(name.lastIndexOf(".") + 1)
      : "";
    const basename = name.includes(".")
      ? name.substring(0, name.lastIndexOf("."))
      : name;

    return {
      ...abstractFile,
      basename,
      extension,
      // todo: decide how/if stat should be implemented
      stat: {} as any,
      // stat: { ...stat, mtime: stat.mtimeMs, ctime: stat.ctimeMs },
    };
  }

  private createAbstractFile(path: string): TAbstractFile {
    path = normalizePath(path);
    let parentPath = dirname(path);
    if (!parentPath.endsWith("/")) {
      parentPath += "/";
    }

    const name = path.endsWith("/")
      ? basename(path.substring(0, path.length - 1))
      : basename(path);

    const parent =
      parentPath === "./" ? this.getRoot() : this.getFolderByPath(parentPath);

    return {
      vault: this as unknown as Vault,
      path,
      name,
      parent,
    } as TAbstractFile;
  }

  get adapter(): DataAdapter {
    throw new Error("access to adapter not supported.");
  }

  off(name: string, callback: (...data: unknown[]) => unknown): void {
    throw new Error("off not supported.");
  }

  offref(ref: EventRef): void {
    throw new Error("offref not support.");
  }

  trigger(name: string, ...data: unknown[]): void {
    throw new Error("trigger not support.");
  }

  tryTrigger(evt: EventRef, args: unknown[]): void {
    throw new Error("tryTrigger not support.");
  }

  /**
   * Sync path from disk and sync (LoroText merge) with proposed.
   */
  async syncPath(path: string): Promise<void> {
    path = normalizePath(path);
    // Try to get the abstractFile from the vault
    debug("Sync path", path);
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));
    invariant(abstractFile, `${path} not found in vault`);

    const node = this.findNode("tracking", path);
    if (abstractFile instanceof TFile) {
      const contents = await this.vault.read(abstractFile);
      if (node) {
        invariant(
          node.data.get(isDirectory) === false,
          `Expected node for ${path} to be a file, got folder.`,
        );
        const txtC = node.data.get("text") as LoroText;
        // Loro recommends updateByLine for texts > 50_000 characters
        if (contents.length > 50_000) {
          txtC.updateByLine(contents);
        } else {
          txtC.update(contents);
        }
      } else {
        this.createTextFile("tracking", path, contents);
      }
    } else if (abstractFile instanceof TFolder) {
      invariant(
        node.data.get(isDirectory) === true,
        `Expected node for ${path} to be a folder, got file.`,
      );
      if (!node) {
        this.createNode("tracking", path, { isDirectory: true });
      }
    } else {
      throw new Error(`${path} is not a file or folder`);
    }
    this.trackingDoc.commit();
    this.syncDocs();
  }

  async syncDelete(path: string): Promise<void> {
    path = normalizePath(path);
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));
    invariant(abstractFile, `${path} not found in vault`);
    const node = this.findNode("tracking", path);
    if (node) {
      this.trackingDoc.getTree("vault").delete(node.id);
      this.trackingDoc.commit();
    }
    this.syncDocs();
  }

  /**
   * An approved change replaces proposed (last write wins), not merge (default LoroText behavior).
   */
  approveModify(path: string, contents?: string) {
    path = normalizePath(path);
    // Try to get the abstractFile from the vault
    debug("Force update", path);
    let proposedNode = this.findNode("proposed", path);
    invariant(
      proposedNode,
      `Cannot approve modify to path not found in proposed: ${path}.`,
    );
    invariant(
      proposedNode.data.get(isDirectory) != contents,
      `Cannot approve modify to folder when contents are provided: ${path}`,
    );
    let trackingNode = this.findNode("tracking", path);
    if (!trackingNode) {
      if (proposedNode.data.get(isDirectory) === true) {
        this.createNode("tracking", path, { isDirectory: true });
      } else {
        this.createTextFile("tracking", path, contents);
      }
    } else if (!trackingNode.data.get(isDirectory)) {
      // recreate text container for last-write-wins not merge semantics
      trackingNode.data.delete("text");
      const txtC = trackingNode.data.setContainer("text", new LoroText());
      txtC.insert(0, contents);
      this.trackingDoc.commit();
    }

    this.syncDocs();
  }

  approveDelete(path: string) {
    path = normalizePath(path);
    const trackingNode = this.findNode("tracking", path);
    const proposedNode = this.findNodeById("proposed", trackingNode.id);
    invariant(
      proposedNode,
      `Cannot approve delete to path not found in proposed: ${path}.`,
    );
    invariant(
      proposedNode.data.get(deletedFrom),
      `Cannot approve delete to a path not deleted on proposed: ${path}.`,
    );
    this.trackingDoc.getTree("vault").delete(trackingNode.id);
    this.trackingDoc.commit();
    this.syncDocs();
  }

  approveRename(oldPath: string, newPath: string) {
    oldPath = normalizePath(oldPath);
    newPath = normalizePath(newPath);
    const trackingNode = this.findNode("tracking", oldPath);
    invariant(
      trackingNode,
      `Cannot approve rename from path not found in tracking: ${oldPath}.`,
    );
    const proposedNode = this.findNode("proposed", newPath);
    invariant(
      proposedNode,
      `Cannot approve rename to path not found in proposed: ${newPath}.`,
    );
    invariant(
      trackingNode.id === proposedNode.id,
      "Cannot approve rename; new path not tracked to old path.",
    );
    // todo apply rename to vault
    // move tracking node to same location as proposed node
    let trackingFolder = this.findNode("tracking", dirname(newPath));
    if (!trackingFolder) {
      trackingFolder = this.createNode("tracking", dirname(newPath), {
        isDirectory: true,
      });
    }
    if (trackingNode.parent().id !== trackingFolder.id) {
      trackingNode.move(trackingFolder);
    }
    trackingNode.data.set("name", basename(newPath));
    this.trackingDoc.commit();
    this.syncDocs();
  }

  syncDocs() {
    this.proposedDoc.import(
      this.trackingDoc.export({
        mode: "update",
        from: this.proposedDoc.version(),
      }),
    );
    this.computeChanges();
  }

  syncVault() {
    // todo implement
    throw new Error("syncVault not supported");
  }

  computeChanges() {
    this.changes = this.getFileChanges();
  }

  getFileChanges(): Change[] {
    const trackingTree = this.trackingDoc.getTree("vault");

    const nodes: Record<
      TreeID,
      { mNode: LoroTreeNode | undefined; sNode: LoroTreeNode }
    > = {};
    const trackingNodes = trackingTree.getNodes();
    for (const mNode of trackingNodes) {
      nodes[mNode.id] = {
        mNode,
        sNode: this.findNodeById("proposed", mNode.id),
      };
    }
    const proposedNodes = this.proposedDoc.getTree("vault").getNodes();
    for (const sNode of proposedNodes) {
      if (!(sNode.id in nodes)) {
        nodes[sNode.id] = { mNode: undefined, sNode };
      }
    }

    const changes: Change[] = [];

    for (const [id, { mNode, sNode }] of Object.entries(nodes)) {
      let type: Change["type"];

      // omit if root
      if (!sNode.parent()) {
        continue;
      }
      if (sNode?.data.get("name") === trashPath) {
        continue;
      }

      const path = this.getNodePath(sNode);

      if (!mNode && sNode) {
        changes.push({ path, type: "added" });
      } else if (mNode && sNode?.data.get(deletedFrom)) {
        changes.push({
          path: sNode.data.get(deletedFrom) as string,
          type: "deleted",
        });
      } else if (mNode && sNode) {
        if (mNode.data.get("name") !== sNode.data.get("name")) {
          changes.push({ path, type: "modified" });
          continue;
        } else if (mNode.parent()?.id !== sNode.parent()?.id) {
          changes.push({ path, type: "modified" });
          continue;
        }

        const mText =
          (mNode.data.get("text") as LoroText | undefined)?.toString() ?? "";
        const sText =
          (sNode.data.get("text") as LoroText | undefined)?.toString() ?? "";
        type = mText === sText ? "identical" : "modified";
        changes.push({ path, type });
      }
    }

    return changes.filter((c) => c.type !== "identical");
  }

  createNode(
    branch: "tracking" | "proposed",
    path: string,
    data: { isDirectory?: boolean; text?: string },
  ) {
    path = normalizePath(path);
    const doc = branch === "tracking" ? this.trackingDoc : this.proposedDoc;
    const tree = doc.getTree("vault");
    const root = tree.roots()[0];
    const parts = path.split("/").filter((part) => part.length > 0);
    let parent = root;
    for (const [idx, part] of parts.entries()) {
      const isLeaf = idx === parts.length - 1;
      const children = parent.children();
      let node = children?.find((n) => n.data.get("name") === part);
      if (node && isLeaf) {
        throw Error(`Node already exists: ${path}`);
      }
      if (isLeaf) {
        const c = parent.createNode();
        c.data.set("name", part);
        c.data.set(isDirectory, data.isDirectory);
        if (data.text) {
          c.data.setContainer("text", new LoroText());
          (c.data.get("text") as LoroText).insert(0, data.text);
        }
        return c;
      }
      if (!node) {
        node = parent.createNode();
        node.data.set("name", part);
        node.data.set(isDirectory, true);
      }
      parent = node;
    }
    return parent;
  }

  createTextFile(branch: "tracking" | "proposed", path: string, text: string) {
    path = normalizePath(path);
    return this.createNode(branch, path, {
      isDirectory: false,
      text,
    });
  }

  findNode(
    branch: "tracking" | "proposed",
    path: string,
  ): LoroTreeNode | undefined {
    path = normalizePath(path);
    const doc = branch === "tracking" ? this.trackingDoc : this.proposedDoc;
    const tree = doc.getTree("vault");
    if (path === "." || path === "/" || path === "" || path === "./") {
      return tree.roots()[0];
    }
    const parts = path.split("/");
    let cur: LoroTreeNode | undefined = tree.roots()[0];
    for (const part of parts) {
      if (!part) continue; // Skip empty parts (e.g., from leading/trailing slashes)
      cur = cur?.children()?.find((n) => n.data.get("name") === part);
      if (!cur) break;
    }
    return cur;
  }

  findNodeById(branch: "proposed" | "tracking", id: TreeID) {
    const doc = branch === "tracking" ? this.trackingDoc : this.proposedDoc;
    const tree = doc.getTree("vault");
    return tree.getNodeByID(id);
  }

  findDeletedNode(path: string): LoroTreeNode | undefined {
    path = normalizePath(path);
    const trashRoot = this.findNode("proposed", trashPath);
    if (!trashRoot) {
      return undefined;
    }

    // walk just this subtree; tomb-stones are direct children
    return trashRoot.children()?.find((n) => n.data.get(deletedFrom) === path);
  }

  getNodePath(node: LoroTreeNode) {
    const parts = [];
    let cur = node;
    while (cur) {
      parts.unshift(cur.data.get("name"));
      cur = cur.parent();
    }
    return normalizePath(parts.join("/"));
  }

  snapshot() {
    return {
      tracking: this.trackingDoc.export({ mode: "snapshot" }),
      proposed: this.proposedDoc.export({ mode: "snapshot" }),
    };
  }

  async destroy() {}
}
