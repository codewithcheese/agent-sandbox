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
  type Frontiers,
  LoroDoc,
  LoroText,
  type LoroTreeNode,
  type TreeID,
} from "loro-crdt/base64";
import { basename, dirname } from "path-browserify";
import type { CurrentChatFile } from "./chat-serializer.ts";
import { type NodeData, TreeFS, wasCreatedKey } from "./tree-fs.ts";
import {
  createStat,
  getBuffer,
  getDeletedFrom,
  getName,
  getNodeData,
  getStat,
  getText,
  hasContentChanged,
  isDirectory,
  isTrashed,
  replaceBuffer,
  replaceText,
  setStat,
  updateText,
} from "$lib/utils/loro.ts";

const debug = createDebug();

const trashPath = ".overlay-trash" as const;
const deletedFrom = "deletedFrom" as const;
export const isDirectoryKey = "isDirectory" as const;

const trackingPeerId = 1 as const;
const proposedPeerId = 2 as const;

export type ProposedChange =
  | { type: "create"; path: string; info: { isDirectory: boolean } }
  | { type: "delete"; path: string; info: { isDirectory: boolean } }
  | {
      type: "rename";
      path: string;
      info: {
        oldPath: string;
        isDirectory: boolean;
      };
    }
  | { type: "modify"; path: string; info: { isDirectory: boolean } }; // path is current path in proposed; modify is for file content

type ApprovedChange =
  | { type: "create"; path: string; override?: { text: string } }
  | { type: "modify"; path: string; override?: { text: string } }
  | { type: "delete"; path: string }
  | { type: "rename"; path: string };

type SyncDiff = { path: string; added: number; removed: number }; // path is current path in proposed

export class VaultOverlay implements Vault {
  trackingDoc: LoroDoc;
  proposedDoc: LoroDoc;
  changes = $state<ProposedChange[]>([]);
  trackingFS: TreeFS;
  proposedFS: TreeFS;

  constructor(
    private vault: Vault,
    snapshots?: CurrentChatFile["payload"]["vault"],
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
      root.data.set(isDirectoryKey, true);
      const trash = root.createNode();
      trash.data.set("name", trashPath);
      trash.data.set(isDirectoryKey, true);
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
    if (proposedNode && !proposedNode.data.get(isDirectoryKey)) {
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
        proposedNode.data.get(isDirectoryKey) === true,
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

  private async _create(
    path: string,
    data: { isDirectory: true } | { text: string } | { buffer: ArrayBuffer },
    options?: DataWriteOptions,
  ): Promise<TFile | TFolder> {
    path = normalizePath(path);

    // Ensure parent directories exist
    const parent = this.proposedFS.ensureDirs(dirname(path));

    const size =
      "text" in data
        ? data.text.length
        : "buffer" in data
          ? data.buffer?.byteLength
          : 0;
    const stat = createStat(size, options);

    // Proposals are trashed at their tracking path (even if they were renamed).
    // If trashed at this path, then it was deleted and is now being created with new content.
    // Allow since AI may have deleted the file, and now wants to create a new one.
    const trashedNode = this.proposedFS.findTrashed(path);
    if (trashedNode) {
      this.proposedFS.restoreNode(trashedNode, parent);
      const proposedNode = this.proposedFS.findByPath(path);
      invariant(
        proposedNode,
        `${"isDirectory" in data ? "Folder" : "File"} not found: ${path}`,
      );
      if ("text" in data) {
        updateText(proposedNode, data.text);
      } else if ("buffer" in data) {
        replaceBuffer(proposedNode, data.buffer);
      }
      this.proposedDoc.commit();
      return this.createTFile(path, stat);
    }

    this.proposedFS.createNode(path, { ...data, stat });
    this.proposedDoc.commit();

    if ("isDirectory" in data) {
      return this.createTFolder(path);
    } else {
      return this.createTFile(path, stat);
    }
  }

  async create(
    path: string,
    text: string,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    this._validateCreate(path);
    return (await this._create(path, { text }, options)) as TFile;
  }

  async createBinary(
    path: string,
    buffer: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    this._validateCreate(path);
    return (await this._create(path, { buffer }, options)) as TFile;
  }

  async createFolder(path: string) {
    this._validateCreate(path);
    return (await this._create(path, { isDirectory: true })) as TFolder;
  }

  /**
   *  Read
   */
  async read(file: TFile): Promise<string> {
    const proposedNode = this.proposedFS.findByPath(file.path);

    if (proposedNode && proposedNode.data.get(deletedFrom)) {
      throw new Error(`File was deleted: ${file.path} `);
    } else if (proposedNode) {
      return getText(proposedNode);
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
      return getBuffer(proposedNode);
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
    const deleted = this.proposedFS.findTrashed(file.path);
    if (deleted) {
      return;
    }

    let proposedNode = this.proposedFS.findByPath(file.path);
    let trackingNode =
      proposedNode && this.trackingFS.findById(proposedNode.id);

    if (!proposedNode && !trackingNode) {
      const abstractFile = this.vault.getAbstractFileByPath(
        normalizePath(file.path),
      );
      if (!abstractFile) {
        invariant(abstractFile, `Cannot delete file not found: ${file.path}`);
      }
      trackingNode = await this.syncPath(file.path);
      invariant(
        trackingNode,
        `Cannot delete file not found after sync: ${file.path}`,
      );
      proposedNode = this.proposedFS.findByPath(file.path);
    }

    invariant(proposedNode, `Cannot delete file not found: ${file.path} `);

    try {
      if (!trackingNode) {
        // File was created in overlay - just remove it completely
        this.proposedFS.deleteNode(proposedNode.id);
      } else {
        // File exists in tracking - undo proposed to tracking state (rollback changes)
        this.revertProposed(proposedNode, trackingNode);

        // Now trash from original path
        const originalPath = this.trackingFS.getNodePath(trackingNode);
        this.proposedFS.trashNode(proposedNode, originalPath);
      }
    } finally {
      this.proposedDoc.commit();
    }
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

    const trashedNode = this.proposedFS.findTrashed(file.path);
    if (trashedNode) {
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
    let proposedNode = this.proposedFS.findByPath(file.path);
    // Import if the file exists in the vault, but not in overlay
    if (!trackingNode && !proposedNode) {
      const vaultFile = this.vault.getAbstractFileByPath(
        normalizePath(file.path),
      );
      const type = vaultFile instanceof TFolder ? "folder" : "file";
      invariant(
        vaultFile,
        `Cannot rename ${type} not found in vault: ${file.path}`,
      );
      trackingNode = await this.syncPath(file.path);
      invariant(
        trackingNode,
        `Cannot rename ${type} not found after sync: ${file.path}`,
      );
      proposedNode = this.proposedFS.findByPath(file.path);
    }

    invariant(proposedNode, `Cannot rename file not found: ${file.path}`);
    let newParent = this.proposedFS.ensureDirs(dirname(newPath));

    this.proposedFS.moveNode(proposedNode, newParent.id);
    this.proposedFS.renameNode(proposedNode.id, basename(newPath));
    this.proposedDoc.commit();
  }

  async modify(file: TFile, text: string, options?: DataWriteOptions) {
    await this._modify(file, { text }, options);
  }

  async modifyBinary(
    file: TFile,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    await this._modify(file, { buffer: data }, options);
  }

  async _modify(
    file: TFile,
    data: { text: string } | { buffer: ArrayBuffer },
    options?: DataWriteOptions,
  ) {
    let proposedNode = this.proposedFS.findByPath(file.path);
    const existsInVault = this.vault.getFileByPath(normalizePath(file.path));

    // Sync if no proposal exists at this path, file exists in the vault, and is not tracked
    if (
      !proposedNode &&
      existsInVault &&
      !this.trackingFS.findByPath(file.path)
    ) {
      const trackingNode = await this.syncPath(file.path);
      invariant(
        trackingNode,
        `Cannot modify file not found after sync: ${file.path}`,
      );
      proposedNode = this.proposedFS.findById(trackingNode.id);
    }

    const parent = this.proposedFS.ensureDirs(dirname(file.path));
    // Restore if file was trashed
    const trashedNode = this.proposedFS.findTrashed(file.path);
    if (trashedNode) {
      this.proposedFS.restoreNode(trashedNode, parent);
      proposedNode = this.proposedFS.findByPath(file.path);
      invariant(
        proposedNode,
        `Failed to find file after restored from trash: ${file.path}`,
      );
    }

    if (!proposedNode) {
      // If not tracked, the treat as create
      return await this._create(file.path, data, options);
    }

    if ("text" in data) {
      updateText(proposedNode, data.text);
    } else if ("buffer" in data) {
      replaceBuffer(proposedNode, data.buffer);
    }
    this.proposedDoc.commit();
  }

  _validateCreate(path: string) {
    path = normalizePath(path);

    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    const proposedNode = this.proposedFS.findByPath(path);
    if (proposedNode) {
      throw new Error(
        `${proposedNode instanceof TFolder ? "Folder" : "File"} already exists.`,
      );
    }

    // todo: reject existing case insensitive file name

    // If trashed, allow to re-create
    const trashedNode = this.proposedFS.findTrashed(path);
    const existsInVault = this.vault.getAbstractFileByPath(path);
    if (!trashedNode && existsInVault) {
      throw new Error(
        `${existsInVault instanceof TFolder ? "Folder" : "File"} already exists.`,
      );
    }
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
      folderNode.data.get(isDirectoryKey),
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

            const isDir = childNode.data.get(isDirectoryKey);
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

  async syncAll(): Promise<string[]> {
    // Collect all tracked paths from both docs
    const trackedPaths = new Set([
      ...this.getAllTrackedPaths(this.trackingDoc),
      ...this.getAllTrackedPaths(this.proposedDoc),
    ]);

    debug("Syncing paths:", Array.from(trackedPaths));

    // Check vault state vs tracking state
    const modified: string[] = [];
    for (const path of trackedPaths) {
      const vaultFile = this.vault.getAbstractFileByPath(path);
      const trackingNode = this.trackingFS.findByPath(path);
      const proposedNode = this.proposedFS.findByPath(path);

      if (!vaultFile && trackingNode) {
        // File deleted in vault, maintains proposed as
        // created therefore no change object is returned
        debug("Sync delete", path);
        await this.syncDelete(path);
      } else if (vaultFile && !trackingNode && proposedNode) {
        // Created in overlay, now exists in vault. Rebase to `modified`.
        // Returns difference been vault and proposed
        debug("Sync create", path);
        const trackingNode = await this.syncCreate(path);
        const proposedNode = this.proposedFS.findById(trackingNode.id);
        modified.push(this.proposedFS.getNodePath(proposedNode));
      } else if (vaultFile && trackingNode) {
        // Check if vault file changed since tracking
        if (await this.hasVaultChanged(vaultFile, trackingNode)) {
          debug("Sync modify", path);
          const trackingNode = await this.syncPath(path);
          const proposedNode = this.proposedFS.findById(trackingNode.id);
          modified.push(this.proposedFS.getNodePath(proposedNode));
        }
      }
    }

    debug(`Vault sync completed.`, modified);
    return modified;
  }

  /**
   * Sync path from disk and sync (LoroText merge) with proposed.
   */
  async syncPath(path: string): Promise<LoroTreeNode> {
    path = normalizePath(path);
    // Try to get the abstractFile from the vault
    debug("Sync path", path);
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));
    invariant(abstractFile, `${path} not found in vault`);

    const trackingNode = this.trackingFS.findByPath(path);
    const proposedNode = this.proposedFS.findByPath(path);
    if (!trackingNode && proposedNode) {
      throw new Error(`Failed to sync path, proposal already exists: ${path}`);
    }

    try {
      if (abstractFile instanceof TFile) {
        const contents = await this.vault.read(abstractFile);
        if (trackingNode) {
          invariant(
            !isDirectory(trackingNode),
            `Expected node for ${path} to be a file, got folder.`,
          );
          setStat(trackingNode, abstractFile.stat);
          updateText(trackingNode, contents);
          return trackingNode;
        } else {
          return this.trackingFS.createNode(path, {
            text: contents,
            stat: abstractFile.stat,
          });
        }
      } else if (abstractFile instanceof TFolder) {
        if (!trackingNode) {
          return this.trackingFS.createNode(path, {
            isDirectory: true,
          });
        } else if (trackingNode.data.get(isDirectoryKey) === false) {
          throw new Error(
            `Path is folder in vault, but not in tracking: ${path}`,
          );
        }
      } else {
        throw new Error(`${path} is not a file or folder`);
      }
    } finally {
      this.trackingDoc.commit();
      this.mergeDocs();
    }
  }

  /**
   * Vault overlay only tracks changes, only necessary to
   * sync create when proposal (proposed create) exists for path.
   */
  async syncCreate(path: string): Promise<LoroTreeNode> {
    path = normalizePath(path);
    const abstractFile = this.vault.getAbstractFileByPath(path);
    invariant(abstractFile, `Cannot sync create, file not in vault: ${path}`);
    const proposedNode = this.proposedFS.findByPath(path);
    invariant(
      proposedNode,
      `Cannot sync create, file not in proposed: ${path}`,
    );
    let text: string | undefined;
    let buffer: ArrayBuffer | undefined;
    let stat: FileStats | undefined;
    if (abstractFile instanceof TFile) {
      text = await this.vault.read(abstractFile);
      if (text == null) {
        buffer = await this.vault.readBinary(abstractFile);
      }
      stat = abstractFile.stat;
    }
    // extract proposed data, delete and re-create in tracking
    const data = getNodeData(proposedNode);
    this.proposedFS.deleteNode(proposedNode.id);
    const trackingNode = this.trackingFS.createNode(path, {
      isDirectory: abstractFile instanceof TFolder,
      text,
      buffer,
      stat,
    });
    this.trackingDoc.commit();
    this.mergeDocs();
    // restore proposed data
    const newProposedNode = this.proposedFS.findByPath(path);
    invariant(
      newProposedNode,
      `Failed sync create, synced proposed not found: ${path}`,
    );
    if (abstractFile instanceof TFile) {
      if (data.text != null) {
        await this.modify(abstractFile, data.text);
      } else if (data.buffer != null) {
        await this.modifyBinary(abstractFile, data.buffer);
      }
    }

    return trackingNode;
  }

  async syncDelete(path: string): Promise<void> {
    path = normalizePath(path);
    const abstractFile = this.vault.getAbstractFileByPath(path);
    invariant(
      !abstractFile,
      `Cannot sync delete, file exists in vault: ${path}`,
    );
    const trackingNode = this.trackingFS.findByPath(path);
    invariant(
      trackingNode,
      `Cannot sync delete, file not in tracking: ${path}`,
    );
    const proposedNode = this.proposedFS.findById(trackingNode.id);
    const proposedPath = this.proposedFS.getNodePath(proposedNode);
    const wasTrashed = isTrashed(proposedNode);

    // Save proposed data
    const data = getNodeData(proposedNode);
    this.trackingFS.deleteNode(trackingNode.id);
    this.trackingDoc.commit();
    this.mergeDocs();

    // Restore proposed data as create
    if (!data.isDirectory && !wasTrashed) {
      if (data.text != null) {
        await this.create(proposedPath, data.text);
      } else if (data.buffer != null) {
        await this.createBinary(proposedPath, data.buffer);
      }
    }
  }

  async approve(ops: ApprovedChange[]) {
    const proposedCheckpoint = this.proposedDoc.frontiers();
    const trackingCheckpoint = this.trackingDoc.frontiers();
    try {
      // proposed data remaining after approval is persisted and synced
      const remainders: {
        tracking: LoroTreeNode;
        proposed: LoroTreeNode;
        proposedData: NodeData;
      }[] = [];

      // an untracked proposed node, becomes obsolete once `create`
      // is approved and a tracking node is created
      const obsoleteNodes: LoroTreeNode[] = [];

      for (const op of ops) {
        const proposedNode =
          this.proposedFS.findByPath(op.path) ||
          this.proposedFS.findTrashed(op.path);
        invariant(
          proposedNode,
          `Cannot approve ${op.type}, no proposal found for: ${op.path}`,
        );
        if (proposedNode.data.get(deletedFrom) && op.type !== "delete") {
          throw new Error(
            `Cannot approve ${op.type}, file was deleted: ${op.path}`,
          );
        }
        // get proposed data before approved changes are synced
        const proposedData = getNodeData(proposedNode);
        const trackingNode = this.trackingFS.findById(proposedNode.id);
        if (op.type === "create") {
          // write change to tracking
          const data = getNodeData(proposedNode);
          if (data.isDirectory && op.override) {
            throw new Error(
              `Cannot approve create directory with text or binary data: ${op.path}`,
            );
          }
          if ("override" in op) {
            data.text = op.override.text;
          }
          const trackingNode = this.trackingFS.createNode(op.path, data);
          remainders.push({
            tracking: trackingNode,
            proposed: proposedNode,
            proposedData,
          });
          // non-tracked proposed node is obsolete once create approved
          obsoleteNodes.push(proposedNode);
          await this.persistApproval("create", op.path, data);
        } else if (op.type === "delete") {
          this.trackingFS.deleteNode(trackingNode.id);
          // node deletion does not sync, so mark proposed as deleted manually
          this.proposedFS.deleteNode(proposedNode.id);
          await this.persistApproval("delete", op.path, undefined);
        } else if (op.type === "rename") {
          const oldPath = this.trackingFS.getNodePath(trackingNode);
          if (trackingNode.parent()?.id !== proposedNode.parent()?.id) {
            let parentNode = this.trackingFS.findByPath(dirname(op.path));
            if (!parentNode) {
              // if parent path is not tracked, create it
              parentNode = this.trackingFS.createNode(
                dirname(op.path),
                getNodeData(proposedNode.parent()),
              );
            }
            this.trackingFS.moveNode(trackingNode, parentNode.id);
          }
          if (getName(trackingNode) !== getName(proposedNode)) {
            this.trackingFS.renameNode(trackingNode.id, op.path);
          }
          await this.persistApproval("rename", op.path, {
            oldPath,
          });
        } else if (op.type === "modify") {
          // recreate text container for last-write-wins not merge semantics
          if (proposedData.text) {
            replaceText(
              trackingNode,
              "override" in op ? op.override.text : proposedData.text,
            );
          } else if (proposedData.buffer) {
            replaceBuffer(trackingNode, proposedData.buffer);
          } else {
            throw Error(
              `Cannot modify file without text or binary data: ${op.path}`,
            );
          }
          if ("override" in op && op.override.text !== proposedData.text) {
            // if approved text does not match proposed text then apply remaining changes to proposed
            remainders.push({
              tracking: trackingNode,
              proposed: proposedNode,
              proposedData,
            });
          }
          // Modify is approved separately from rename, modify current tracking path.
          const trackingPath = this.trackingFS.getNodePath(trackingNode);
          await this.persistApproval(
            "modify",
            trackingPath,
            getNodeData(trackingNode),
          );
        } else {
          throw Error(
            `Unrecognized operation type: ${JSON.stringify(op satisfies never)}`,
          );
        }
      }

      this.trackingDoc.commit();
      this.mergeDocs();

      // Apply remaining changes from partial approvals
      for (const { tracking, proposed, proposedData } of remainders) {
        const diff = this.diffProposed(tracking, proposed, proposedData);
        // get tracked proposed node
        const proposedNode = this.proposedFS.findById(tracking.id);
        if (diff.text) {
          updateText(proposedNode, diff.text.proposed);
        }
        if (diff.buffer) {
          replaceBuffer(proposedNode, diff.buffer.proposed);
        }
        if (diff.path) {
          const parentPath = this.proposedFS.getNodePath(proposedNode.parent());
          const parentNode = this.proposedFS.findByPath(parentPath);
          proposedNode.move(parentNode);
        }
      }
      // delete untracked proposed, new proposed was created when tracking synced
      for (const node of obsoleteNodes) {
        this.proposedFS.deleteNode(node.id);
      }
      this.proposedDoc.commit();
    } catch (e) {
      // use TreeFS revertTo so that caches are invalidated
      this.proposedFS.revertTo(proposedCheckpoint);
      this.trackingFS.revertTo(trackingCheckpoint);
      throw e;
    }
  }

  async reject(change: ProposedChange): Promise<void> {
    // check the change is still valid
    const match = this.getFileChanges().find(
      (c) => c.path === change.path && c.type === change.type,
    );
    invariant(
      match,
      `Cannot reject ${change.type} on ${change.path}. No matching change found.`,
    );

    const proposedNode =
      this.proposedFS.findByPath(change.path) ??
      this.proposedFS.findTrashed(change.path);

    // For create, there's no tracking node. For others, we expect one.
    let trackingNode = this.trackingFS.findById(proposedNode.id);

    switch (change.type) {
      case "create":
        // Rejecting a "create" means the item should not exist in proposed.
        this.proposedFS.deleteNode(proposedNode.id);
        break;

      case "delete":
        // Rejecting a "delete" means the item should be restored from trash.
        // BUT KEEP ITS CURRENT CONTENT in proposed.
        const parent = this.proposedFS.findById(trackingNode.parent().id);
        invariant(
          parent,
          `Failed to reject ${change.type} on ${change.path}, original parent not found.`,
        );
        this.proposedFS.restoreNode(proposedNode, parent);
        break;

      case "rename": {
        // Rejecting a "rename" means the item in proposed (at change.newPath)
        // should revert to its old path (change.oldPath) from tracking,
        // BUT KEEP ITS CURRENT CONTENT in proposed.
        const oldPath = this.trackingFS.getNodePath(trackingNode);
        invariant(
          match.type === "rename" && match.info.oldPath === oldPath,
          `Cannot reject rename on ${change.path}. Original path (${oldPath}) does not match current proposed change.`,
        );
        // restore any trashed parents
        const oldParent = this.proposedFS.ensureDirs(dirname(oldPath));
        this.proposedFS.moveNode(proposedNode, oldParent.id);
        this.proposedFS.renameNode(proposedNode.id, basename(oldPath));
        break;
      }

      case "modify":
        // Rejecting a "modify" means the item's content in proposed (at change.path)
        // should revert to its content from tracking,
        // BUT KEEP ITS CURRENT PATH in proposed (it might have been renamed).
        invariant(
          proposedNode && trackingNode,
          "Proposed and tracking nodes are required for modify rejection.",
        );

        // Revert content (text or buffer)
        const trackingText = getText(trackingNode);
        if (trackingText !== undefined) {
          updateText(proposedNode, trackingText); // replaceText handles LoroText recreation
        } else {
          proposedNode.data.delete("text"); // Ensure text container is removed if tracking had no text
        }

        const trackingBuffer = getBuffer(trackingNode);
        if (trackingBuffer !== undefined) {
          replaceBuffer(proposedNode, trackingBuffer); // replaceBuffer handles base64 encoding
        } else {
          proposedNode.data.delete("buffer"); // Ensure buffer is removed if tracking had no buffer
        }

        // Revert stats
        const trackingStat = getStat(trackingNode);
        if (trackingStat) {
          setStat(proposedNode, trackingStat);
        } else {
          proposedNode.data.delete("stat");
        }
        break;
      default:
        throw new Error(
          `Unhandled ProposedChange type: ${JSON.stringify(change satisfies never)}`,
        );
    }

    this.proposedDoc.commit();
  }

  async persistApproval(
    ...args:
      | ["create", string, NodeData]
      | ["modify", string, NodeData]
      | ["rename", string, { oldPath: string }]
      | ["delete", string, undefined]
  ) {
    const [type, path, data] = args;
    switch (type) {
      case "create": {
        const folderPath = normalizePath(
          dirname(path) === "." ? "/" : dirname(path),
        );
        const folder = this.vault.getFolderByPath(folderPath);
        if (!folder) {
          await this.vault.createFolder(folderPath);
        }

        if (data.isDirectory) {
          await this.vault.createFolder(path);
        } else if (data.text != null) {
          debug("Persist create", path, data);
          await this.vault.create(path, data.text);
        } else if (data.buffer != null) {
          await this.vault.createBinary(path, data.buffer);
        } else {
          throw new Error(
            `Failed to persist approved create, file is not directory, text or binary data: ${path}: ${JSON.stringify(data)}`,
          );
        }
        break;
      }
      case "delete": {
        const file = this.vault.getAbstractFileByPath(path);
        invariant(file, `Cannot delete file not found: ${path}`);
        await this.vault.delete(file);
        break;
      }
      case "rename": {
        const file = this.vault.getAbstractFileByPath(data.oldPath);
        invariant(file, `Cannot rename file not found: ${data.oldPath}`);
        await this.vault.rename(file, path);
        break;
      }
      case "modify": {
        const file = this.vault.getAbstractFileByPath(path);
        invariant(file instanceof TFile, `Cannot modify folder: ${path}`);
        invariant(file, `Cannot modify file not found: ${path}`);
        if (data.text != null) {
          await this.vault.modify(file, data.text);
        } else if (data.buffer != null) {
          await this.vault.modifyBinary(file, data.buffer);
        } else {
          throw new Error(
            `Failed to persist approved modify, file is not text or binary data: ${path}: ${JSON.stringify(data)}`,
          );
        }
        break;
      }
      default: {
        throw new Error(
          `Failed to persist approval, unrecognized op: ${JSON.stringify(args satisfies never)}`,
        );
      }
    }
  }

  diffProposed(
    trackingNode: LoroTreeNode,
    proposedNode: LoroTreeNode,
    proposedData: NodeData,
  ) {
    const diff: {
      text?: { proposed: string | undefined; tracking: string | undefined };
      path?: { proposed: string; tracking: string };
      buffer?: {
        proposed: ArrayBuffer | undefined;
        tracking: ArrayBuffer | undefined;
      };
    } = {};

    // Compare path
    const trackingPath = this.trackingFS.getNodePath(trackingNode);
    const proposedPath = this.proposedFS.getNodePath(proposedNode);
    if (trackingPath !== proposedPath) {
      diff.path = {
        tracking: trackingPath,
        proposed: proposedPath,
      };
    }

    // Compare text content (just check if different)
    const trackingText = getText(trackingNode);
    if (proposedData.text && trackingText !== proposedData.text) {
      diff.text = {
        tracking: trackingText,
        proposed: proposedData.text,
      };
    }

    // Compare buffer data (just check if different)
    const trackingBuffer = getBuffer(trackingNode);
    if (proposedData.buffer && trackingBuffer !== proposedData.buffer) {
      diff.buffer = {
        tracking: trackingBuffer,
        proposed: proposedData.buffer,
      };
    }

    return diff;
  }

  mergeDocs() {
    this.proposedDoc.import(
      this.trackingDoc.export({
        mode: "update",
        from: this.proposedDoc.version(),
      }),
    );
    this.proposedFS.invalidateCache();
  }

  computeChanges() {
    this.changes = this.getFileChanges();
  }

  getFileChanges(): ProposedChange[] {
    const changes: ProposedChange[] = [];
    const allIds = new Set<TreeID>();

    // Collect all unique node IDs from both tracking and proposed docs
    // Using tree.getNodes() can be expensive if trees are large.
    // If TreeFS maintains a list of all known active IDs, that could be more efficient.
    // For now, direct Loro API is fine.
    this.trackingDoc
      .getTree("vault")
      .getNodes()
      .forEach((n) => {
        if (n.parent()) allIds.add(n.id); // Exclude root
      });
    this.proposedDoc
      .getTree("vault")
      .getNodes()
      .forEach((n) => {
        if (n.parent()) allIds.add(n.id); // Exclude root
      });

    for (const id of allIds) {
      const trackingNode = this.trackingFS.findById(id);
      const proposedNode = this.proposedFS.findById(id);

      // If node only exists in tracking, it means it was hard-deleted from proposed
      // (not via our trash mechanism). This is an edge case.
      // Our primary "delete" mechanism involves moving to .overlay-trash in proposed.
      if (trackingNode && !proposedNode) {
        console.warn(
          `Node ${id} (path: ${this.trackingFS.getNodePath(trackingNode)}) exists in tracking but not in proposed. Consider this a hard delete?`,
        );
        // Optionally, you could emit a delete change here:
        // const tnIsDir = trackingNode.data.get(isDirectoryKey) as boolean ?? false;
        // changes.push({ id, type: "delete", path: this.trackingFS.getNodePath(trackingNode), isDirectory: tnIsDir });
        continue;
      }

      if (!proposedNode) continue; // Should not happen if allIds includes proposedNode IDs.

      // Skip the .overlay-trash folder itself
      if (this.proposedFS.getNodePath(proposedNode) === trashPath) {
        continue;
      }

      const isProposedTrashed = isTrashed(proposedNode);

      if (!trackingNode && proposedNode && !isProposedTrashed) {
        // Case 1: CREATED - Node exists in proposed, not in tracking, and not in trash.
        const pnPath = this.proposedFS.getNodePath(proposedNode);
        const pnIsDir =
          (proposedNode.data.get(isDirectoryKey) as boolean) ?? false;
        // Only return directories explicitly created.
        if (pnIsDir && proposedNode.data.get(wasCreatedKey)) {
          changes.push({
            type: "create",
            path: pnPath,
            info: {
              isDirectory: pnIsDir,
            },
          });
        } else if (!pnIsDir) {
          changes.push({
            type: "create",
            path: pnPath,
            info: {
              isDirectory: pnIsDir,
            },
          });
        }
      } else if (trackingNode && isProposedTrashed) {
        // Case 2: DELETED - Node exists in tracking, and is in trash in proposed.
        const originalPath = getDeletedFrom(proposedNode);
        if (originalPath) {
          const tnIsDir =
            (trackingNode.data.get(isDirectoryKey) as boolean) ?? false; // Get type from trackingNode
          changes.push({
            type: "delete",
            path: originalPath,
            info: {
              isDirectory: tnIsDir,
            },
          });
        } else {
          console.warn(
            `Trashed node ${id} (proposed path: ${this.proposedFS.getNodePath(proposedNode)}) is missing 'deletedFrom' metadata.`,
          );
        }
      } else if (trackingNode && proposedNode && !isProposedTrashed) {
        // Case 3: EXISTING - Node in both, not in trash. Check for RENAME and/or MODIFY.
        const trackingPath = this.trackingFS.getNodePath(trackingNode);
        const proposedPath = this.proposedFS.getNodePath(proposedNode);
        const nodeIsDir =
          (proposedNode.data.get(isDirectoryKey) as boolean) ?? false; // Type is same for tracking/proposed here

        // Check for RENAME (path changed)
        if (trackingPath !== proposedPath) {
          changes.push({
            type: "rename",
            path: proposedPath,
            info: {
              oldPath: trackingPath,
              isDirectory: nodeIsDir,
            },
          });
        }

        // Check for CONTENT MODIFICATION (only for files)
        // A renamed file can also be modified. Modification is against the newPath.
        if (!nodeIsDir && hasContentChanged(trackingNode, proposedNode)) {
          changes.push({
            type: "modify",
            path: proposedPath, // Modification is at the current (potentially new) path
            info: {
              isDirectory: false,
            },
          });
        }
      }
    }
    return changes;
  }

  snapshot() {
    return {
      tracking: this.trackingDoc.export({ mode: "snapshot" }),
      proposed: this.proposedDoc.export({ mode: "snapshot" }),
    };
  }

  revert(checkpoint: Frontiers) {
    debug("Reverting to checkpoint", checkpoint);
    this.trackingFS.invalidateCache();
    this.proposedFS.invalidateCache();
    this.proposedDoc.revertTo(checkpoint);
    this.trackingDoc.import(
      this.proposedDoc.export({
        mode: "update",
        from: this.trackingDoc.version(),
      }),
    );
    this.computeChanges();
  }

  revertProposed(proposedNode: LoroTreeNode, trackingNode: LoroTreeNode): void {
    invariant(
      proposedNode.id === trackingNode.id,
      "Cannot revert proposed to tracking with different IDs",
    );
    const trackingParent = trackingNode.parent();
    if (proposedNode.parent().id !== trackingParent.id) {
      const originalParent = this.proposedFS.findById(trackingParent.id);
      proposedNode.move(originalParent);
    }

    // Reset deleted flag
    proposedNode.data.delete(deletedFrom);

    // Reset text and buffer
    if (trackingNode.data.get("text")) {
      replaceText(proposedNode, getText(trackingNode));
    }
    if (trackingNode.data.get("buffer")) {
      replaceBuffer(proposedNode, getBuffer(trackingNode));
    }
    // Reset name
    if (trackingNode.data.get("name")) {
      proposedNode.data.set("name", trackingNode.data.get("name"));
    }
    // Reset stat
    if (trackingNode.data.get("stat")) {
      proposedNode.data.set("stat", trackingNode.data.get("stat"));
    }

    // Undo move if parents changed
    const parent = trackingNode.parent();
    if (proposedNode.parent().id !== parent.id) {
      proposedNode.move(parent);
    }

    this.proposedFS.invalidateCache();
  }

  private getAllTrackedPaths(doc: LoroDoc): string[] {
    const paths: string[] = [];
    const tree = doc.getTree("vault");
    const root = tree.roots()[0];

    if (root) {
      this.collectPathsFromNode(root, "", paths);
    }

    return paths.filter((path) => path && path !== trashPath);
  }

  private collectPathsFromNode(
    node: LoroTreeNode,
    parentPath: string,
    paths: string[],
  ): void {
    const name = node.data.get("name") as string;
    const path = parentPath ? `${parentPath}/${name}` : name;

    // Only collect non-root nodes with actual paths
    // That were explicitly created
    if (
      path &&
      path !== "" &&
      (!isDirectory(node) ||
        (isDirectory(node) && node.data.get(wasCreatedKey)))
    ) {
      paths.push(path);
    }

    const children = node.children();
    if (children) {
      for (const child of children) {
        this.collectPathsFromNode(child, path, paths);
      }
    }
  }

  private async hasVaultChanged(
    vaultFile: TAbstractFile,
    trackingNode: LoroTreeNode,
  ): Promise<boolean> {
    const trackingStat = getStat(trackingNode);
    if (!trackingStat) {
      return true; // No tracking stat means we should sync
    }

    if (vaultFile instanceof TFile) {
      // For files, compare mtime and size for efficiency
      debug(
        "Comparing file",
        vaultFile.path,
        vaultFile.stat.mtime,
        vaultFile.stat.size,
        trackingStat.mtime,
        trackingStat.size,
      );
      return (
        vaultFile.stat.mtime > trackingStat.mtime ||
        vaultFile.stat.size !== trackingStat.size
      );
    } else {
      // For folders, just check if we have tracking data
      return !trackingNode.data.get(isDirectoryKey);
    }
  }

  async destroy() {}
}
