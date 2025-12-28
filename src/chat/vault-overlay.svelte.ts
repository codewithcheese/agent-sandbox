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
import { basename, dirname } from "path-browserify";
import type { CurrentChatFile } from "./chat-serializer.ts";
import {
  VaultState,
  TreeNode,
  type NodeData,
  type NodeDataWithoutName,
  type FileContent,
  TRASH_FOLDER,
  TMP_FOLDER,
  DELETED_FROM_KEY,
  WAS_CREATED_KEY,
} from "./vault-state/index.ts";
import { createTwoFilesPatch } from "diff";
import { merge as diff3Merge } from "node-diff3";
import { RenameTracker } from "./rename-tracker.ts";

const debug = createDebug();

// Common binary file extensions - used for first-time sync detection
const BINARY_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg', 'tiff', 'tif',
  // Documents
  'pdf',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  // Video
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  // Archives
  'zip', 'tar', 'gz', 'rar', '7z',
  // Other
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

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

export type SyncResult = { path: string; diff: string }[];

export class VaultOverlay implements Vault {
  trackingDoc: VaultState;
  proposedDoc: VaultState;
  changes = $state<ProposedChange[]>([]);

  // Track merge point for syncing tracking operations to proposed
  private lastMergePoint: number = 0;

  constructor(
    private vault: Vault,
    snapshots?: CurrentChatFile["payload"]["vault"],
  ) {
    if (snapshots) {
      // Deserialize saved vault state
      this.trackingDoc = VaultState.deserialize("tracking", snapshots.tracking);
      this.proposedDoc = VaultState.deserialize("proposed", snapshots.proposed);
    } else {
      // Create new tracking state
      this.trackingDoc = new VaultState("tracking");

      // Create proposed as a clone of tracking
      // This ensures both states start with identical structure and matching node IDs
      this.proposedDoc = VaultState.deserialize(
        "proposed",
        this.trackingDoc.serialize()
      );
    }

    // Track merge point for syncing tracking operations to proposed
    this.lastMergePoint = this.trackingDoc.getLogLength();

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

    const proposedNode = this.proposedDoc.findByPath(path);
    if (proposedNode) {
      // If the file is tracked and exists, create a TFile
      return this.createTFile(path, proposedNode.data.stat as FileStats);
    }

    const trackingNode = this.trackingDoc.findByPath(path);
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

    const proposedNode = this.proposedDoc.findByPath(path);
    if (proposedNode && !proposedNode.data.isDirectory) {
      return null;
    }

    if (proposedNode) {
      // If the file is tracked and exists, create a TFolder for it
      return this.createTFolder(path);
    }

    const trackingNode = this.trackingDoc.findByPath(path);
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
    const proposedNode = this.proposedDoc.findByPath(path);
    if (proposedNode) {
      // if the file is tracked and exists
      return this.createAbstractFile(
        path,
        proposedNode.data.isDirectory === true,
      );
    }

    const trackingNode = this.trackingDoc.findByPath(path);
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
    const parent = this.proposedDoc.ensureDirs(dirname(path));

    const size =
      "text" in data
        ? data.text.length
        : "buffer" in data
          ? data.buffer?.byteLength
          : 0;
    const now = Date.now();
    const stat: FileStats = {
      size: size ?? 0,
      mtime: options?.mtime ?? now,
      ctime: options?.ctime ?? now,
    };

    // Proposals are trashed at their tracking path (even if they were renamed).
    // If trashed at this path, then it was deleted and is now being created with new content.
    // Allow since AI may have deleted the file, and now wants to create a new one.
    const trashedNode = this.proposedDoc.findTrashed(path);
    if (trashedNode) {
      trashedNode.restore(parent);
      const proposedNode = this.proposedDoc.findByPath(path);
      invariant(
        proposedNode,
        `${"isDirectory" in data ? "Folder" : "File"} not found: ${path}`,
      );
      if ("text" in data) {
        proposedNode.text = data.text;
      } else if ("buffer" in data) {
        proposedNode.buffer = data.buffer;
      }
      return this.createTFile(path, stat);
    }

    const isDir = "isDirectory" in data;
    this.proposedDoc.createAtPath(path, {
      ...data,
      stat,
      isDirectory: isDir,
      ...(isDir && { [WAS_CREATED_KEY]: true }),
    });

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
    const proposedNode = this.proposedDoc.findByPath(file.path);

    if (proposedNode && proposedNode.data[DELETED_FROM_KEY]) {
      throw new Error(`File was deleted: ${file.path} `);
    } else if (proposedNode) {
      return proposedNode.text ?? "";
    } else if (this.trackingDoc.findByPath(file.path)) {
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
    const proposedNode = this.proposedDoc.findByPath(file.path);

    if (proposedNode && proposedNode.data[DELETED_FROM_KEY]) {
      throw new Error(`File was deleted: ${file.path} `);
    } else if (proposedNode && proposedNode.data.buffer === undefined) {
      throw Error(`Cannot read file as binary, buffer not found: ${file.path}`);
    } else if (proposedNode) {
      return proposedNode.buffer!;
    } else if (this.trackingDoc.findByPath(file.path)) {
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
    const deleted = this.proposedDoc.findTrashed(file.path);
    if (deleted) {
      return;
    }

    let proposedNode = this.proposedDoc.findByPath(file.path);
    let trackingNode =
      proposedNode && this.trackingDoc.findById(proposedNode.id);

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
      proposedNode = this.proposedDoc.findByPath(file.path);
    }

    invariant(proposedNode, `Cannot delete file not found: ${file.path} `);

    if (!trackingNode) {
      // File was created in overlay - just remove it completely
      proposedNode.delete();
    } else {
      // File exists in tracking - undo proposed to tracking state (rollback changes)
      this.revertProposed(proposedNode, trackingNode);

      // Now trash from original path
      const originalPath = this.trackingDoc.getNodePath(trackingNode.id);
      proposedNode.trash(originalPath);
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

    const destProposedNode = this.proposedDoc.findByPath(newPath);
    if (destProposedNode) {
      throw new Error(`Cannot rename to path that already exists: ${newPath}`);
    }

    const trashedNode = this.proposedDoc.findTrashed(file.path);
    if (trashedNode) {
      throw new Error(`Cannot rename file that was deleted: ${file.path}`);
    }

    // Check if new path exists in vault
    const newPathTracking = this.trackingDoc.findByPath(newPath);
    const newPathExists = this.vault.getFileByPath(newPath);
    if (!newPathTracking && newPathExists) {
      throw new Error(`Cannot rename to path that already exists: ${newPath}`);
    }

    // Check if the file is tracked
    let trackingNode = this.trackingDoc.findByPath(file.path);
    let proposedNode = this.proposedDoc.findByPath(file.path);
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
      proposedNode = this.proposedDoc.findByPath(file.path);
    }

    invariant(proposedNode, `Cannot rename file not found: ${file.path}`);
    let newParent = this.proposedDoc.ensureDirs(dirname(newPath));

    proposedNode.move(newParent);
    proposedNode.rename(basename(newPath));
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
    let proposedNode = this.proposedDoc.findByPath(file.path);
    const existsInVault = this.vault.getFileByPath(normalizePath(file.path));

    // Sync if no proposal exists at this path, file exists in the vault, and is not tracked
    if (
      !proposedNode &&
      existsInVault &&
      !this.trackingDoc.findByPath(file.path)
    ) {
      const trackingNode = await this.syncPath(file.path);
      invariant(
        trackingNode,
        `Cannot modify file not found after sync: ${file.path}`,
      );
      proposedNode = this.proposedDoc.findById(trackingNode.id);
    }

    const parent = this.proposedDoc.ensureDirs(dirname(file.path));
    // Restore if file was trashed
    const trashedNode = this.proposedDoc.findTrashed(file.path);
    if (trashedNode) {
      trashedNode.restore(parent);
      proposedNode = this.proposedDoc.findByPath(file.path);
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
      proposedNode.text = data.text;
    } else if ("buffer" in data) {
      proposedNode.buffer = data.buffer;
    }
    const stat = proposedNode.stat;
    proposedNode.stat = { ...stat, mtime: Date.now() } as FileStats;
  }

  _validateCreate(path: string) {
    path = normalizePath(path);

    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    const proposedNode = this.proposedDoc.findByPath(path);
    if (proposedNode) {
      throw new Error(
        `${proposedNode instanceof TFolder ? "Folder" : "File"} already exists.`,
      );
    }

    // todo: reject existing case insensitive file name

    // If trashed, allow to re-create
    const trashedNode = this.proposedDoc.findTrashed(path);
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

    const folderNode = this.proposedDoc.findByPath(path);
    invariant(
      folderNode?.data.isDirectory,
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
              childNode.data[DELETED_FROM_KEY] ||
              childNode.data.name === TRASH_FOLDER ||
              childNode.data.name === TMP_FOLDER
            ) {
              continue;
            }

            const trackingNode = this.trackingDoc.findById(childNode.id);
            // If file was synced (not created in overlay), mark tracking path as seen
            // If file was not synced (created in overlay), mark proposed path as seen
            const childPath = this.proposedDoc.getNodePath(childNode.id);
            seenPaths.add(
              trackingNode
                ? this.trackingDoc.getNodePath(trackingNode.id)
                : childPath,
            );

            const isDir = childNode.data.isDirectory;
            if (isDir) {
              children.push(this.createTFolder(childPath));
            } else {
              children.push(
                this.createTFile(
                  childPath,
                  childNode.data.stat as FileStats,
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
              !this.proposedDoc.isDeleted(child.path)
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

  createTFile(path: string, stat: FileStats): TFile {
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

  async syncAll(sinceTimestamp?: Date): Promise<SyncResult> {
    // Collect all tracked paths from both states
    const trackedPaths = new Set([
      ...this.getAllTrackedPaths(this.trackingDoc),
      ...this.getAllTrackedPaths(this.proposedDoc),
    ]);

    debug("Syncing paths:", Array.from(trackedPaths));

    // Check vault state vs tracking state
    const results: SyncResult = [];

    for (const path of trackedPaths) {
      const vaultFile = this.vault.getAbstractFileByPath(path);
      const trackingNode = this.trackingDoc.findByPath(path);
      const proposedNode = this.proposedDoc.findByPath(path);

      if (!vaultFile && trackingNode) {
        // Check if this file was recently renamed using the global rename tracker
        const renameTracker = RenameTracker.getInstance();
        const cutoffTime = sinceTimestamp ? sinceTimestamp.getTime() : 0;
        const maxAgeMs = Date.now() - cutoffTime;
        const newPath = renameTracker?.findRename(path, maxAgeMs);

        if (newPath) {
          // File was renamed after the checkpoint - sync the rename
          debug("Detected rename via global tracker:", path, "→", newPath);
          const renameResult = await this.syncRename(path, newPath);
          results.push(...renameResult);
        } else {
          // File deleted in vault, maintains proposed as
          // created therefore no change object is returned
          debug("Sync delete", path);
          await this.syncDelete(path);

          // Add result to notify AI about the deletion
          results.push({
            path,
            diff: this.generateDiffMessage(path, path, "delete"),
          });
        }
      } else if (vaultFile && !trackingNode && proposedNode) {
        if (vaultFile instanceof TFolder) {
          // No contents to sync
          continue;
        }
        debug("Sync create", path);
        await this.syncCreate(path);
        // Proposed content is not modified by sync
        // No need to notify about change
      } else if (vaultFile && trackingNode) {
        if (vaultFile instanceof TFolder) {
          // No contents to sync
          continue;
        }
        // Check if vault file changed since tracking
        if (await this.hasVaultChanged(vaultFile, trackingNode)) {
          debug("Sync modify", path);
          // Capture proposed content before sync
          const proposedNode = this.proposedDoc.findById(trackingNode.id);
          const beforeContent = TreeNode.getFileContent(proposedNode);
          await this.syncPath(path);
          const afterContent = TreeNode.getFileContent(proposedNode);
          results.push({
            path,
            diff: this.generateDiffMessage(
              path,
              path,
              "modify",
              beforeContent,
              afterContent,
            ),
          });
        }
      }
    }

    debug(`Vault sync completed.`, results);
    this.computeChanges();
    return results;
  }

  /**
   * Sync parent directories for a file path to tracking with ID reconciliation.
   * For each directory in the path, if it exists in proposed, create in tracking
   * with the same ID. This prevents duplicate directories with different IDs.
   */
  private syncDirectory(filePath: string): void {
    const trackingState = this.trackingDoc;
    const dirPath = dirname(filePath);

    if (dirPath === "." || dirPath === "") return;

    const parts = dirPath.split("/");
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      // Skip if already exists in tracking
      if (trackingState.findByPath(currentPath)) continue;

      // Find parent
      const parentPath = dirname(currentPath);
      const parent =
        parentPath === "." || parentPath === ""
          ? trackingState.getNode("0")
          : trackingState.findByPath(parentPath);

      if (!parent) continue;

      // Check if proposed has this directory
      const proposedNode = this.proposedDoc.findByPath(currentPath);

      if (proposedNode) {
        debug(`Ensure directory with ID reconciliation: ${currentPath} (ID: ${proposedNode.id})`);
        parent.createChildWithId({ name: part, isDirectory: true }, proposedNode.id);
      } else {
        debug(`Ensure directory: ${currentPath}`);
        parent.createChild({ name: part, isDirectory: true });
      }
    }
  }

  /**
   * Sync path from disk to tracking state.
   * For text files with conflicting changes, performs three-way merge with conflict markers.
   * For binary files and directories, uses last-write-win semantics.
   */
  async syncPath(path: string): Promise<any> {
    path = normalizePath(path);
    debug("Sync path", path);
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));
    invariant(abstractFile, `${path} not found in vault`);

    // Sync parent directories with ID reconciliation before syncing the file
    this.syncDirectory(path);

    const trackingNode = this.trackingDoc.findByPath(path);
    const proposedNode = this.proposedDoc.findByPath(path);
    if (!trackingNode && proposedNode) {
      throw new Error(`Failed to sync path, proposal already exists: ${path}`);
    }

    try {
      if (abstractFile instanceof TFile) {
        const isBinary = this.isBinaryFile(abstractFile, trackingNode);

        if (isBinary) {
          // Binary file handling
          const vaultBuffer = await this.vault.readBinary(abstractFile);
          if (trackingNode) {
            invariant(
              !trackingNode.isDirectory,
              `Expected node for ${path} to be a file, got folder.`,
            );
            trackingNode.stat = abstractFile.stat;
            trackingNode.buffer = vaultBuffer;
            return trackingNode;
          } else {
            return this.trackingDoc.createAtPath(path, {
              isDirectory: false,
              buffer: vaultBuffer,
              stat: abstractFile.stat,
            });
          }
        } else {
          // Text file handling
          const vaultContents = await this.vault.read(abstractFile);
          if (trackingNode) {
            invariant(
              !trackingNode.isDirectory,
              `Expected node for ${path} to be a file, got folder.`,
            );

            // Update tracking with vault content
            // The MODIFY operation will capture previousText for three-way merge in mergeDocs()
            trackingNode.stat = abstractFile.stat;
            trackingNode.text = vaultContents;

            return trackingNode;
          } else {
            return this.trackingDoc.createAtPath(path, {
              isDirectory: false,
              text: vaultContents,
              stat: abstractFile.stat,
            });
          }
        }
      } else if (abstractFile instanceof TFolder) {
        if (!trackingNode) {
          return this.trackingDoc.createAtPath(path, {
            isDirectory: true,
          });
        } else if (trackingNode.data.isDirectory === false) {
          throw new Error(
            `Path is folder in vault, but not in tracking: ${path}`,
          );
        }
      } else {
        throw new Error(`${path} is not a file or folder`);
      }
    } finally {
      this.mergeDocs();
    }
  }

  /**
   * Perform three-way merge between tracking (base), proposed (ours), and vault (theirs).
   * Writes merged result with conflict markers to proposed state.
   *
   * When conflicts exist,
   * conflict markers are inserted for the user to resolve manually.
   *
   * @param baseText - Base version (original from tracking)
   * @param proposedText - Ours version (AI/user modifications)
   * @param vaultText - Theirs version (current on-disk content)
   * @param proposedNode - Node to write merged result to
   */
  private async performThreeWayMerge(
    baseText: string,
    proposedText: string,
    vaultText: string,
    proposedNode: any,
  ): Promise<void> {
    // If proposed hasn't changed from base, no merge needed
    if (proposedText === baseText) {
      return;
    }

    // Split into lines for diff3 merge
    const baseLines = baseText.split("\n");
    const proposedLines = proposedText.split("\n");
    const vaultLines = vaultText.split("\n");

    // Perform three-way merge using node-diff3
    // Result will include conflict markers if conflicts are detected
    const mergeResult = diff3Merge(proposedLines, baseLines, vaultLines, {
      excludeFalseConflicts: true,
    });

    // Write merged result back to proposed state
    // If conflicts exist, they will be included as conflict markers
    const mergedText = mergeResult.result.join("\n");
    proposedNode.text = mergedText;
  }

  /**
   * Sync create: When a file exists in vault and proposed, sync vault content to tracking.
   * Preserves AI modifications in proposed by re-applying them after sync.
   *
   * Flow:
   * 1. Save proposed data (AI modifications)
   * 2. Create tracking node from vault content
   * 3. Re-apply proposed modifications via modify()
   */
  async syncCreate(path: string): Promise<any> {
    path = normalizePath(path);
    const abstractFile = this.vault.getAbstractFileByPath(path);
    invariant(abstractFile, `Cannot sync create, file not in vault: ${path}`);
    const proposedNode = this.proposedDoc.findByPath(path);
    invariant(
      proposedNode,
      `Cannot sync create, file not in proposed: ${path}`,
    );

    // Extract and save proposed data before resync
    const proposedData = proposedNode.getDataWithoutName();

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

    // Sync parent directories with ID reconciliation before creating node
    this.syncDirectory(path);

    // Delete proposed node to make room for resync
    proposedNode.delete();

    // Create tracking node from vault content
    const trackingNode = this.trackingDoc.createAtPath(path, {
      isDirectory: abstractFile instanceof TFolder,
      text,
      buffer,
      stat,
    });

    this.mergeDocs();

    // Verify proposed node was recreated
    const newProposedNode = this.proposedDoc.findByPath(path);
    invariant(
      newProposedNode,
      `Failed sync create, synced proposed not found: ${path}`,
    );

    // Restore proposed data (AI modifications) via modify
    if (abstractFile instanceof TFile) {
      if (proposedData.text != null) {
        await this.modify(abstractFile, proposedData.text);
      } else if (proposedData.buffer != null) {
        await this.modifyBinary(abstractFile, proposedData.buffer);
      }
    }

    return trackingNode;
  }

  /**
   * Sync delete: When a file is deleted from vault, remove it from tracking.
   */
  async syncDelete(path: string): Promise<void> {
    path = normalizePath(path);
    const abstractFile = this.vault.getAbstractFileByPath(path);
    invariant(
      !abstractFile,
      `Cannot sync delete, file exists in vault: ${path}`,
    );
    const trackingNode = this.trackingDoc.findByPath(path);
    invariant(
      trackingNode,
      `Cannot sync delete, file not in tracking: ${path}`,
    );

    // Delete from tracking state
    trackingNode.delete();
    this.mergeDocs();
  }

  /**
   * Sync rename: When a file is renamed in vault, update both tracking and proposed.
   * Handles conflicts when AI has also modified the file or created a conflicting file.
   *
   * Flow:
   * 1. Validate vault file exists at new path
   * 2. Handle conflicts if AI created/renamed file to same path
   * 3. Update tracking to match vault rename
   * 4. Update proposed to follow tracking
   * 5. Restore any AI-created content as modifications
   */
  async syncRename(oldPath: string, newPath: string): Promise<SyncResult> {
    // Validate vault file exists at new path
    const vaultFile = this.vault.getAbstractFileByPath(newPath);
    if (!vaultFile) {
      debug(`Dropping rename event - vault file not found: ${newPath}`);
      return [];
    }

    const trackingNode = this.trackingDoc.findByPath(oldPath);
    if (!trackingNode) {
      debug(`Dropping rename event - not tracking: ${oldPath}`);
      return [];
    }

    const proposedNode = this.proposedDoc.findById(trackingNode.id);
    invariant(
      proposedNode,
      `Corrupted overlay state: tracking node exists at ${oldPath} but corresponding proposed node with ID ${trackingNode.id} not found`,
    );

    let preservedAiContent: string | undefined;
    let preservedAiBuffer: ArrayBuffer | undefined;

    // Check for conflict: AI renamed/created different file to the same newPath
    const conflictNode = this.proposedDoc.findByPath(newPath);
    if (conflictNode && proposedNode && conflictNode.id !== proposedNode.id) {
      const conflictTrackingNode = this.trackingDoc.findById(conflictNode.id);

      if (conflictTrackingNode) {
        // AI renamed different file - undo it (vault rename wins)
        const originalPath = this.trackingDoc.getNodePath(conflictTrackingNode.id);
        const originalParent = this.proposedDoc.ensureDirs(
          dirname(originalPath),
        );
        conflictNode.move(originalParent);
        conflictNode.rename(basename(originalPath));
      } else {
        // AI created new file at newPath - preserve its content for later restoration
        preservedAiContent = conflictNode.text;
        preservedAiBuffer = conflictNode.buffer;

        // Delete AI-created node to make room for vault rename
        conflictNode.delete();
      }
    }

    // Update tracking to match vault rename (vault rename wins)
    const newParentTracking = this.trackingDoc.ensureDirs(dirname(newPath));
    trackingNode.move(newParentTracking);
    trackingNode.rename(basename(newPath));
    this.mergeDocs();

    // Update proposed to follow tracking rename
    if (proposedNode) {
      const newParentProposed = this.proposedDoc.ensureDirs(dirname(newPath));

      // Handle trashed nodes: restore them to their new location
      if (proposedNode.isTrashed()) {
        proposedNode.restore(newParentProposed);
      } else {
        proposedNode.move(newParentProposed);
      }

      proposedNode.rename(basename(newPath));
    }

    // If we preserved AI-created content, restore it as a modification at new path
    if (
      (preservedAiContent !== undefined || preservedAiBuffer !== undefined) &&
      vaultFile instanceof TFile
    ) {
      if (preservedAiContent !== undefined) {
        await this.modify(vaultFile, preservedAiContent);
      } else if (preservedAiBuffer !== undefined) {
        await this.modifyBinary(vaultFile, preservedAiBuffer);
      }
    }

    return [{ path: newPath, diff: `Renamed ${oldPath} → ${newPath}` }];
  }

  async approve(ops: ApprovedChange[]) {
    // Create checkpoints for rollback on error
    const proposedCheckpoint = this.proposedDoc.checkpoint();
    const trackingCheckpoint = this.trackingDoc.checkpoint();
    try {
      // proposed data remaining after approval is persisted and synced
      const remainders: {
        tracking: TreeNode;
        proposed: TreeNode;
        proposedData: NodeDataWithoutName;
      }[] = [];

      for (const op of ops) {
        const proposedNode =
          this.proposedDoc.findByPath(op.path) ||
          this.proposedDoc.findTrashed(op.path);
        invariant(
          proposedNode,
          `Cannot approve ${op.type}, no proposal found for: ${op.path}`,
        );
        if (proposedNode.data[DELETED_FROM_KEY] && op.type !== "delete") {
          throw new Error(
            `Cannot approve ${op.type}, file was deleted: ${op.path}`,
          );
        }
        // get proposed data before approved changes are synced
        const proposedData = proposedNode.getDataWithoutName();
        const trackingNode = this.trackingDoc.findById(proposedNode.id);
        if (op.type === "create") {
          // write change to tracking with same ID as proposed
          const data = proposedNode.getDataWithoutName();
          if (data.isDirectory && op.override) {
            throw new Error(
              `Cannot approve create directory with text or binary data: ${op.path}`,
            );
          }
          if ("override" in op) {
            data.text = op.override.text;
          }
          // Sync parent directories with ID reconciliation before creating node
          this.syncDirectory(op.path);
          // Use proposed ID for ID consistency - proposed node becomes tracked
          const newTrackingNode = this.trackingDoc.createAtPath(
            op.path,
            data as NodeDataWithoutName & Record<string, unknown>,
            proposedNode.id,
          );
          remainders.push({
            tracking: newTrackingNode,
            proposed: proposedNode,
            proposedData,
          });
          await this.persistApproval("create", op.path, data);
        } else if (op.type === "delete") {
          trackingNode!.delete();
          // node deletion does not sync, so mark proposed as deleted manually
          proposedNode.delete();
          await this.persistApproval("delete", op.path, undefined);
        } else if (op.type === "rename") {
          const oldPath = this.trackingDoc.getNodePath(trackingNode!.id);
          if (trackingNode!.parentId !== proposedNode.parentId) {
            let parentNode = this.trackingDoc.findByPath(dirname(op.path));
            if (!parentNode) {
              // if parent path is not tracked, create it with proposed parent's ID
              const proposedParent = proposedNode.parent();
              parentNode = this.trackingDoc.createAtPath(
                dirname(op.path),
                proposedParent!.getDataWithoutName() as NodeDataWithoutName & Record<string, unknown>,
                proposedParent?.id,
              );
            }
            trackingNode!.move(parentNode);
          }
          if (trackingNode!.name !== proposedNode.name) {
            trackingNode!.rename(basename(op.path));
          }
          await this.persistApproval("rename", op.path, {
            oldPath,
          });
        } else if (op.type === "modify") {
          // recreate text container for last-write-wins not merge semantics
          if (proposedData.text) {
            trackingNode!.text = "override" in op ? op.override.text : proposedData.text;
          } else if (proposedData.buffer) {
            trackingNode!.buffer = proposedData.buffer;
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
          const trackingPath = this.trackingDoc.getNodePath(trackingNode!.id);
          await this.persistApproval(
            "modify",
            trackingPath,
            trackingNode!.getDataWithoutName(),
          );
        } else {
          throw Error(
            `Unrecognized operation type: ${JSON.stringify(op satisfies never)}`,
          );
        }
      }

      this.mergeDocs();

      // Apply remaining changes from partial approvals
      for (const { tracking, proposed, proposedData } of remainders) {
        const diff = this.diffProposed(tracking, proposed, proposedData);
        // get tracked proposed node
        const proposedNode = this.proposedDoc.findById(tracking.id);
        if (diff.text) {
          proposedNode!.text = diff.text.proposed;
        }
        if (diff.buffer) {
          proposedNode!.buffer = diff.buffer.proposed;
        }
        if (diff.path) {
          const parent = proposedNode!.parent();
          const parentPath = parent ? this.proposedDoc.getNodePath(parent.id) : "";
          const parentNode = this.proposedDoc.findByPath(parentPath);
          proposedNode!.move(parentNode!);
        }
      }
    } catch (e) {
      // Rollback to checkpoints on error
      this.proposedDoc.rollback(proposedCheckpoint);
      this.trackingDoc.rollback(trackingCheckpoint);
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
      this.proposedDoc.findByPath(change.path) ??
      this.proposedDoc.findTrashed(change.path);

    // For create, there's no tracking node. For others, we expect one.
    let trackingNode = this.trackingDoc.findById(proposedNode.id);

    switch (change.type) {
      case "create":
        // Rejecting a "create" means the item should not exist in proposed.
        proposedNode!.delete();
        break;

      case "delete":
        // Rejecting a "delete" means the item should be restored from trash.
        // BUT KEEP ITS CURRENT CONTENT in proposed.
        const parent = this.proposedDoc.findById(trackingNode!.parentId!);
        invariant(
          parent,
          `Failed to reject ${change.type} on ${change.path}, original parent not found.`,
        );
        proposedNode!.restore(parent);
        break;

      case "rename": {
        // Rejecting a "rename" means the item in proposed (at change.newPath)
        // should revert to its old path (change.oldPath) from tracking,
        // BUT KEEP ITS CURRENT CONTENT in proposed.
        const oldPath = this.trackingDoc.getNodePath(trackingNode!.id);
        invariant(
          match.type === "rename" && match.info.oldPath === oldPath,
          `Cannot reject rename on ${change.path}. Original path (${oldPath}) does not match current proposed change.`,
        );
        // restore any trashed parents
        const oldParent = this.proposedDoc.ensureDirs(dirname(oldPath));
        proposedNode!.move(oldParent);
        proposedNode!.rename(basename(oldPath));
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
        const trackingText = trackingNode!.text;
        if (trackingText !== undefined) {
          proposedNode!.text = trackingText;
        } else {
          proposedNode!.modify({ text: undefined }); // Ensure text is removed if tracking had no text
        }

        const trackingBuffer = trackingNode!.buffer;
        if (trackingBuffer !== undefined) {
          proposedNode!.buffer = trackingBuffer;
        } else {
          proposedNode!.modify({ buffer: undefined }); // Ensure buffer is removed if tracking had no buffer
        }

        // Revert stats
        const trackingStat = trackingNode!.stat;
        if (trackingStat) {
          proposedNode!.stat = trackingStat;
        } else {
          proposedNode!.modify({ stat: undefined });
        }
        break;
      default:
        throw new Error(
          `Unhandled ProposedChange type: ${JSON.stringify(change satisfies never)}`,
        );
    }
  }

  async persistApproval(
    ...args:
      | ["create", string, NodeDataWithoutName]
      | ["modify", string, NodeDataWithoutName]
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
    trackingNode: TreeNode,
    proposedNode: TreeNode,
    proposedData: NodeDataWithoutName,
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
    const trackingPath = this.trackingDoc.getNodePath(trackingNode.id);
    const proposedPath = this.proposedDoc.getNodePath(proposedNode.id);
    if (trackingPath !== proposedPath) {
      diff.path = {
        tracking: trackingPath,
        proposed: proposedPath,
      };
    }

    // Compare text content (just check if different)
    const trackingText = trackingNode.text;
    if (proposedData.text && trackingText !== proposedData.text) {
      diff.text = {
        tracking: trackingText,
        proposed: proposedData.text,
      };
    }

    // Compare buffer data (just check if different)
    const trackingBuffer = trackingNode.buffer;
    if (proposedData.buffer && trackingBuffer !== proposedData.buffer) {
      diff.buffer = {
        tracking: trackingBuffer,
        proposed: proposedData.buffer,
      };
    }

    return diff;
  }

  /**
   * Collect all node IDs from a VaultState by traversing the tree.
   * Helper for getFileChanges().
   */
  private collectNodeIds(state: VaultState, ids: Set<string>): void {
    const root = state.getNode("0"); // Root always has ID "0"
    if (root) {
      this.collectNodeIdsRecursive(root, ids, state);
    }
  }

  /**
   * Recursively traverse tree and collect all node IDs.
   */
  private collectNodeIdsRecursive(
    node: any, // TreeNode from VaultState
    ids: Set<string>,
    state: VaultState,
  ): void {
    // Skip root node (don't add it)
    if (node.id !== "0") {
      ids.add(node.id);
    }

    // Recursively process children
    const children = state.getChildren(node.id);
    for (const child of children) {
      this.collectNodeIdsRecursive(child, ids, state);
    }
  }

  /**
   * Merge tracking operations into proposed state.
   *
   * When sync operations create/modify nodes in tracking, those operations are
   * replayed into proposed so both states stay synchronized.
   *
   * Operations contain nodeId, so replayed creates produce nodes with identical IDs
   * in both tracking and proposed. This enables ID-based correlation for renames.
   *
   * Conflict handling:
   * - If a node with the same ID already exists in proposed, skip (already merged)
   * - ID consistency is ensured at source (callers use proposed ID when creating tracking nodes)
   */
  mergeDocs() {
    const trackingState = this.trackingDoc;
    const proposedState = this.proposedDoc;

    // Get new operations since last merge
    const newOps = trackingState.getOperationsSince(this.lastMergePoint);

    // Replay each operation into proposed
    for (const op of newOps) {
      try {
        if (op.type === 'create') {
          // Skip if node with this ID already exists in proposed
          // (ID consistency is ensured at source - tracking uses proposed ID when available)
          if (proposedState.findById(op.nodeId)) {
            continue;
          }
          proposedState.replayOperation(op);
        } else {
          // Three-way merge for MODIFY operations with text changes
          if (
            op.type === 'modify' &&
            'text' in op.changes &&
            op.previousText !== undefined
          ) {
            const proposedNode = proposedState.findById(op.nodeId);
            const proposedText = proposedNode?.data.text;

            // If proposed text differs from base, perform three-way merge
            if (
              proposedNode &&
              typeof proposedText === 'string' &&
              proposedText !== op.previousText
            ) {
              const baseText = op.previousText;
              const vaultText = op.changes.text as string;

              // Perform three-way merge
              const baseLines = baseText.split('\n');
              const proposedLines = proposedText.split('\n');
              const vaultLines = vaultText.split('\n');

              const mergeResult = diff3Merge(proposedLines, baseLines, vaultLines, {
                excludeFalseConflicts: true,
              });

              const mergedText = mergeResult.result.join('\n');
              debug(`mergeDocs: Three-way merge for ${op.nodeId}`);

              // Replay with merged text instead of vault text
              proposedState.replayOperation({
                ...op,
                changes: { ...op.changes, text: mergedText },
              });
              continue;
            }
          }

          proposedState.replayOperation(op);
        }
      } catch (e) {
        // Log but don't fail - proposed may have diverged (AI changes)
        debug(`mergeDocs: Failed to replay operation ${op.type}: ${(e as Error).message}`);
      }
    }

    // Update merge point
    this.lastMergePoint = trackingState.getLogLength();

    // Invalidate caches
  }

  computeChanges() {
    this.changes = this.getFileChanges();
  }

  getFileChanges(): ProposedChange[] {
    const changes: ProposedChange[] = [];
    const allIds = new Set<string>();

    // Collect all unique node IDs from both tracking and proposed states
    this.collectNodeIds(this.trackingDoc, allIds);
    this.collectNodeIds(this.proposedDoc, allIds);

    for (const id of allIds) {
      const trackingNode = this.trackingDoc.findById(id);
      const proposedNode = this.proposedDoc.findById(id);

      // If node only exists in tracking, it means it was hard-deleted from proposed
      // (not via our trash mechanism). This is an edge case.
      // Our primary "delete" mechanism involves moving to .overlay-trash in proposed.
      if (trackingNode && !proposedNode) {
        console.warn(
          `Node ${id} (path: ${this.trackingDoc.getNodePath(trackingNode.id)}) exists in tracking but not in proposed. Consider this a hard delete?`,
        );
        continue;
      }

      if (!proposedNode) continue; // Should not happen if allIds includes proposedNode IDs.

      const pnPath = this.proposedDoc.getNodePath(proposedNode.id);

      // Skip the .overlay-trash folder itself
      if (pnPath === TRASH_FOLDER) {
        continue;
      }

      // Skip the .overlay-tmp folder itself
      if (pnPath.startsWith(TMP_FOLDER)) {
        continue;
      }

      const isProposedTrashed = proposedNode.isTrashed();

      if (!trackingNode && proposedNode && !isProposedTrashed) {
        // Case 1: CREATED - Node exists in proposed, not in tracking, and not in trash.
        const pnPath = this.proposedDoc.getNodePath(proposedNode.id);
        const pnIsDir = proposedNode.isDirectory;
        // Only return directories explicitly created.
        if (pnIsDir && proposedNode.data[WAS_CREATED_KEY]) {
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
        const originalPath = proposedNode.deletedFrom;
        if (originalPath) {
          const tnIsDir = trackingNode.isDirectory;
          changes.push({
            type: "delete",
            path: originalPath,
            info: {
              isDirectory: tnIsDir,
            },
          });
        } else {
          console.warn(
            `Trashed node ${id} (proposed path: ${this.proposedDoc.getNodePath(proposedNode.id)}) is missing 'DELETED_FROM_KEY' metadata.`,
          );
        }
      } else if (trackingNode && proposedNode && !isProposedTrashed) {
        // Case 3: EXISTING - Node in both, not in trash. Check for RENAME and/or MODIFY.
        const trackingPath = this.trackingDoc.getNodePath(trackingNode.id);
        const proposedPath = this.proposedDoc.getNodePath(proposedNode.id);
        const nodeIsDir = proposedNode.isDirectory;

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
        if (!nodeIsDir && !trackingNode.contentEquals(proposedNode)) {
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
      tracking: this.trackingDoc.serialize(),
      proposed: this.proposedDoc.serialize(),
    };
  }

  revert(checkpoint: number) {
    debug("Reverting to checkpoint", checkpoint);
    this.proposedDoc.rollback(checkpoint);
    debug("Revert complete, computing changes");
    this.computeChanges();
    debug("Compute changes complete");
  }

  revertProposed(proposedNode: any, trackingNode: any): void {
    // Note: IDs may differ if nodes were created independently (AI in proposed, sync in tracking)
    // We use path-based matching as a fallback when IDs don't match

    const trackingParent = trackingNode.parent();
    const proposedParent = proposedNode.parent();

    // If parent IDs differ, find the correct parent in proposed
    if (proposedParent && trackingParent && proposedParent.id !== trackingParent.id) {
      // Try by ID first, then fall back to path
      let originalParent = this.proposedDoc.findById(trackingParent.id);
      if (!originalParent) {
        const trackingParentPath = this.trackingDoc.getNodePath(trackingParent.id);
        originalParent = this.proposedDoc.findByPath(trackingParentPath);
      }
      if (originalParent) {
        proposedNode.move(originalParent);
      }
    }

    // Reset deleted flag
    proposedNode.modify({ [DELETED_FROM_KEY]: undefined });

    // Reset text and buffer
    if (trackingNode.data.text) {
      proposedNode.text = trackingNode.text!;
    }
    if (trackingNode.data.buffer) {
      proposedNode.buffer = trackingNode.buffer!;
    }
    // Reset name
    if (trackingNode.data.name) {
      proposedNode.modify({ name: trackingNode.data.name });
    }
    // Reset stat
    if (trackingNode.data.stat) {
      proposedNode.modify({ stat: trackingNode.data.stat });
    }

    // Undo move if parents changed (use path-based fallback)
    const parent = trackingNode.parent();
    if (proposedNode.parent()?.id !== parent?.id) {
      let targetParent = this.proposedDoc.findById(parent!.id);
      if (!targetParent && parent) {
        const parentPath = this.trackingDoc.getNodePath(parent.id);
        targetParent = this.proposedDoc.findByPath(parentPath);
      }
      if (targetParent) {
        proposedNode.move(targetParent);
      }
    }

  }

  /**
   * Get all tracked paths from a VaultState.
   * Traverses the tree and collects paths, excluding infrastructure folders.
   */
  private getAllTrackedPaths(doc: VaultState): string[] {
    const paths: string[] = [];
    const root = doc.getNode("0");

    if (root) {
      this.collectPathsFromNode(root, "", paths);
    }

    // Filter out infrastructure folders
    return paths.filter(
      (path) => path && path !== TRASH_FOLDER && !path.startsWith(TMP_FOLDER),
    );
  }

  /**
   * Recursively collect paths from tree using TreeNode objects.
   * Only includes explicitly created directories and all files.
   */
  private collectPathsFromNode(
    node: TreeNode,
    parentPath: string,
    paths: string[],
  ): void {
    const name = node.data.name;
    const path = parentPath ? `${parentPath}/${name}` : name;

    // Only collect non-root nodes with actual paths that were explicitly created
    const nodeIsDirectory = node.data.isDirectory;
    if (
      path &&
      path !== "" &&
      (!nodeIsDirectory || node.data[WAS_CREATED_KEY])
    ) {
      paths.push(path);
    }

    // Recursively process children
    for (const child of node.children()) {
      this.collectPathsFromNode(child, path, paths);
    }
  }

  /**
   * Check if vault file has changed since tracking was recorded.
   * Compares mtime and size for files; checks directory state for folders.
   */
  private async hasVaultChanged(
    vaultFile: TAbstractFile,
    trackingNode: TreeNode,
  ): Promise<boolean> {
    const trackingStat = trackingNode.stat;
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
      return !trackingNode.isDirectory;
    }
  }

  async destroy() {}

  /**
   * Determine if a file should be treated as binary based on:
   * 1. Existing tracking node content type (buffer vs text)
   * 2. File extension for new files
   */
  private isBinaryFile(file: TFile, trackingNode?: TreeNode): boolean {
    // If tracking node exists, use its content type
    if (trackingNode) {
      return trackingNode.buffer !== undefined;
    }
    // For new files, check extension
    return BINARY_EXTENSIONS.has(file.extension.toLowerCase());
  }

  private generateDiffMessage(
    oldPath: string,
    newPath: string,
    operation: "modify" | "delete",
    beforeContent?: FileContent,
    afterContent?: FileContent,
  ): string {
    if (operation === "delete") {
      return `File ${oldPath} was deleted.`;
    }

    // For create and modify operations, show diff between before and after content

    // Handle binary files
    if (beforeContent?.type === "binary" || afterContent?.type === "binary") {
      const pathInfo =
        oldPath !== newPath ? `${oldPath} → ${newPath}` : newPath;
      return `File ${pathInfo} (binary) was modified.`;
    }

    // Handle text files
    if (beforeContent?.type === "text" && afterContent?.type === "text") {
      // Check if content is the same
      if (beforeContent.content === afterContent.content) {
        const pathInfo =
          oldPath !== newPath ? `${oldPath} → ${newPath}` : newPath;
        return `File ${pathInfo} was touched but content is unchanged.`;
      }

      const patch = createTwoFilesPatch(
        oldPath,
        newPath,
        beforeContent.content,
        afterContent.content,
        undefined,
        undefined,
        { context: 0 },
      );

      // Remove the Index: and === lines (first 2 lines) to save tokens
      const lines = patch.split("\n");
      const optimizedDiff = lines.slice(2).join("\n");

      // Check if diff is too large (more than 50 lines or 2000 characters)
      const diffLines = optimizedDiff.split("\n");
      const MAX_LINES = 50;
      const MAX_CHARS = 2000;

      if (diffLines.length > MAX_LINES || optimizedDiff.length > MAX_CHARS) {
        // Count changes for summary
        const addedLines = diffLines.filter((line) =>
          line.startsWith("+"),
        ).length;
        const removedLines = diffLines.filter((line) =>
          line.startsWith("-"),
        ).length;
        const pathInfo =
          oldPath !== newPath ? `${oldPath} → ${newPath}` : newPath;

        return `${pathInfo} was extensively modified (${addedLines} additions, ${removedLines} deletions).`;
      }

      return optimizedDiff.trim();
    }

    // Fallback for other cases
    const pathInfo = oldPath !== newPath ? `${oldPath} → ${newPath}` : newPath;
    return `${pathInfo} was modified.`;
  }
}
