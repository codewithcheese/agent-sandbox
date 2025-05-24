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

const debug = createDebug();

const masterPeerId = 1 as const;
const stagingPeerId = 2 as const;

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
      this.masterDoc.setPeerId(masterPeerId);
      const tree = this.masterDoc.getTree("vault");
      const root = tree.createNode();
      root.data.set("name", "");
      root.data.set("isDirectory", true);
      // create staging from snapshot of master
      this.stagingDoc = LoroDoc.fromSnapshot(
        this.masterDoc.export({ mode: "snapshot" }),
      );
      this.stagingDoc.setPeerId(stagingPeerId);
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
    debug("getFileByPath", path);
    invariant(!path.endsWith("/"), "File path must not end with a slash");

    const stagingNode = this.findNode("staging", path);
    if (stagingNode && stagingNode.data.get("isDeleted")) {
      // If the file is tracked but deleted, return null
      return null;
    } else if (stagingNode) {
      // If the file is tracked and exists, create a TFile
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
    debug("getFolderByPath", path);
    invariant(path.endsWith("/"), `Folder path must end with a slash: ${path}`);

    const stagingNode = this.findNode("staging", path);
    if (stagingNode && stagingNode.data.get("isDeleted")) {
      // If the file is tracked but deleted, return null
      return null;
    } else if (stagingNode) {
      // If the file is tracked and exists, create a TFolder for it
      return this.createTFolder(path);
    }

    const folder = this.vault.getFolderByPath(normalizePath(path));
    if (folder) {
      folder.vault = this as unknown as Vault;
    }
    return folder;
  }

  getAbstractFileByPath(path: string) {
    debug("getAbstractFileByPath", path);
    const stagingNode = this.findNode("staging", path);
    if (stagingNode && stagingNode.data.get("isDeleted")) {
      // If the file is tracked but deleted, return null
      return null;
    } else if (stagingNode) {
      // If the file is tracked and exists, create a TFolder for it
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

    // todo: reject existing case insensitive file name

    // File/Folder must not yet exist.
    const stagingNode = this.findNode("staging", path);
    if (stagingNode) {
      throw new Error(`File ${path} already exists.`);
    }
    const existsInVault = this.vault.getFileByPath(normalizePath(path));
    invariant(!existsInVault, `File already exists`);

    this.createNote("staging", path, data);
    this.stagingDoc.commit();
    this.computeChanges();

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
    invariant(path.endsWith("/"), "Path must be a folder");

    const existing = this.vault.getAbstractFileByPath(normalizePath(path));
    if (existing) {
      throw new Error("File already exists.");
    }

    this.ensureFolder("staging", path);
    this.stagingDoc.commit();
    this.computeChanges();

    return this.createTFolder(path);
  }

  async read(file: TFile): Promise<string> {
    const stagingNode = this.findNode("staging", file.path);

    if (stagingNode && stagingNode.data.get("isDeleted")) {
      throw new Error(`File ${file.path} does not exist`);
    } else if (stagingNode) {
      return (stagingNode.data.get("text") as LoroText).toString();
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
    let stagingNode = this.findNode("staging", file.path);
    if (stagingNode && stagingNode.data.get("isDirectory")) {
      throw new Error("delete folder not supported");
    }
    // If the file is already deleted, nothing to do
    if (stagingNode && stagingNode.data.get("isDeleted") === "deleted") {
      return;
    }

    if (!stagingNode) {
      const abstractFile = this.vault.getFileByPath(normalizePath(file.path));
      invariant(abstractFile, `File ${file.path} not found in vault`);
      await this.syncPath(file.path);
      stagingNode = this.findNode("staging", file.path);
      invariant(stagingNode, `File ${file.path} not found after sync`);
    }

    // in-case staging has been renamed, get master node path to check if folder is empty
    const masterNode = this.findNodeById("master", stagingNode.id);
    const masterPath = this.getNodePath(masterNode);
    const abstractFile = this.vault.getAbstractFileByPath(
      normalizePath(masterPath),
    );
    if (abstractFile instanceof TFolder && abstractFile.children.length > 0) {
      throw new Error("Folder is not empty");
    }

    invariant(stagingNode, `File ${file.path} not found after sync`);
    stagingNode.data.set("isDeleted", true);
    this.stagingDoc.commit();
    this.computeChanges();
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

    const newPathNode = this.findNode("staging", newPath);
    if (newPathNode) {
      throw new Error(`Destination ${newPath} already exists.`);
    }

    // Check if the file is tracked
    let stagingNode = this.findNode("staging", file.path);

    // If the file is deleted, we can't rename it
    if (stagingNode && stagingNode.data.get("isDeleted")) {
      throw new Error(
        `Source ${file.path} does not exist. Marked for deletion.`,
      );
    }

    // Import if the file exists in the vault, but not in overlay
    if (!stagingNode) {
      const vaultFile = this.vault.getFileByPath(normalizePath(file.path));
      invariant(
        vaultFile,
        `Source ${file.path} does not exist. File not found in vault.`,
      );
      await this.syncPath(file.path);
      stagingNode = this.findNode("staging", file.path);
      invariant(
        stagingNode,
        `Source ${file.path} does not exist. File not found after sync.`,
      );
    }

    invariant(
      stagingNode,
      `Source ${file.path} does not exist. File not found after sync.`,
    );
    const folder = this.ensureFolder("staging", newPath);
    // todo: test renaming a file and a folder
    const newName = basename(newPath);
    stagingNode.data.set("name", newName);
    if (stagingNode.parent().id !== folder.id) {
      stagingNode.move(folder);
    }
    this.stagingDoc.commit();
    this.computeChanges();
  }

  async modify(
    file: TFile,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    const stagingNode = this.findNode("staging", file.path);
    const existsInVault = this.vault.getFileByPath(normalizePath(file.path));

    if (!stagingNode && existsInVault) {
      await this.syncPath(file.path);
    }
    let node = this.findNode("staging", file.path);
    if (!node) {
      node = this.createNote("staging", file.path, data);
    }
    const text = node.data.get("text") as LoroText;
    // Loro recommends updateByLine for texts > 50_000 characters).
    if (data.length > 50_000) {
      text.updateByLine(data);
    } else {
      text.update(data);
    }
    // note: when node marked is deleted, proceed with the modification as if it's a new file
    if (node.data.get("isDeleted")) {
      node.data.delete("isDeleted");
    }
    this.stagingDoc.commit();
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
    let parentPath = dirname(path);
    if (!parentPath.endsWith("/")) {
      parentPath += "/";
    }

    const name = path.endsWith("/")
      ? basename(path.substring(0, path.length - 1))
      : basename(path);

    const parent =
      parentPath === "" || parentPath === "/" || parentPath === "."
        ? this.getRoot()
        : this.getFolderByPath(parentPath);

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
   * Sync path from disk and sync (LoroText merge) with staging.
   */
  async syncPath(path: string): Promise<void> {
    // Try to get the abstractFile from the vault
    debug("Sync path", path);
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));
    invariant(abstractFile, `${path} not found in vault`);

    const node = this.findNode("master", path);
    if (abstractFile instanceof TFile) {
      const contents = await this.vault.read(abstractFile);
      if (node) {
        invariant(
          node.data.get("isDirectory") === false,
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
        this.createNote("master", path, contents);
      }
    } else if (abstractFile instanceof TFolder) {
      invariant(
        node.data.get("isDirectory") === true,
        `Expected node for ${path} to be a folder, got file.`,
      );
      if (!node) {
        this.ensureFolder("master", path);
      }
    } else {
      throw new Error(`${path} is not a file or folder`);
    }
    this.masterDoc.commit();
    this.syncDocs();
  }

  async syncDelete(path: string): Promise<void> {
    const abstractFile = this.vault.getAbstractFileByPath(normalizePath(path));
    invariant(abstractFile, `${path} not found in vault`);
    const node = this.findNode("master", path);
    if (node) {
      this.masterDoc.getTree("vault").delete(node.id);
      this.masterDoc.commit();
    }
    this.syncDocs();
  }

  /**
   * An approved change replaces staging (last write wins), not merge (default LoroText behavior).
   */
  approveModify(path: string, contents?: string) {
    // Try to get the abstractFile from the vault
    debug("Force update", path);
    let stagingNode = this.findNode("staging", path);
    invariant(
      stagingNode,
      `Cannot approve modify to path not found in staging: ${path}.`,
    );
    invariant(
      stagingNode.data.get("isDirectory") != contents,
      `Cannot approve modify to folder when contents are provided: ${path}`,
    );
    let masterNode = this.findNode("master", path);
    if (!masterNode) {
      if (stagingNode.data.get("isDirectory") === true) {
        this.ensureFolder("master", path);
      } else {
        this.createNote("master", path, contents);
      }
    } else if (!masterNode.data.get("isDirectory")) {
      // recreate text container for last-write-wins not merge semantics
      masterNode.data.delete("text");
      const txtC = masterNode.data.setContainer("text", new LoroText());
      txtC.insert(0, contents);
      this.masterDoc.commit();
    }

    this.syncDocs();
  }

  approveDelete(path: string) {
    const stagingNode = this.findNode("staging", path);
    invariant(
      stagingNode,
      `Cannot approve delete to path not found in staging: ${path}.`,
    );
    invariant(
      stagingNode.data.get("isDeleted"),
      `Cannot approve delete to a path not deleted on staging: ${path}.`,
    );
    const masterNode = this.findNode("master", path);
    this.masterDoc.getTree("vault").delete(masterNode.id);
    this.masterDoc.commit();
    this.syncDocs();
  }

  approveRename(oldPath: string, newPath: string) {
    const masterNode = this.findNode("master", oldPath);
    invariant(
      masterNode,
      `Cannot approve rename from path not found in master: ${oldPath}.`,
    );
    const stagingNode = this.findNode("staging", newPath);
    invariant(
      stagingNode,
      `Cannot approve rename to path not found in staging: ${newPath}.`,
    );
    invariant(
      masterNode.id === stagingNode.id,
      "Cannot approve rename; new path not tracked to old path.",
    );
    // todo apply rename to vault
    // move master node to same location as staging node
    const masterFolder = this.ensureFolder("master", newPath);
    if (masterNode.parent().id !== masterFolder.id) {
      masterNode.move(masterFolder);
    }
    masterNode.data.set("name", basename(newPath));
    this.masterDoc.commit();
    this.syncDocs();
  }

  syncDocs() {
    this.stagingDoc.import(
      this.masterDoc.export({
        mode: "update",
        from: this.stagingDoc.version(),
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

    const nodes: Record<
      TreeID,
      { mNode: LoroTreeNode | undefined; sNode: LoroTreeNode }
    > = {};
    const masterNodes = masterTree.getNodes();
    for (const mNode of masterNodes) {
      nodes[mNode.id] = {
        mNode,
        sNode: this.findNodeById("staging", mNode.id),
      };
    }
    const stagingNodes = this.stagingDoc.getTree("vault").getNodes();
    for (const sNode of stagingNodes) {
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

      const path = this.getNodePath(sNode);

      if (!mNode && sNode) {
        changes.push({ path, type: "added" });
      } else if (mNode && sNode.data.get("isDeleted")) {
        changes.push({ path, type: "deleted" });
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

  ensureFolder(branch: "master" | "staging", path: string): LoroTreeNode {
    const doc = branch === "master" ? this.masterDoc : this.stagingDoc;
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

  createNote(branch: "master" | "staging", path: string, content: string) {
    invariant(!path.endsWith("/"), "Path must be a file");
    const fileName = basename(path);
    const folder = this.ensureFolder(branch, path);
    const node = folder.createNode();
    node.data.set("name", fileName);
    node.data.set("isDirectory", false);
    node.data.setContainer("text", new LoroText());
    (node.data.get("text") as LoroText).insert(0, content);
    return node;
  }

  findNode(
    branch: "master" | "staging",
    path: string,
  ): LoroTreeNode | undefined {
    const doc = branch === "master" ? this.masterDoc : this.stagingDoc;
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

  findNodeById(branch: "staging" | "master", id: TreeID) {
    const doc = branch === "master" ? this.masterDoc : this.stagingDoc;
    const tree = doc.getTree("vault");
    return tree.getNodeByID(id);
  }

  getNodePath(node: LoroTreeNode) {
    const parts = [];
    let cur = node;
    while (cur) {
      parts.unshift(cur.data.get("name"));
      cur = cur.parent();
    }
    return parts.join("/");
  }

  snapshot() {
    return {
      master: this.masterDoc.export({ mode: "snapshot" }),
      staging: this.stagingDoc.export({ mode: "snapshot" }),
    };
  }

  async destroy() {}
}
