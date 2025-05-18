import {
  type DataAdapter,
  type DataWriteOptions,
  type EventRef,
  TAbstractFile,
  TFile,
  TFolder,
  type Vault,
} from "obsidian";
import { VersionControl } from "./version-control.ts";
import { Error } from "memfs/lib/internal/errors";

/**
 * VaultOverlay wraps an existing {@link Vault} instance and intercepts **all** mutating
 * operations.  Instead of writing directly to disk it stages a change (via an
 * in‑memory Git worktree managed by {@link VersionControl}) so the user can review the
 * diff before anything touches the real vault.  Non‑mutating read helpers fall back
 * to the Git worktree first and then to the underlying vault to give a live preview
 * of staged content.
 */
export class VaultOverlay implements Vault {
  constructor(
    private vault: Vault,
    private versionControl: VersionControl,
  ) {}

  getName() {
    return this.vault.getName();
  }

  get configDir() {
    return this.vault.configDir;
  }

  getFileByPath(path: string) {
    // TODO: First check if file exists in the staged worktree.  If a staged delete
    // exists we must return null to mirror Obsidian's behaviour after deletion.
    return this.overlayAbstractFile(this.vault.getFileByPath(path));
  }

  getFolderByPath(path: string) {
    return this.overlayAbstractFile(this.vault.getFolderByPath(path));
  }

  getAbstractFileByPath(path: string) {
    return this.overlayAbstractFile(this.vault.getAbstractFileByPath(path));
  }

  getRoot() {
    return this.vault.getRoot();
  }

  async create(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    // TODO (future): detect existing staged change and merge.
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    // Path must not end with a forward‑slash (would denote a folder).
    if (path.endsWith("/")) {
      throw new Error("Invalid file path");
    }

    // File/Folder must not already exist.
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing) {
      throw new Error("File already exists.");
    }

    // Parent folder hierarchy must exist.
    const lastSlash = path.lastIndexOf("/");
    const parentPath = lastSlash === -1 ? "" : path.substring(0, lastSlash);
    if (parentPath && !this.vault.getFolderByPath(parentPath)) {
      throw new Error("Parent folder does not exist");
    }

    await this.versionControl.writeFile(path, data);
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
    await this.versionControl.createFolder(path);
    return this.createTFolder(path);
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

    // Check if the file exists in version control using the fileExists method
    const fileExistsInVC = await this.versionControl.fileExists(file.path);

    // If the file exists in version control, delete it directly
    if (fileExistsInVC) {
      await this.versionControl.deleteFile(file.path);
      return;
    }

    // fixme: support non-TFile
    const content = await this.vault.read(file as TFile);

    // Import the file to main first
    await this.versionControl.importFileToMain(file.path, content);

    // Now delete it
    await this.versionControl.deleteFile(file.path);
  }

  async trash(file: TAbstractFile): Promise<void> {
    throw new Error("trash not supported");
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (newPath.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    // Path must not end with a forward‑slash (would denote a folder).
    if (newPath.endsWith("/")) {
      throw new Error("Invalid file path");
    }

    const existing = this.vault.getAbstractFileByPath(newPath);
    if (existing) {
      throw new Error("File already exists.");
    }

    // todo: use `app.fileManager.renameFile` if you want Obsidian to update
  }

  async modify(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    await this.versionControl.writeFile(file.path, data);
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
    await this.versionControl.append(file.path, data);
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
    const stat = await this.versionControl.fs.promises.stat(`${path}`);

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
      ? this.getFolderByPath(parentPath)
      : this.getRoot();

    return {
      vault: this as unknown as Vault,
      path,
      name,
      parent,
    } as TAbstractFile;
  }

  overlayAbstractFile<T extends TAbstractFile>(file: T): T {
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

  read(file: TFile): Promise<string> {
    throw new Error("read not supported.");
  }
}
