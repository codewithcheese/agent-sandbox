import * as git from "isomorphic-git";
import FS from "@isomorphic-git/lightning-fs";
import { nanoid } from "nanoid";
import { createDebug } from "$lib/debug.ts";
import { relative } from "path";
import { Vault } from "obsidian";
import { invariant } from "@epic-web/invariant";

const debug = createDebug();

const dir: string = "/";
const gitdir: string = "/.git";
const master = "master" as const;
const staging = "staging" as const;

type GitState =
  | { type: "blank"; branch: undefined }
  | { type: "ready"; branch: "staging" }
  | { type: "staged"; branch: "staging" };

export class VersionControl {
  fs: typeof FS.prototype;
  vault: Vault;
  state: GitState = { type: "blank", branch: undefined };

  constructor(vault: Vault) {
    this.fs = new FS(`agent-sandbox-git-${nanoid()}`);
    this.vault = vault;
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

  async writeFile(path: string, content: string): Promise<void> {
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      `Expected ready or staged state. State is ${this.state.type}.`,
    );
    invariant(path.startsWith("/"), "Path must be absolute");

    const exists = await this.fileExists(path);
    const existsInVault = this.vault.getFileByPath(path);
    // Import the file if it doesn't exist in version control but exists in the vault
    if (!exists && existsInVault) {
      await this.importFileToMaster(path);
    }
    this.mkdirRecursive(path);
    await this.fs.promises.writeFile(path, content);
    await git.add({
      dir: dir,
      fs: this.fs,
      filepath: relative("/", path),
    });
    this.state = { type: "staged", branch: staging };
  }

  async createFolder(path: string): Promise<void> {
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
  }

  /**
   * Deletes a file from the version control system
   * @param path Absolute path to the file
   */
  async deleteFile(path: string): Promise<void> {
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      "Expected ready or staged state",
    );
    invariant(path.startsWith("/"), "Path must be absolute");

    // Check if the file exists in version control
    const exists = await this.fileExists(path);

    // If the file doesn't exist in version control but exists in the vault, import it first
    if (!exists) {
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

  /**
   * Imports a file from the vault into the master branch of the Git repository.
   * This ensures the file exists in Git before operations are performed on it.
   * @param path Absolute path to the file
   */
  async importFileToMaster(path: string): Promise<void> {
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

  async rename(oldPath: string, path: string): Promise<void> {
    invariant(
      this.state.type === "ready" || this.state.type === "staged",
      "Expected ready or staged state",
    );
    invariant(oldPath.startsWith("/"), "Old path must be absolute");
    invariant(path.startsWith("/"), "New path must be absolute");
    invariant(
      !(await this.fileExists(path)),
      "Destination file already exists!",
    );

    await this.importFileToMaster(oldPath);

    await this.fs.promises.rename(oldPath, path);
    await git.add({
      dir,
      fs: this.fs,
      filepath: relative("/", path),
    });
    this.state = { type: "staged", branch: staging };
  }

  async fileExists(path: string): Promise<boolean> {
    invariant(path.startsWith("/"), "Path must be absolute");
    try {
      await this.fs.promises.stat(path);
      return true;
    } catch (e) {
      return false;
    }
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

  async readFile(path: string): Promise<string> {
    invariant(path.startsWith("/"), "Path must be absolute");
    invariant(this.state.branch === staging, "Expected staging branch");
    return await this.fs.promises.readFile(path, {
      encoding: "utf8",
    });
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

  async dispose() {
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
