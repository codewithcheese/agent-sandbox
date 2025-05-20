import {
  type DataAdapter,
  type DataWriteOptions,
  type EventRef,
  TAbstractFile,
  TFile,
  TFolder,
  type Vault,
} from "obsidian";
import { invariant } from "@epic-web/invariant";
import FS from "@isomorphic-git/lightning-fs";
import { nanoid } from "nanoid";
import * as git from "isomorphic-git";
import { relative } from "path";
import { createDebug } from "$lib/debug.ts";

const debug = createDebug();

const dir: string = "/";
const gitdir: string = "/.git";
const master = "master" as const;
const staging = "staging" as const;

type GitState =
  | { type: "blank"; branch: undefined }
  | { type: "ready"; branch: "staging" }
  | { type: "staged"; branch: "staging" };

export class VaultOverlay implements Vault {
  fs: FS;
  state: GitState = { type: "blank", branch: undefined };

  constructor(private vault: Vault) {
    this.fs = new FS(`agent-sandbox-git-${nanoid()}`);
  }

  async init() {
    invariant(this.state.type === "blank", "Expected blank state");
    console.log("Initializing Git repository...");
    // Initialize git repository
    await git.init({ fs: this.fs, dir, gitdir, bare: true });
    await git.setConfig({
      fs: this.fs,
      dir,
      path: "user.name",
      value: "AI-Agent",
    });
    await git.setConfig({
      fs: this.fs,
      dir,
      path: "user.email",
      value: "agent@example.com",
    });
    console.log("Git repository initialized");

    // Create an empty .gitignore file to initialize the master branch
    await this.fs.promises.writeFile("/.gitignore", "");
    await git.add({ fs: this.fs, dir, filepath: ".gitignore" });

    // Create initial commit
    const commitResult = await git.commit({
      fs: this.fs,
      dir,
      message: "Initial commit",
      author: { name: "AI-Agent", email: "agent@example.com" },
    });
    console.log("Created master branch with initial commit: " + commitResult);

    await git.branch({ fs: this.fs, dir, ref: staging });

    await git.checkout({
      fs: this.fs,
      dir,
      ref: staging,
      force: false,
    });

    // List branches to confirm creation
    const branches = await git.listBranches({ fs: this.fs, dir });
    console.log("Available branches after initialization:", branches);

    this.state = { type: "ready", branch: staging };
  }

  getName() {
    return this.vault.getName();
  }

  get configDir() {
    return this.vault.configDir;
  }

  // @ts-expect-error parent getFolderByPath is not async
  async getFileByPath(path: string): Promise<TFile> {
    // Check if the file is tracked in the git repository
    const trackStatus = await this.fileIsTracked(path);

    // If the file is tracked but deleted, return null
    if (trackStatus === "deleted") {
      return null;
    }

    // If the file is tracked and exists, create a TFile for it
    if (trackStatus === "added") {
      return this.createTFile(path);
    }

    // If the file is not tracked, check the vault
    const file = this.vault.getFileByPath(path);
    if (file) {
      file.vault = this as unknown as Vault;
    }
    return file;
  }

  // @ts-expect-error parent getFolderByPath is not async
  async getFolderByPath(path: string): Promise<TFolder> {
    // Check if the file is tracked in the git repository
    const trackStatus = await this.fileIsTracked(path);

    // If the file is tracked but deleted, return null
    if (trackStatus === "deleted") {
      return null;
    }

    // If the file is tracked and exists, create a TFolder for it
    if (trackStatus === "added") {
      return this.createTFolder(path);
    }

    const folder = this.vault.getFolderByPath(path);
    if (folder) {
      folder.vault = this as unknown as Vault;
    }
    return folder;
  }

  // @ts-expect-error parent getAbstractFileByPath is not async
  async getAbstractFileByPath(path: string) {
    if (await this.fileIsTracked(path)) {
      return this.createAbstractFile(path);
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
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    // Path must not end with a forward‑slash (would denote a folder).
    if (path.endsWith("/")) {
      throw new Error("Path must not be a folder");
    }

    // File/Folder must not yet exist.
    const trackStatus = await this.fileIsTracked(path);
    if (trackStatus === "added" || trackStatus === "deleted") {
      throw new Error(`File ${path} already exists.`);
    }
    const existsInVault = this.vault.getFileByPath(path);
    invariant(!existsInVault, `File already exists`);

    // Parent folder hierarchy must exist.
    this.mkdirRecursive(path);

    await this.fs.promises.writeFile(path, data);
    await git.add({
      dir: dir,
      fs: this.fs,
      filepath: relative("/", path),
    });
    this.state = { type: "staged", branch: staging };
    return this.createTFile(path);
  }

  async createBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    throw new Error("createBinary not supported");
  }

  async createFolder(path: string) {
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing) {
      throw new Error("File already exists.");
    }
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      `Expected ready or staged state. State is ${this.state.type}.`,
    );
    invariant(path.startsWith("/"), "Path must be absolute");
    invariant(path.endsWith("/"), "Folder path must end with a slash");
    this.mkdirRecursive(path);
    // write .gitkeep so that the folder will be tracked by git
    await this.fs.promises.writeFile(`${path}.gitkeep`, "");
    await git.add({
      dir,
      fs: this.fs,
      filepath: relative("/", path),
    });
    this.state = { type: "staged", branch: staging };
    return this.createTFolder(path);
  }

  async read(file: TFile): Promise<string> {
    invariant(file.path.startsWith("/"), "Path must be absolute");
    invariant(this.state.branch === staging, "Expected staging branch");

    const trackStatus = await this.fileIsTracked(file.path);

    if (trackStatus === "deleted") {
      throw new Error(`File ${file.path} does not exist`);
    }

    if (trackStatus === "added") {
      return await this.fs.promises.readFile(file.path, {
        encoding: "utf8",
      });
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

  async delete(file: TAbstractFile, force?: boolean): Promise<void> {
    const folder = this.vault.getFolderByPath(file.path);
    if (folder) {
      throw new Error("delete folder not supported");
    }
    if (folder && !force) {
      throw new Error("Folder is not empty");
    }
    const path = file.path;
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      "Expected ready or staged state",
    );
    invariant(path.startsWith("/"), "Path must be absolute");

    // Check if the file exists in version control
    const trackStatus = await this.fileIsTracked(path);

    // If the file is already deleted, nothing to do
    if (trackStatus === "deleted") {
      return;
    }

    // If the file doesn't exist in version control but exists in the vault, import it first
    if (trackStatus === false) {
      const fileInVault = this.vault.getFileByPath(path);
      invariant(fileInVault, `File ${path} not found in vault`);
      await this.importFileToMaster(path);
    }

    await this.fs.promises.unlink(path);
    await git.remove({
      dir,
      fs: this.fs,
      filepath: relative("/", path),
    });
    this.state = { type: "staged", branch: staging };
  }

  async trash(file: TAbstractFile): Promise<void> {
    throw new Error("trash not supported");
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    invariant(file.path.startsWith("/"), "Source path must be absolute");
    invariant(newPath.startsWith("/"), "Destination path must be absolute");
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      "Expected ready or staged state",
    );

    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (newPath.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    // Path must not end with a forward‑slash (would denote a folder).
    if (newPath.endsWith("/")) {
      throw new Error("Invalid file path");
    }

    const newPathTracked = await this.fileIsTracked(newPath);
    if (newPathTracked) {
      throw new Error(`Destination ${newPath} already exists.`);
    }

    // Check if the file exists in version control
    const trackStatus = await this.fileIsTracked(file.path);

    // If the file is deleted, we can't rename it
    if (trackStatus === "deleted") {
      throw new Error(`Source ${file.path} does not exist.`);
    }

    // If the file doesn't exist in version control but exists in the vault, import it first
    if (!trackStatus) {
      const inVault = this.vault.getFileByPath(file.path);
      invariant(inVault, `Source ${file.path} does not exist.`);
      await this.importFileToMaster(file.path);
    }

    await this.fs.promises.rename(file.path, newPath);
    await git.add({
      dir,
      fs: this.fs,
      filepath: relative("/", newPath),
    });
    this.state = { type: "staged", branch: staging };
  }

  async modify(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    const path = file.path;
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      `Expected ready or staged state. State is ${this.state.type}.`,
    );
    invariant(path.startsWith("/"), "Path must be absolute");

    const trackStatus = await this.fileIsTracked(path);
    const existsInVault = this.vault.getFileByPath(path);

    if (!trackStatus && existsInVault) {
      await this.importFileToMaster(path);
    }
    // if trackStatus is deleted, proceed with the modification as if it's a new file
    this.mkdirRecursive(path);
    await this.fs.promises.writeFile(path, data);
    await git.add({
      dir: dir,
      fs: this.fs,
      filepath: relative("/", path),
    });
    this.state = { type: "staged", branch: staging };
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

  private async createTFolder(path: string): Promise<TFolder> {
    const abstractFile = await this.createAbstractFile(path);
    // todo: implement children
    return { ...abstractFile, children: [], isRoot: () => path === "/" };
  }

  private async createTFile(path: string): Promise<TFile> {
    const abstractFile = await this.createAbstractFile(path);

    const lastSlash = path.lastIndexOf("/");
    const name = lastSlash === -1 ? path : path.substring(lastSlash + 1);
    const extension = name.includes(".")
      ? name.substring(name.lastIndexOf(".") + 1)
      : "";
    const basename = name.includes(".")
      ? name.substring(0, name.lastIndexOf("."))
      : name;
    const stat = await this.fs.promises.stat(`${path}`);

    return {
      ...abstractFile,
      basename,
      extension,
      stat: { ...stat, mtime: stat.mtimeMs, ctime: stat.ctimeMs },
    };
  }

  private async createAbstractFile(path: string): Promise<TAbstractFile> {
    const lastSlash = path.lastIndexOf("/");
    const name = lastSlash === -1 ? path : path.substring(lastSlash + 1);
    const parentPath = lastSlash === -1 ? "" : path.substring(0, lastSlash);
    const parent = parentPath
      ? await this.getFolderByPath(parentPath)
      : this.getRoot();

    return {
      vault: this as unknown as Vault,
      path,
      name,
      parent,
    } as TAbstractFile;
  }

  overlayAbstractFile<T extends TAbstractFile>(file: T): T {
    if (!file) return null;
    file.vault = this as unknown as Vault;
    return file;
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
   * Imports a file from the vault into the master branch of the Git repository.
   * This ensures the file exists in Git before operations are performed on it.
   * @param path Absolute path to the file
   */
  private async importFileToMaster(path: string): Promise<void> {
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      "Expected ready or staged state",
    );
    invariant(path.startsWith("/"), "Path must be absolute");
    invariant(this.state.branch === staging, "Expected staging branch");

    // Try to get the file from the vault
    const file = this.vault.getFileByPath(path);
    invariant(file, `File ${path} not found in vault`);

    const content = await this.vault.read(file);

    if (this.state.type === "staged") {
      await git.stash({
        dir,
        fs: this.fs,
      });
    }
    try {
      await git.checkout({
        dir,
        fs: this.fs,
        ref: master,
      });
      await this.fs.promises.writeFile(path, content);
      await git.add({
        dir,
        fs: this.fs,
        filepath: relative("/", path),
      });
      await git.commit({
        dir,
        fs: this.fs,
        message: `Import ${path} from vault`,
      });
      await git.merge({
        dir,
        fs: this.fs,
        ours: staging,
        theirs: master,
      });
    } catch (error) {
      throw new Error(
        `Merge conflict when importing ${path}: ${error.message}`,
      );
    } finally {
      await git.checkout({
        dir,
        fs: this.fs,
        ref: staging,
      });
      await git.add({
        dir,
        fs: this.fs,
        filepath: ".",
      });
      await git.commit({
        dir,
        fs: this.fs,
        message: `Merge ${path} from master`,
      });
      if (this.state.type === "staged") {
        await git.stash({
          dir,
          fs: this.fs,
          op: "pop",
        });
      }
    }
  }

  async fileIsTracked(path: string): Promise<false | "added" | "deleted"> {
    invariant(path.startsWith("/"), "Path must be absolute");

    // Remove leading slash for git operations
    const relativePath = path.substring(1);

    // Check if the file exists in the working directory
    const existsInWorkdir = await this.existsInWorkdir(path);
    if (existsInWorkdir) {
      return "added";
    }

    // If not in working directory, check if it exists in master branch
    const existsInMaster = await this.existsInMasterBranch(relativePath);
    if (existsInMaster) {
      return "deleted"; // File exists in master but not in working directory
    }

    return false; // File is not tracked
  }

  private async existsInWorkdir(path: string, type: "file" | "folder" = "file"): Promise<boolean> {
    try {
      const stats = await this.fs.promises.stat(path);
      if (type === "folder") {
        return stats.isDirectory();
      }
      return true;
    } catch {
      return false;
    }
  }

  private async existsInMasterBranch(relativePath: string, type: "file" | "folder" = "file"): Promise<boolean> {
    try {
      // Resolve the master branch to get its commit OID
      const masterCommitOid = await git.resolveRef({
        fs: this.fs,
        dir,
        ref: master,
      });

      if (type === "file") {
        // Try to read the file from master branch using the commit OID
        await git.readBlob({
          fs: this.fs,
          dir,
          oid: masterCommitOid,
          filepath: relativePath,
        });
        return true; // File exists in master
      } else {
        // For folders, list files in the master branch
        const files = await git.listFiles({
          fs: this.fs,
          dir,
          ref: masterCommitOid,
        });
        
        // Check if any files start with the directory path
        // Add trailing slash to ensure we're matching a directory
        const dirPrefix = relativePath.endsWith("/") ? relativePath : relativePath + "/";
        return files.some(file => file.startsWith(dirPrefix));
      }
    } catch {
      return false; // Any error means the file/folder doesn't exist in master
    }
  }

  async folderIsTracked(path: string): Promise<false | "added" | "deleted"> {
    invariant(path.startsWith("/"), "Path must be absolute");
  
    // First check if the directory exists in the working directory
    const existsInWorkdir = await this.existsInWorkdir(path, "folder");
    if (existsInWorkdir) {
      return "added";
    }
  
    // If not in working directory, check if it exists in master branch
    // Since git doesn't track directories directly, we need to check if any files
    // within this directory exist in the master branch
    const relativePath = path.substring(1);
    const existsInMaster = await this.existsInMasterBranch(relativePath, "folder");
    if (existsInMaster) {
      return "deleted"; // Directory exists in master but not in working directory
    }
  
    return false; // Directory is not tracked
  }

  /**
   * Get a list of file changes between master and staging branches
   * @returns A list of file changes with their status (added, modified, deleted)
   */
  async getFileChanges(): Promise<
    Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "identical";
    }>
  > {
    const changes: Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "identical";
    }> = [];

    await git.walk({
      dir,
      fs: this.fs,
      trees: [
        git.TREE({ ref: master }), // oldRef
        git.TREE({ ref: staging }), // newRef
      ],

      // map runs once per path that exists in either tree
      map: async (filepath, [oldEntry, newEntry]) => {
        if (filepath === ".") return; // skip root
        if (filepath === ".gitignore") return;

        // undefined => file absent in that commit
        const oidOld = oldEntry && (await oldEntry.oid());
        const oidNew = newEntry && (await newEntry.oid());

        let status: "added" | "modified" | "deleted" | "identical";
        if (oidOld === oidNew) {
          status = "identical";
        } else if (!oldEntry) {
          status = "added";
        } else if (!newEntry) {
          status = "deleted";
        } else {
          status = "modified";
        }

        changes.push({
          path: "/" + filepath, // Add leading slash to match our path convention
          status: status,
        });
      },
    });
    return changes;
  }

  async commit(messageId: string) {
    invariant(this.state.type === "staged", "Expected staged state");
    invariant(this.state.branch === staging, "Expected staging branch");
    const sha = await git.commit({
      dir,
      fs: this.fs,
      message: JSON.stringify({ messageId }),
    });
    this.state = { type: "ready", branch: staging };
    return sha;
  }

  private mkdirRecursive(path: string) {
    const parts = path.split("/");
    parts.pop();
    let currentPath = "";
    for (const part of parts) {
      if (!part) continue;
      currentPath += "/" + part;
      try {
        this.fs.promises.mkdir(currentPath);
      } catch (e) {}
    }
  }

  async destroy() {
    // First, properly close the filesystem
    await this.fs.promises.flush();
    // @ts-expect-error not typed
    await this.fs.promises._deactivate();

    // Get the database name
    // @ts-expect-error not typed
    const dbName = this.fs.promises._backend._idb._database;

    // Use the native IndexedDB API to delete the database
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);

      request.addEventListener("success", () => {
        debug(`Database "${dbName}" successfully deleted`);
        resolve(true);
      });

      request.addEventListener("error", (event) => {
        debug(`Error deleting database "${dbName}":`, request.error);
        reject(request.error);
      });

      request.addEventListener("blocked", () => {
        debug(
          `Database "${dbName}" deletion blocked, likely due to open connections`,
        );
        // You might want to notify the user to close other tabs using this database
      });
    });
  }
}
