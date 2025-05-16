import { Vault, TFile, TFolder, TAbstractFile, Events } from "obsidian";
import type { DataWriteOptions, DataAdapter, EventRef } from "obsidian";
import * as git from "./git";
import { GitManager } from "./git";

export class VaultOverlay {
  private gitManager: GitManager;
  private vault: Vault;
  private messageId: string;
  private turnNumber: number = 0;

  constructor(vault: Vault, messageId: string) {
    this.gitManager = new GitManager();
    this.vault = vault;
    this.messageId = messageId;
  }

  async init() {
    return await this.gitManager.init();
  }

  getName() {
    return this.vault.getName();
  }

  get configDir() {
    return this.vault.configDir;
  }

  getFileByPath(path: string) {
    // todo: first check if file exists in staging, if deleted in staging then return null
    return this.vault.getFileByPath(path);
  }

  getFolderByPath(path: string) {
    return this.vault.getFolderByPath(path);
  }

  getAbstractFileByPath(path: string) {
    return this.vault.getAbstractFileByPath(path);
  }

  getRoot() {
    return this.vault.getRoot();
  }

  /**
   * Create a new plaintext file
   * This will write to the Git staging branch instead of directly to the vault
   */
  async create(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    // todo: use git manager to add file to staging
    // return synthetic tfile
    await this.stageFileChange(path, data, "create");

    return file;
  }

  /**
   * Create a new binary file
   */
  async createBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<TFile> {
    const file = await this.vault.createBinary(path, data, options);

    // Convert ArrayBuffer to string for Git staging
    const decoder = new TextDecoder("utf-8");
    const textData = decoder.decode(data);
    await this.stageFileChange(path, textData, "create");

    return file;
  }

  /**
   * Create a new folder
   */
  async createFolder(path: string): Promise<TFolder> {
    return await this.vault.createFolder(path);
  }

  /**
   * Read a plaintext file
   */
  async read(file: TFile): Promise<string> {
    // Try to read from Git first
    try {
      const content = await git.fs.promises.readFile(`/${file.path}`, {
        encoding: "utf8",
      });
      return content;
    } catch (e) {
      // If not found in Git, read from vault
      return await this.vault.read(file);
    }
  }

  /**
   * Read a cached plaintext file
   */
  async cachedRead(file: TFile): Promise<string> {
    // Try to read from Git first
    try {
      const content = await git.fs.promises.readFile(`/${file.path}`, {
        encoding: "utf8",
      });
      return content;
    } catch (e) {
      // If not found in Git, read from vault
      return await this.vault.cachedRead(file);
    }
  }

  /**
   * Read a binary file
   */
  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return await this.vault.readBinary(file);
  }

  /**
   * Get the resource path
   */
  getResourcePath(file: TFile): string {
    return this.vault.getResourcePath(file);
  }

  /**
   * Delete a file or folder
   */
  async delete(file: TAbstractFile, force?: boolean): Promise<void> {
    if (file instanceof TFile) {
      // Read the content before deleting for staging
      let content = "";
      try {
        content = await this.read(file);
      } catch (e) {
        // Ignore read errors
      }

      // Delete from vault
      await this.vault.delete(file, force);

      // Stage the deletion
      await this.stageFileChange(file.path, content, "delete");
    } else {
      // For folders, just delete from vault
      await this.vault.delete(file, force);
    }
  }

  /**
   * Move to trash
   */
  async trash(file: TAbstractFile, system: boolean): Promise<void> {
    if (file instanceof TFile) {
      // Read the content before trashing for staging
      let content = "";
      try {
        content = await this.read(file);
      } catch (e) {
        // Ignore read errors
      }

      // Trash in vault
      await this.vault.trash(file, system);

      // Stage the deletion
      await this.stageFileChange(file.path, content, "delete");
    } else {
      // For folders, just trash in vault
      await this.vault.trash(file, system);
    }
  }

  /**
   * Rename or move a file
   */
  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    if (file instanceof TFile) {
      // Read the content before renaming for staging
      let content = "";
      try {
        content = await this.read(file);
      } catch (e) {
        // Ignore read errors
      }

      const oldPath = file.path;

      // Rename in vault
      await this.vault.rename(file, newPath);

      // Stage the deletion of the old file
      await this.stageFileChange(oldPath, content, "delete");

      // Stage the creation of the new file
      await this.stageFileChange(newPath, content, "create");
    } else {
      // For folders, just rename in vault
      await this.vault.rename(file, newPath);
    }
  }

  /**
   * Modify the contents of a plaintext file
   */
  async modify(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    // Modify in vault
    await this.vault.modify(file, data, options);

    // Stage the modification
    await this.stageFileChange(file.path, data, "modify");
  }

  /**
   * Modify the contents of a binary file
   */
  async modifyBinary(
    file: TFile,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    // Modify in vault
    await this.vault.modifyBinary(file, data, options);

    // Convert ArrayBuffer to string for Git staging
    const decoder = new TextDecoder("utf-8");
    const textData = decoder.decode(data);
    await this.stageFileChange(file.path, textData, "modify");
  }

  /**
   * Add text to the end of a plaintext file
   */
  async append(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    // Append in vault
    await this.vault.append(file, data, options);

    // Read the updated content
    const content = await this.vault.read(file);

    // Stage the modification
    await this.stageFileChange(file.path, content, "modify");
  }

  /**
   * Atomically read, modify, and save the contents of a note
   */
  async process(
    file: TFile,
    fn: (data: string) => string,
    options?: DataWriteOptions,
  ): Promise<string> {
    // Process in vault
    const result = await this.vault.process(file, fn, options);

    // Stage the modification
    await this.stageFileChange(file.path, result, "modify");

    return result;
  }

  /**
   * Create a copy of a file or folder
   */
  async copy<T extends TAbstractFile>(file: T, newPath: string): Promise<T> {
    if (file instanceof TFile) {
      // Read the content before copying for staging
      let content = "";
      try {
        content = await this.read(file as unknown as TFile);
      } catch (e) {
        // Ignore read errors
      }

      // Copy in vault
      const newFile = await this.vault.copy(file, newPath);

      // Stage the creation of the new file
      await this.stageFileChange(newPath, content, "create");

      return newFile;
    } else {
      // For folders, just copy in vault
      return await this.vault.copy(file, newPath);
    }
  }

  /**
   * Get all loaded files
   */
  getAllLoadedFiles(): TAbstractFile[] {
    return this.vault.getAllLoadedFiles();
  }

  /**
   * Get all folders
   */
  getAllFolders(includeRoot?: boolean): TFolder[] {
    return this.vault.getAllFolders(includeRoot);
  }

  /**
   * Get all Markdown files
   */
  getMarkdownFiles(): TFile[] {
    return this.vault.getMarkdownFiles();
  }

  /**
   * Get all files
   */
  getFiles(): TFile[] {
    return this.vault.getFiles();
  }

  /**
   * Register event handlers for create events
   */
  on(
    name: "create",
    callback: (file: TAbstractFile) => any,
    ctx?: any,
  ): EventRef;
  /**
   * Register event handlers for modify events
   */
  on(
    name: "modify",
    callback: (file: TAbstractFile) => any,
    ctx?: any,
  ): EventRef;
  /**
   * Register event handlers for delete events
   */
  on(
    name: "delete",
    callback: (file: TAbstractFile) => any,
    ctx?: any,
  ): EventRef;
  /**
   * Register event handlers for rename events
   */
  on(
    name: "rename",
    callback: (file: TAbstractFile, oldPath: string) => any,
    ctx?: any,
  ): EventRef;
  /**
   * Register event handlers
   */
  on(
    name: "create" | "modify" | "delete" | "rename",
    callback: (...args: any[]) => any,
    ctx?: any,
  ): EventRef {
    return this.vault.on(name as any, callback, ctx);
  }

  // fixeme: staging files can be handled by gitManager no need for changes objects
  /**
   * Stage a file change in Git
   */
  private async stageFileChange(
    path: string,
    content: string,
    changeType: "create" | "modify" | "delete",
  ): Promise<void> {
    this.turnNumber++;

    if (changeType === "create" || changeType === "modify") {
      const change = {
        kind:
          changeType === "create"
            ? git.ChangeKind.CREATE
            : git.ChangeKind.MODIFY,
        path: path,
        after: content,
        id: `${this.messageId}-${this.turnNumber}`,
        timestamp: Date.now(),
        description: `${changeType} ${path}`,
        messageId: this.messageId,
        turn: this.turnNumber,
      };

      await stageTurn(this.messageId, [change]);
    } else if (changeType === "delete") {
      const change = {
        kind: git.ChangeKind.DELETE,
        path: path,
        before: content,
        id: `${this.messageId}-${this.turnNumber}`,
        timestamp: Date.now(),
        description: `delete ${path}`,
        messageId: this.messageId,
        turn: this.turnNumber,
      };

      await stageTurn(this.messageId, [change]);
    }
  }
}
