import * as git from "isomorphic-git";
import FS from "@isomorphic-git/lightning-fs";
import { nanoid } from "nanoid";
import { createDebug } from "$lib/debug.ts";
import { relative } from "path";

const debug = createDebug();

export class GitManager {
  public fs: typeof FS.prototype;
  private dir: string = "/";
  private gitdir: string = "/.git";

  constructor() {
    this.fs = new FS(`agent-sandbox-git-${nanoid()}`);
  }

  /**
   * Initialize the git repository
   */
  async init(): Promise<boolean> {
    console.log("Initializing Git repository...");
    // Initialize git repository
    await git.init({ fs: this.fs, dir: this.dir, gitdir: this.gitdir });
    console.log("Git repository initialized");

    // Create an empty .gitignore file to initialize the main branch
    await this.fs.promises.writeFile("/.gitignore", "");
    await git.add({ fs: this.fs, dir: this.dir, filepath: ".gitignore" });

    // Create initial commit
    const commitResult = await git.commit({
      fs: this.fs,
      dir: this.dir,
      message: "Initial commit",
      author: { name: "AI-Agent", email: "agent@example.com" },
    });
    console.log("Created main branch with initial commit: " + commitResult);

    await git.branch({ fs: this.fs, dir: this.dir, ref: "staging" });
    await this.checkoutStaging();

    // List branches to confirm creation
    const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
    console.log("Available branches after initialization:", branches);

    return true;
  }

  /**
   * Ensure the staging branch is checked out
   */
  private async checkoutStaging(): Promise<void> {
    const currentBranch = await git.currentBranch({
      fs: this.fs,
      dir: this.dir,
      fullname: false,
    });

    if (currentBranch === "staging") {
      return; // Already on staging branch, no need to checkout
    }

    await git.checkout({
      fs: this.fs,
      dir: this.dir,
      ref: "staging",
      force: false,
    });
  }

  /**
   * Create or modify a file in the staging branch
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!path.startsWith("/")) {
      throw new Error("Path must start be absolute");
    }
    await this.checkoutStaging();

    // Ensure parent directories exist
    const pathParts = path.split("/");
    pathParts.pop(); // Remove the filename
    let currentPath = "";
    for (const part of pathParts) {
      if (!part) continue;
      currentPath += "/" + part;
      try {
        await this.fs.promises.mkdir(currentPath);
      } catch (e) {
        // Directory already exists, continue
      }
    }

    await this.fs.promises.writeFile(path, content);
    await git.add({
      fs: this.fs,
      dir: this.dir,
      filepath: relative("/", path),
    });
  }

  /**
   * Delete a file in the staging branch
   */
  async deleteFile(path: string): Promise<void> {
    if (!path.startsWith("/")) {
      throw new Error("Path must start be absolute");
    }
    await this.checkoutStaging();

    try {
      await this.fs.promises.unlink(path);
      await git.remove({
        fs: this.fs,
        dir: this.dir,
        filepath: relative("/", path),
      });
    } catch (e) {
      // File may not exist, nothing to delete
      console.log(`Error deleting file ${path}:`, e);
    }
  }

  /**
   * Read a file from the staging branch
   */
  async readFile(path: string): Promise<string> {
    if (!path.startsWith("/")) {
      throw new Error("Path must start be absolute");
    }
    await this.checkoutStaging();
    return await this.fs.promises.readFile(path, {
      encoding: "utf8",
    });
  }

  /**
   * Stage changes for a conversation turn
   */
  async commitTurn(msgId: string): Promise<string> {
    await this.checkoutStaging();

    // Add all changes to staging
    await git.add({
      fs: this.fs,
      dir: this.dir,
      filepath: ".",
    });

    // Commit the changes
    const sha = await git.commit({
      fs: this.fs,
      dir: this.dir,
      message: `msg:${msgId}`,
      author: { name: "AI-Agent", email: "agent@example.com" },
    });

    // Tag the commit with the msgId so it's easy to drop later
    await git.writeRef({
      fs: this.fs,
      gitdir: this.gitdir,
      ref: `refs/notes/chat/${msgId}`,
      value: sha,
    });

    return sha;
  }

  /**
   * Drop changes for a conversation turn
   */
  async dropTurn(msgId: string): Promise<string | false> {
    try {
      const noteRef = `refs/notes/chat/${msgId}`;

      // Get the commit SHA for this message
      const sha = await git.resolveRef({
        fs: this.fs,
        gitdir: this.gitdir,
        ref: noteRef,
      });

      // Delete the tag
      await git.deleteRef({
        fs: this.fs,
        gitdir: this.gitdir,
        ref: noteRef,
      });

      // Reset to master and then back to staging
      await git.checkout({
        fs: this.fs,
        dir: this.dir,
        ref: "master",
        force: true,
      });

      return sha;
    } catch (e) {
      console.error("Error dropping turn:", e);
      return false;
    }
  }

  /**
   * Approve changes by merging the staging branch into main
   */
  async approveChanges(): Promise<boolean> {
    try {
      // Checkout master
      await git.checkout({
        fs: this.fs,
        dir: this.dir,
        ref: "master",
        force: true,
      });

      // Get the current commit on master
      const mainSha = await git.resolveRef({
        fs: this.fs,
        gitdir: this.gitdir,
        ref: "master",
      });

      // Get the current commit on staging
      const stagingSha = await git.resolveRef({
        fs: this.fs,
        gitdir: this.gitdir,
        ref: "staging",
      });

      // If they're the same, nothing to do
      if (mainSha === stagingSha) {
        return true;
      }

      // Merge staging into main
      await git.merge({
        fs: this.fs,
        dir: this.dir,
        ours: "master",
        theirs: "staging",
        author: { name: "AI-Agent", email: "agent@example.com" },
      });

      return true;
    } catch (e) {
      console.error("Error approving changes:", e);
      return false;
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
          `Database "${dbName}" deletion blocked, likely due to open connections`
        );
        // You might want to notify the user to close other tabs using this database
      });
    });
  }
}
