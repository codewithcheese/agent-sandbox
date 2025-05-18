import * as git from "isomorphic-git";
import FS from "@isomorphic-git/lightning-fs";
import { nanoid } from "nanoid";
import { createDebug } from "$lib/debug.ts";
import { relative } from "path";

const debug = createDebug();

export class VersionControl {
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

  async append(path: string, content: string): Promise<void> {
    if (!path.startsWith("/")) {
      throw new Error("Path must be absolute");
    }
    await this.checkoutStaging();
    const data = await this.fs.promises.readFile(path, { encoding: "utf8" });
    await this.fs.promises.writeFile(path, data + content);
    await git.add({
      fs: this.fs,
      dir: this.dir,
      filepath: relative("/", path),
    });
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!path.startsWith("/")) {
      throw new Error("Path must be absolute");
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

  async createFolder(path: string): Promise<void> {
    if (!path.startsWith("/")) {
      throw new Error("Path must be absolute");
    }
    if (!path.endsWith("/")) {
      throw new Error("Folder must end with a slash");
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

    // write .gitkeep so that the folder will be tracked by git
    await this.fs.promises.writeFile(`${path}.gitkeep`, "");

    await git.add({
      fs: this.fs,
      dir: this.dir,
      filepath: relative("/", path),
    });
  }

  async deleteFile(path: string): Promise<void> {
    if (!path.startsWith("/")) {
      throw new Error("Path must be absolute");
    }

    await this.checkoutStaging();

    // Check if the file exists before attempting to delete it
    const exists = await this.fileExists(path);
    if (!exists) {
      throw new Error(`File ${path} does not exist.`);
    }

    try {
      await this.fs.promises.unlink(path);
      console.log(
        await git.status({
          fs: this.fs,
          dir: this.dir,
          filepath: relative("/", path),
        }),
      );
      await git.remove({
        fs: this.fs,
        dir: this.dir,
        filepath: relative("/", path),
      });
    } catch (error) {
      throw new Error(`Could not delete file ${path}: ${error.message}`);
    }
  }

  /**
   * Imports a file from the vault into the main branch of the Git repository.
   * This ensures the file exists in Git before operations are performed on it.
   * @param path Absolute path to the file
   * @param content Content of the file to import
   */
  async importFileToMain(path: string, content: string): Promise<void> {
    if (!path.startsWith("/")) {
      throw new Error("Path must be absolute");
    }

    // Save current branch to return to it later
    const currentBranch = await this.getCurrentBranch();

    try {
      // Checkout main branch
      await git.checkout({
        fs: this.fs,
        dir: this.dir,
        ref: "master",
        force: false,
      });

      // Write file and add to Git index
      await this.fs.promises.writeFile(path, content);
      await git.add({
        fs: this.fs,
        dir: this.dir,
        filepath: relative("/", path),
      });

      // Commit to main branch
      await git.commit({
        fs: this.fs,
        dir: this.dir,
        message: `Import ${path} from vault`,
        author: { name: "AI-Agent", email: "agent@example.com" },
      });

      // Checkout staging and merge changes from master
      await git.checkout({
        fs: this.fs,
        dir: this.dir,
        ref: "staging",
        force: false,
      });

      // Merge master into staging
      await git.merge({
        fs: this.fs,
        dir: this.dir,
        theirs: "master",
        author: { name: "AI-Agent", email: "agent@example.com" },
        message: `Merge master into staging after importing ${path}`,
      });
    } catch (error) {
      // If merge fails, we'll need to handle conflicts
      // For now, just throw an error
      throw new Error(
        `Merge conflict when importing ${path}: ${error.message}`,
      );
    }

    // Return to the original branch (usually staging)
    await git.checkout({
      fs: this.fs,
      dir: this.dir,
      ref: currentBranch,
      force: false,
    });
  }

  /**
   * Gets the current Git branch name
   * @returns Promise resolving to the current branch name
   */
  private async getCurrentBranch(): Promise<string> {
    const currentRef = await git.currentBranch({
      fs: this.fs,
      dir: this.dir,
      fullname: false,
    });

    return currentRef || "master"; // Default to master if no current branch
  }

  async rename(oldPath: string, path: string): Promise<void> {
    if (!oldPath.startsWith("/")) {
      throw new Error("Old path must be absolute");
    }
    if (!path.startsWith("/")) {
      throw new Error("New path must be absolute");
    }
    await this.checkoutStaging();
    await this.fs.promises.rename(oldPath, path);
    await git.add({
      fs: this.fs,
      dir: this.dir,
      filepath: relative("/", path),
    });
  }

  async fileExists(path: string): Promise<boolean> {
    if (!path.startsWith("/")) {
      throw new Error("Path must be absolute");
    }
    await this.checkoutStaging();
    try {
      await this.fs.promises.stat(path);
      return true;
    } catch (e) {
      return false;
    }
  }

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
