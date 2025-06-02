import {
  type DataAdapter,
  type DataWriteOptions,
  type EventRef,
  type FileStats,
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
  type LoroTreeNode,
  type TreeID,
} from "loro-crdt/base64";
import { basename, dirname } from "path-browserify";
import type { CurrentChatFile } from "./chat-serializer.ts";
import { TreeFS } from "./tree-fs.ts";
import { buffer, text } from "$lib/utils/loro.ts";

const debug = createDebug();

const trashPath = ".overlay-trash" as const;
const deletedFrom = "deletedFrom" as const;
const isDirectory = "isDirectory" as const;

const trackingPeerId = 1 as const;
const proposedPeerId = 2 as const;

export type PathChange = {
  id: TreeID;
  path: string;
  type: "added" | "deleted" | "modified" | "identical";
};

export class VaultOverlay implements Vault {
  trackingDoc: LoroDoc;
  proposedDoc: LoroDoc;
  changes = $state<PathChange[]>([]);
  trackingFS: TreeFS;
  proposedFS: TreeFS;

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
      const trash = root.createNode();
      trash.data.set("name", trashPath);
      trash.data.set(isDirectory, true);
      // create proposed from snapshot of tracking
      this.proposedDoc = LoroDoc.fromSnapshot(
        this.trackingDoc.export({ mode: "snapshot" }),
      );
      this.proposedDoc.setPeerId(proposedPeerId);
    }
    this.trackingFS = new TreeFS(this.trackingDoc);
    this.proposedFS = new TreeFS(this.proposedDoc);
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

    const proposedNode = this.proposedFS.findByPath(path);
    if (proposedNode) {
      // If the file is tracked and exists, create a TFile
      return this.createTFile(path, proposedNode.data.get("stat") as FileStats);
    }

    const trackingNode = this.trackingFS.findByPath(path);
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

    const proposedNode = this.proposedFS.findByPath(path);
    if (proposedNode && !proposedNode.data.get(isDirectory)) {
      return null;
    }

    if (proposedNode) {
      // If the file is tracked and exists, create a TFolder for it
      return this.createTFolder(path);
    }

    const trackingNode = this.trackingFS.findByPath(path);
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
    const proposedNode = this.proposedFS.findByPath(path);
    if (proposedNode) {
      // if the file is tracked and exists
      return this.createAbstractFile(
        path,
        proposedNode.data.get(isDirectory) === true,
      );
    }

    const trackingNode = this.trackingFS.findByPath(path);
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

    const stat: FileStats = {
      size: data.length,
      mtime: Date.now(),
      ctime: Date.now(),
      ...(options ?? {}),
    };

    // Check if file was deleted - if so, restore it with new content
    const deletedNode = this.proposedFS.findDeleted(path);
    if (deletedNode) {
      const parentNode = this.proposedFS.findByPath(dirname(path)) || this.proposedFS.findByPath("/");
      invariant(parentNode, `Parent folder not found for path: ${path}`);
      
      this.proposedFS.restoreNode(deletedNode, parentNode, { text: data, stat });
      this.proposedDoc.commit();
      return this.createTFile(path, stat);
    }

    // File/Folder must not yet exist.
    const proposedNode = this.proposedFS.findByPath(path);
    if (proposedNode) {
      throw new Error(`File ${path} already exists.`);
    }
    const existsInVault = this.vault.getFileByPath(normalizePath(path));
    invariant(!existsInVault, `File already exists`);

    this.proposedFS.createNode(path, { text: data, stat });
    this.proposedDoc.commit();

    return this.createTFile(path, stat);
  }

  async createBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    path = normalizePath(path);
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }
    // todo: reject existing case insensitive file name

    // File/Folder must not yet exist.
    const proposedNode = this.proposedFS.findByPath(path);
    if (proposedNode) {
      throw new Error(`File ${path} already exists.`);
    }
    const existsInVault = this.vault.getFileByPath(normalizePath(path));
    invariant(!existsInVault, `File already exists`);

    const stat: FileStats = {
      size: data.byteLength,
      mtime: Date.now(),
      ctime: Date.now(),
      ...(options ?? {}),
    };

    this.proposedFS.createNode(path, { buffer: data, stat });
    this.proposedDoc.commit();

    return this.createTFile(path, stat);
  }

  async createFolder(path: string) {
    path = normalizePath(path);

    const existing = this.vault.getAbstractFileByPath(normalizePath(path));
    if (existing) {
      throw new Error("File already exists.");
    }

    this.proposedFS.createNode(path, { isDirectory: true });
    this.proposedDoc.commit();
    this.computeChanges();

    return this.createTFolder(path);
  }

  /**
   *  Read
   */
  async read(file: TFile): Promise<string> {
    const proposedNode = this.proposedFS.findByPath(file.path);

    if (proposedNode && proposedNode.data.get(deletedFrom)) {
      throw new Error(`File was deleted: ${file.path} `);
    } else if (proposedNode) {
      return (proposedNode.data.get("text") as LoroText).toString();
    } else if (this.trackingFS.findByPath(file.path)) {
      // if no proposed and tracking exists, then file has been renamed or deleted
      throw new Error(`File does not exist: ${file.path} `);
    }

    // If not tracked, read from vault
    return this.vault.read(file);
  }

  async cachedRead(_file: TFile): Promise<string> {
    throw new Error("cachedRead not supported");
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const proposedNode = this.proposedFS.findByPath(file.path);

    if (proposedNode && proposedNode.data.get(deletedFrom)) {
      throw new Error(`File was deleted: ${file.path} `);
    } else if (proposedNode && proposedNode.data.get("buffer") === undefined) {
      throw Error(`Cannot read file as binary, buffer not found: ${file.path}`);
    } else if (proposedNode) {
      return buffer(proposedNode);
    } else if (this.trackingFS.findByPath(file.path)) {
      // if no proposed and tracking exists, then file has been renamed or deleted
      throw new Error(`File does not exist: ${file.path} `);
    }

    // If not tracked, read from vault
    return this.vault.readBinary(file);
  }

  getResourcePath(_file: TFile): string {
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
    const deleted = this.proposedFS.findDeleted(file.path);
    if (deleted) {
      return;
    }

    let proposedNode = this.proposedFS.findByPath(file.path);
    let trackingNode = this.trackingFS.findByPath(file.path);
    if (!proposedNode && !trackingNode) {
      const abstractFile = this.vault.getAbstractFileByPath(
        normalizePath(file.path),
      );
      if (!abstractFile) {
        invariant(abstractFile, `Cannot delete file not found: ${file.path}`);
      }
      await this.syncPath(file.path);
    }

    proposedNode = this.proposedFS.findByPath(file.path);
    invariant(proposedNode, `Cannot delete file not found: ${file.path} `);

    this.proposedFS.trashNode(proposedNode, file.path);
    this.proposedDoc.commit();
    this.computeChanges();
  }

  async trash(_file: TAbstractFile): Promise<void> {
    throw new Error("trash not supported");
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    newPath = normalizePath(newPath);
    // todo: test renaming a file and a folder
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (newPath.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    const destProposedNode = this.proposedFS.findByPath(newPath);
    if (destProposedNode) {
      throw new Error(`Cannot rename to path that already exists: ${newPath}`);
    }

    const deletedNode = this.proposedFS.findDeleted(file.path);
    if (deletedNode) {
      throw new Error(`Cannot rename file that was deleted: ${file.path}`);
    }

    // Check if new path exists in vault
    const newPathTracking = this.trackingFS.findByPath(newPath);
    const newPathExists = this.vault.getFileByPath(newPath);
    if (!newPathTracking && newPathExists) {
      throw new Error(`Cannot rename to path that already exists: ${newPath}`);
    }

    // Check if the file is tracked
    let trackingNode = this.trackingFS.findByPath(file.path);
    // Import if the file exists in the vault, but not in overlay
    if (!trackingNode && !this.proposedFS.findByPath(file.path)) {
      const vaultFile = this.vault.getFileByPath(normalizePath(file.path));
      invariant(
        vaultFile,
        `Cannot rename file not found in vault: ${file.path}`,
      );
      await this.syncPath(file.path);
    }

    const proposedNode = this.proposedFS.findByPath(file.path);
    invariant(
      proposedNode,
      `Cannot rename file not found after sync: ${file.path}`,
    );
    // todo: verify dirname gets parent/root
    let newParent = this.proposedFS.findByPath(dirname(newPath));
    if (!newParent) {
      newParent = this.proposedFS.createNode(dirname(newPath), {
        isDirectory: true,
      });
    }

    // Update cache
    this.proposedFS.updateNodePath(file.path, newPath, proposedNode.id);

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
    const trackingNode = this.trackingFS.findByPath(file.path);
    const existsInVault = this.vault.getFileByPath(normalizePath(file.path));

    if (!trackingNode && existsInVault) {
      await this.syncPath(file.path);
    }
    let node = this.proposedFS.findByPath(file.path);
    if (!node) {
      const stat: FileStats = {
        size: data.length,
        mtime: Date.now(),
        ctime: Date.now(),
        ...(options ?? {}),
      };
      this.proposedFS.createNode(file.path, { text: data, stat });
    } else {
      const text = node.data.get("text") as LoroText;
      // Loro recommends updateByLine for texts > 50_000 characters).
      if (data.length > 50_000) {
        text.updateByLine(data);
      } else {
        text.update(data);
      }
    }
    // todo: test modifying a file in a path that was deleted
    this.proposedDoc.commit();
    // this.computeChanges();
  }

  async modifyBinary(
    _file: TFile,
    _data: ArrayBuffer,
    _options?: DataWriteOptions,
  ): Promise<void> {
    throw new Error("modifyBinary not supported");
  }

  async append(
    _file: TFile,
    _data: string,
    _options?: DataWriteOptions,
  ): Promise<void> {
    throw new Error("append not supported");
  }

  async process(
    _file: TFile,
    _fn: (data: string) => string,
    _options?: DataWriteOptions,
  ): Promise<string> {
    throw new Error("process not supported");
  }

  async copy<T extends TAbstractFile>(_file: T, _newPath: string): Promise<T> {
    throw new Error("copy not supported");
  }

  getAllLoadedFiles(): TAbstractFile[] {
    throw new Error("getAllLoadedFiles not supported");
  }

  getAllFolders(_includeRoot?: boolean): TFolder[] {
    throw new Error("getAllFolders not supported");
  }

  getMarkdownFiles(): TFile[] {
    throw new Error("getMarkdownFiles not supported");
  }

  getFiles(): TFile[] {
    throw new Error("getFiles not supported");
  }

  on(
    _name: "create" | "modify" | "delete" | "rename",
    _callback: (...args: any[]) => any,
    _ctx?: any,
  ): EventRef {
    throw new Error("on not supported");
  }

  private createTFolder(path: string): TFolder {
    path = normalizePath(path);
    const abstractFile = this.createAbstractFile(path, true);

    const folderNode = this.proposedFS.findByPath(path);
    invariant(
      folderNode.data.get(isDirectory),
      `Failed to create TFolder path is not a directory: ${path}`,
    );

    const folder = Object.assign(
      Object.create(TFolder.prototype),
      abstractFile,
      {
        isRoot: () => path === "/",
      },
    );

    Object.defineProperty(folder, "children", {
      get: () => {
        const children: TAbstractFile[] = [];
        const seenPaths = new Set<string>();

        // First, add overlay nodes (excluding deleted/trash)
        if (folderNode) {
          const childNodes = folderNode.children() || [];
          for (const childNode of childNodes) {
            if (
              childNode.data.get(deletedFrom) ||
              childNode.data.get("name") === trashPath
            ) {
              continue;
            }

            const trackingNode = this.trackingFS.findById(childNode.id);
            // If file was synced (not created in overlay), mark tracking path as seen
            // If file was not synced (created in overlay), mark proposed path as seen
            const childPath = this.proposedFS.getNodePath(childNode);
            seenPaths.add(
              trackingNode
                ? this.trackingFS.getNodePath(trackingNode)
                : childPath,
            );

            const isDir = childNode.data.get(isDirectory);
            if (isDir) {
              children.push(this.createTFolder(childPath));
            } else {
              children.push(
                this.createTFile(
                  childPath,
                  childNode.data.get("stat") as FileStats,
                ),
              );
            }
          }
        }

        // Then, add vault files not already in overlay
        const vaultFolder = this.vault.getFolderByPath(path);
        if (vaultFolder) {
          for (const child of vaultFolder.children) {
            if (
              !seenPaths.has(child.path) &&
              !this.proposedFS.isDeleted(child.path)
            ) {
              child.vault = this as unknown as Vault; // Pass-through pattern
              children.push(child);
            }
          }
        }

        return children;
      },
      enumerable: true,
      configurable: true,
    });

    return folder;
  }

  private createTFile(path: string, stat: FileStats): TFile {
    path = normalizePath(path);
    const abstractFile = this.createAbstractFile(path, false);

    const lastSlash = path.lastIndexOf("/");
    const name = lastSlash === -1 ? path : path.substring(lastSlash + 1);
    const extension = name.includes(".")
      ? name.substring(name.lastIndexOf(".") + 1)
      : "";
    const basename = name.includes(".")
      ? name.substring(0, name.lastIndexOf("."))
      : name;

    return Object.assign(Object.create(TFile.prototype), abstractFile, {
      basename,
      extension,
      stat,
    });
  }

  private createAbstractFile(
    path: string,
    isDirectory: boolean,
  ): TAbstractFile {
    path = normalizePath(path);
    let parentPath = dirname(path);
    if (parentPath === ".") {
      parentPath = "/";
    }
    const name = basename(path) || "/";

    // parent null if path is root
    const parent = parentPath === "/" ? null : this.getFolderByPath(parentPath);

    return Object.assign(
      Object.create(isDirectory ? TFolder.prototype : TFile.prototype),
      {
        vault: this as unknown as Vault,
        path: path || "/",
        name,
        parent,
      },
    );
  }

  get adapter(): DataAdapter {
    throw new Error("access to adapter not supported.");
  }

  off(_name: string, _callback: (...data: unknown[]) => unknown): void {
    throw new Error("off not supported.");
  }

  offref(_ref: EventRef): void {
    throw new Error("offref not support.");
  }

  trigger(_name: string, ..._data: unknown[]): void {
    throw new Error("trigger not support.");
  }

  tryTrigger(_evt: EventRef, _args: unknown[]): void {
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

    const node = this.trackingFS.findByPath(path);
    if (abstractFile instanceof TFile) {
      const contents = await this.vault.read(abstractFile);
      if (node) {
        invariant(
          node.data.get(isDirectory) !== true,
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
        this.trackingFS.createNode(path, {
          text: contents,
          stat: abstractFile.stat,
        });
      }
    } else if (abstractFile instanceof TFolder) {
      if (!node) {
        this.trackingFS.createNode(path, {
          isDirectory: true,
        });
      } else if (node.data.get(isDirectory) === false) {
        throw new Error(
          `Path is folder in vault, but not in tracking: ${path}`,
        );
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
    const node = this.trackingFS.findByPath(path);
    if (node) {
      this.trackingFS.deleteNode(node.id);
      this.trackingDoc.commit();
      this.syncDocs();
    }
  }

  approve(approvals: { id: TreeID; contents?: string }[]) {
    type ApprovalOp =
      | { type: "create"; id: TreeID; contents: string }
      | { type: "modify"; id: TreeID; contents: string }
      | { type: "delete"; id: TreeID }
      | { type: "rename"; id: TreeID }
      | { type: "move"; id: TreeID; parentId: TreeID };

    const ops: ApprovalOp[] = [];
    for (const approval of approvals) {
      const proposedNode = this.proposedFS.findById(approval.id);
      const trackingNode = this.trackingFS.findById(approval.id);
      invariant(
        proposedNode,
        `Proposed node not found for approval: ${approval.id}`,
      );
      const proposedPath = this.proposedFS.getNodePath(proposedNode);
      const trackingPath = this.trackingFS.getNodePath(trackingNode);
      const deletedPath = proposedNode.data.get(deletedFrom);

      if (approval.contents && proposedNode.data.get("isDirectory")) {
        throw Error(
          `Cannot approve new contents on directory: ${this.proposedFS.getNodePath(proposedNode)}`,
        );
      }

      if (!deletedPath && !trackingNode) {
        ops.push({
          id: proposedNode.id,
          type: "create",
          contents: approval.contents,
        });
      }

      if (deletedPath != null) {
        ops.push({
          id: proposedNode.id,
          type: "delete",
        });
      } else if (trackingNode) {
        // if path has changed
        if (proposedPath !== trackingPath) {
          ops.push({
            id: proposedNode.id,
            type: "rename",
          });
        }

        // if parent has changed
        if (proposedNode.parent()?.id !== trackingNode.parent()?.id) {
          ops.push({
            id: proposedNode.id,
            type: "move",
            parentId: proposedNode.parent().id,
          });
        }

        // if not directory and text changed
        if (
          !proposedNode.data.get(isDirectory) &&
          (text(proposedNode) !== text(trackingNode) ||
            (approval.contents && approval.contents !== text(trackingNode)))
        ) {
          ops.push({
            id: proposedNode.id,
            type: "modify",
            contents: approval?.contents || text(proposedNode),
          });
        }
      }
    }

    for (const op of ops) {
      const proposedNode = this.proposedFS.findById(op.id);
      const trackingNode = this.trackingFS.findById(op.id);
      const proposedPath = this.proposedFS.getNodePath(proposedNode);
      if (op.type === "create") {
        this.trackingFS.createNode(proposedPath, {
          isDirectory: proposedNode.data.get(isDirectory) as
            | boolean
            | undefined,
          text: op.contents ?? text(proposedNode),
          buffer: buffer(proposedNode),
        });
      } else if (op.type === "delete") {
        this.trackingFS.deleteNode(trackingNode.id);
      } else if (op.type === "rename") {
        this.trackingFS.renameNode(trackingNode.id, proposedPath);
      } else if (op.type === "move") {
        this.trackingFS.moveNode(trackingNode, op.parentId);
      } else if (op.type === "modify") {
        // recreate text container for last-write-wins not merge semantics
        trackingNode.data.delete("text");
        const txtC = trackingNode.data.setContainer("text", new LoroText());
        txtC.insert(0, op.contents ?? text(proposedNode));
      }
    }

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
    this.proposedFS.invalidateCache();
    this.computeChanges();
  }

  syncVault() {
    // todo implement
    throw new Error("syncVault not supported");
  }

  computeChanges() {
    this.changes = this.getFileChanges();
  }

  getFileChanges(): PathChange[] {
    const trackingTree = this.trackingDoc.getTree("vault");

    const nodes: Record<
      TreeID,
      { trackingNode: LoroTreeNode | undefined; proposedNode: LoroTreeNode }
    > = {};
    const trackingNodes = trackingTree.getNodes();
    for (const mNode of trackingNodes) {
      nodes[mNode.id] = {
        trackingNode: mNode,
        proposedNode: this.proposedFS.findById(mNode.id),
      };
    }
    const proposedNodes = this.proposedDoc.getTree("vault").getNodes();
    for (const sNode of proposedNodes) {
      if (!(sNode.id in nodes)) {
        nodes[sNode.id] = { trackingNode: undefined, proposedNode: sNode };
      }
    }

    const changes: PathChange[] = [];

    for (const [_id, { trackingNode, proposedNode }] of Object.entries(nodes)) {
      let type: PathChange["type"];

      // omit if root
      if (!proposedNode.parent()) {
        continue;
      }
      if (proposedNode?.data.get("name") === trashPath) {
        continue;
      }

      const path = this.proposedFS.getNodePath(proposedNode);

      if (!trackingNode && proposedNode) {
        changes.push({ id: proposedNode.id, path, type: "added" });
      } else if (trackingNode && proposedNode?.data.get(deletedFrom)) {
        changes.push({
          id: proposedNode.id,
          path: proposedNode.data.get(deletedFrom) as string,
          type: "deleted",
        });
      } else if (trackingNode && proposedNode) {
        if (trackingNode.data.get("name") !== proposedNode.data.get("name")) {
          changes.push({ id: proposedNode.id, path, type: "modified" });
          continue;
        } else if (trackingNode.parent()?.id !== proposedNode.parent()?.id) {
          changes.push({ id: proposedNode.id, path, type: "modified" });
          continue;
        }

        const mText =
          (trackingNode.data.get("text") as LoroText | undefined)?.toString() ??
          "";
        const sText =
          (proposedNode.data.get("text") as LoroText | undefined)?.toString() ??
          "";
        type = mText === sText ? "identical" : "modified";
        changes.push({ id: proposedNode.id, path, type });
      }
    }

    return changes.filter((c) => c.type !== "identical");
  }

  snapshot() {
    return {
      tracking: this.trackingDoc.export({ mode: "snapshot" }),
      proposed: this.proposedDoc.export({ mode: "snapshot" }),
    };
  }

  async destroy() {}
}
