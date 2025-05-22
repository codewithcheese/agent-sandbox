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
} from "loro-crdt/base64";
import { basename, dirname } from "path-browserify";

const debug = createDebug();

const master = 1 as const;
const staging = 2 as const;

export type Change = {
  path: string;
  type: "added" | "deleted" | "modified" | "identical";
};

export class VaultOverlay implements Vault {
  masterDoc: LoroDoc;
  stagingDoc: LoroDoc;
  changes = $state<Change[]>([]);

  constructor(
    private vault: Vault,
    snapshots?: { master: Uint8Array; staging: Uint8Array },
  ) {
    if (snapshots) {
      this.masterDoc = LoroDoc.fromSnapshot(snapshots.master);
      this.stagingDoc = LoroDoc.fromSnapshot(snapshots.staging);
    } else {
      this.masterDoc = new LoroDoc();
      this.masterDoc.setPeerId(master);
      const tree = this.masterDoc.getTree("vault");
      const root = tree.createNode();
      root.data.set("name", "");
      root.data.set("isDirectory", true);
      // create staging from snapshot of master
      this.stagingDoc = LoroDoc.fromSnapshot(
        this.masterDoc.export({ mode: "snapshot" }),
      );
      this.stagingDoc.setPeerId(staging);
    }
  }

  getName() {
    return this.vault.getName();
  }

  get configDir() {
    return this.vault.configDir;
  }

  getFileByPath(path: string): TFile {
    // Check if the file is tracked in the git repository
    const trackStatus = this.fileIsTracked(path);

    // If the file is tracked but deleted, return null
    if (trackStatus === "deleted") {
      return null;
    }

    // If the file is tracked and exists, create a TFile for it
    if (trackStatus === "added") {
      return this.createTFile(path);
    }

    // If the file is not tracked, check the vault
    const file = this.vault.getFileByPath(normalizePath(path));
    if (file) {
      file.vault = this as unknown as Vault;
    }
    return file;
  }

  getFolderByPath(path: string): TFolder {
    // Check if the file is tracked in the git repository
    const trackStatus = this.fileIsTracked(path);

    // If the file is tracked but deleted, return null
    if (trackStatus === "deleted") {
      return null;
    }

    // If the file is tracked and exists, create a TFolder for it
    if (trackStatus === "added") {
      return this.createTFolder(path);
    }

    const folder = this.vault.getFolderByPath(normalizePath(path));
    if (folder) {
      folder.vault = this as unknown as Vault;
    }
    return folder;
  }

  getAbstractFileByPath(path: string) {
    if (this.fileIsTracked(path)) {
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
    const trackStatus = this.fileIsTracked(path);
    if (trackStatus === "added" || trackStatus === "deleted") {
      throw new Error(`File ${path} already exists.`);
    }
    const existsInVault = this.vault.getFileByPath(normalizePath(path));
    invariant(!existsInVault, `File already exists`);

    this.createNote(this.stagingDoc, path, data);
    this.stagingDoc.commit();
    this.updateChanges();

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
    const existing = this.vault.getAbstractFileByPath(normalizePath(path));
    if (existing) {
      throw new Error("File already exists.");
    }
    invariant(path.endsWith("/"), "Path must be a folder");

    this.ensureFolder(this.stagingDoc, path);
    this.stagingDoc.commit();
    this.updateChanges();

    return this.createTFolder(path);
  }

  async read(file: TFile): Promise<string> {
    const trackStatus = this.fileIsTracked(file.path);

    if (trackStatus === "deleted") {
      throw new Error(`File ${file.path} does not exist`);
    }

    if (trackStatus === "added") {
      const node = this.findNode(this.stagingDoc, file.path);
      if (node) {
        return (node.data.get("text") as LoroText).toString();
      }
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
    const folder = this.vault.getFolderByPath(normalizePath(file.path));
    if (folder) {
      throw new Error("delete folder not supported");
    }
    if (folder && !force) {
      throw new Error("Folder is not empty");
    }
    const path = file.path;

    // Check if the file exists in staging
    const trackStatus = this.fileIsTracked(path);

    // If the file is already deleted, nothing to do
    if (trackStatus === "deleted") {
      return;
    }

    // Import the file if it exists in the vault, but not tracking
    if (trackStatus === false) {
      const fileInVault = this.vault.getFileByPath(normalizePath(path));
      invariant(fileInVault, `File ${path} not found in vault`);
      await this.syncPath(path);
    }

    const node = this.findNode(this.stagingDoc, path);
    this.stagingDoc.getTree("vault").delete(node.id);
    this.stagingDoc.commit();
    this.updateChanges();
    // todo: test what happens if node is deleted from staging, but an edit is applied in master
  }

  async trash(file: TAbstractFile): Promise<void> {
    throw new Error("trash not supported");
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    // todo: test renaming a file and a folder
    // Prevent directory traversal – any ".." segment escapes the vault root.
    if (newPath.split("/").some((seg) => seg === "..")) {
      throw new Error("Path is outside the vault");
    }

    const newPathTracked = this.fileIsTracked(newPath);
    if (newPathTracked) {
      throw new Error(`Destination ${newPath} already exists.`);
    }

    // Check if the file is tracked
    const trackStatus = this.fileIsTracked(file.path);

    // If the file is deleted, we can't rename it
    if (trackStatus === "deleted") {
      throw new Error(`Source ${file.path} does not exist.`);
    }

    // Import if the file exists in the vault, but not tracking
    if (!trackStatus) {
      const inVault = this.vault.getFileByPath(normalizePath(file.path));
      invariant(inVault, `Source ${file.path} does not exist.`);
      await this.syncPath(file.path);
    }

    const node = this.findNode(this.stagingDoc, file.path);
    const folder = this.ensureFolder(this.stagingDoc, newPath);
    node.data.set("name", basename(newPath));
    if (node.parent().id !== folder.id) {
      node.move(folder);
    }
    this.stagingDoc.commit();
    this.updateChanges();
  }

  async modify(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    const trackStatus = this.fileIsTracked(file.path);
    const existsInVault = this.vault.getFileByPath(normalizePath(file.path));

    if (!trackStatus && existsInVault) {
      await this.syncPath(file.path);
    }
    // note: when trackStatus is deleted, proceed with the modification as if it's a new file

    let node = this.findNode(this.stagingDoc, file.path);
    if (!node) {
      node = this.createNote(this.stagingDoc, file.path, data);
    }
    node.data.set("text", data);
    this.stagingDoc.commit();
    this.updateChanges();
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
    const abstractFile = this.createAbstractFile(path);
    // todo: implement children
    return { ...abstractFile, children: [], isRoot: () => path === "/" };
  }

  private createTFile(path: string): TFile {
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
   * Imports a file from the vault into overlay tracking.
   * @param path Path to the file
   */
  async syncPath(path: string): Promise<void> {
    // Try to get the abstractFile from the vault
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));

    invariant(abstractFile, `${path} not found in vault`);
    const node = this.findNode(this.masterDoc, path);
    if (abstractFile instanceof TFile) {
      const contents = await this.vault.read(abstractFile);
      if (node) {
        invariant(
          node.data.get("isDirectory") === false,
          `Expected node for ${path} to be a file, got folder.`,
        );
        node.data.set("text", contents);
      } else {
        this.createNote(this.masterDoc, path, contents);
      }
    } else if (abstractFile instanceof TFolder) {
      invariant(
        node.data.get("isDirectory") === true,
        `Expected node for ${path} to be a folder, got file.`,
      );
      if (!node) {
        this.ensureFolder(this.masterDoc, path);
      }
    } else {
      throw new Error(`${path} is not a file or folder`);
    }
    this.masterDoc.commit();
    this.updateChanges();

    // sync with staging
    this.stagingDoc.import(
      this.masterDoc.export({
        mode: "update",
        from: this.stagingDoc.version(),
      }),
    );
  }

  updateChanges() {
    this.changes = this.getFileChanges();
  }

  fileIsTracked(path: string): false | "added" | "deleted" {
    // Check if the file exists in the staging
    const existsInStaging = this.existsInStaging(path);
    if (existsInStaging) {
      return "added";
    }

    // If not in staging, check if it exists in master
    const existsInMaster = this.existsInMaster(path);
    if (existsInMaster) {
      return "deleted"; // File exists in master but not in staging
    }

    return false; // File is not tracked
  }

  private existsInStaging(
    path: string,
    type: "file" | "folder" = "file",
  ): boolean {
    return !!this.findNode(this.stagingDoc, path);
  }

  private existsInMaster(
    path: string,
    type: "file" | "folder" = "file",
  ): boolean {
    return !!this.findNode(this.masterDoc, path);
  }

  getFileChanges(): Change[] {
    type NodeMap = Map<string, LoroTreeNode>;

    const collect = (tree: LoroTree): NodeMap => {
      const map: NodeMap = new Map();
      const walk = (node: LoroTreeNode, parentPath = ""): void => {
        const name = node.data.get("name") as string;
        const path = parentPath + (name ? `/${name}` : "");
        const isDir = node.data.get("isDirectory");
        if (!isDir && name) map.set(path, node);
        node.children()?.forEach((c) => walk(c, path));
      };
      walk(tree.roots()[0]);
      return map;
    };

    const masterTree = this.masterDoc.getTree("vault");
    const stagingTree = this.stagingDoc.getTree("vault");
    const masterFiles = collect(masterTree);
    const stagingFiles = collect(stagingTree);

    const paths = new Set<string>([
      ...masterFiles.keys(),
      ...stagingFiles.keys(),
    ]);

    const changes: Change[] = [];

    for (const path of paths) {
      const mNode = masterFiles.get(path);
      const sNode = stagingFiles.get(path);

      let type: Change["type"];

      if (!mNode && sNode) {
        type = "added";
      } else if (mNode && !sNode) {
        type = "deleted";
      } else if (mNode && sNode) {
        const mText =
          (mNode.data.get("text") as LoroText | undefined)?.toString() ?? "";
        const sText =
          (sNode.data.get("text") as LoroText | undefined)?.toString() ?? "";
        type = mText === sText ? "identical" : "modified";
      }

      if (type !== "identical") {
        changes.push({ path, type });
      }
    }

    return changes;
  }

  ensureFolder(doc: LoroDoc, path: string): LoroTreeNode {
    const tree = doc.getTree("vault");
    const root = tree.roots()[0];

    if (path.lastIndexOf("/") === -1) {
      return root;
    }
    const parts = path
      .substring(0, path.lastIndexOf("/"))
      .split("/")
      .filter((part) => part.length > 0);
    let parent = root;
    for (const name of parts) {
      parent =
        parent.children()?.find((n) => n.data.get("name") === name) ??
        (() => {
          const c = parent.createNode();
          c.data.set("name", name);
          c.data.set("isDirectory", true);
          return c;
        })();
    }
    return parent;
  }

  createNote(doc: LoroDoc, path: string, content: string) {
    const fileName = basename(path);
    const folder = this.ensureFolder(doc, path);
    const node = folder.createNode();
    node.data.set("name", fileName);
    node.data.set("isDirectory", false);
    node.data.setContainer("text", new LoroText());
    (node.data.get("text") as LoroText).insert(0, content);
    return node;
  }

  findNode(doc: LoroDoc, path: string): LoroTreeNode | undefined {
    const tree = doc.getTree("vault");
    const parts = path.split("/");
    let cur: LoroTreeNode | undefined = tree.roots()[0];
    for (const part of parts) {
      if (!part) continue; // Skip empty parts (e.g., from leading/trailing slashes)
      cur = cur?.children()?.find((n) => n.data.get("name") === part);
      if (!cur) break;
    }
    return cur;
  }

  snapshot() {
    return {
      master: this.masterDoc.export({ mode: "snapshot" }),
      staging: this.stagingDoc.export({ mode: "snapshot" }),
    };
  }

  async destroy() {}
}
