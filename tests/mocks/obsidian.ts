import matter from "front-matter";
import type {
  DataWriteOptions,
  TAbstractFile,
  TFile,
  TFolder,
  Vault,
} from "obsidian";
import { fs } from "@zenfs/core";
import { normalizePath } from "./normalize-path.ts";
import { migrateToLatest } from "../../src/settings/migrator.ts";

// Set root as current directory so that paths don't require `/` prefix
try {
  globalThis.process.chdir("/");
} catch (e) {}

export const fileCache = new Map<string, any>();

// Simple requestUrl mock with hardcoded responses
export const mockRequestUrl = async (params: any) => {
  // Default successful response
  const defaultResponse = {
    status: 200,
    headers: { "content-type": "application/json" },
    text: '{"success": true, "data": "test"}',
    json: { success: true, data: "test" },
    arrayBuffer: new ArrayBuffer(0),
  };

  // Handle different URLs/scenarios
  if (params.url?.includes("localhost") || params.url?.includes("127.0.0.1")) {
    throw new Error("Network error - blocked domain");
  }

  if (params.url?.includes("error")) {
    throw new Error("Network error");
  }

  if (params.url?.includes("large")) {
    return {
      ...defaultResponse,
      text: "x".repeat(11 * 1024 * 1024), // 11MB response
    };
  }

  if (params.url?.includes("404")) {
    return {
      ...defaultResponse,
      status: 404,
      text: '{"error": "Resource not found"}',
      json: { error: "Resource not found" },
    };
  }

  // Return different content types based on headers or URL
  if (params.url?.includes("text")) {
    return {
      ...defaultResponse,
      headers: { "content-type": "text/plain" },
      text: "Hello World",
    };
  }

  if (params.url?.includes("users")) {
    return {
      ...defaultResponse,
      status: 201,
      headers: {
        "content-type": "application/json",
        "x-rate-limit": "100",
      },
      text: '{"id": 123, "name": "test"}',
      json: { id: 123, name: "test" },
    };
  }

  // Return the default response
  return defaultResponse;
};

/**
 * Parse frontmatter from content and cache it if present
 */
function parseFrontmatterAndCache(path: string, content: string) {
  const { attributes } = matter(content);
  fileCache.set(path, { frontmatter: attributes });
}

export class MockTAbstractFile implements TAbstractFile {
  path: string;
  name: string;
  vault: any;
  parent: any;

  constructor(path: string) {
    this.path = normalizePath(path);
    const parts = this.path.split("/");
    this.name = parts[parts.length - 1];
  }
}

export class MockTFile implements TFile {
  path: string;
  basename: string;
  extension: string;
  name: string;
  vault: any;
  parent: any;
  stat: { mtime: number; ctime: number; size: number };

  constructor(path: string) {
    this.path = normalizePath(path);
    const parts = this.path.split("/");
    const filename = parts[parts.length - 1];
    const filenameParts = filename.split(".");
    this.extension = filenameParts.length > 1 ? filenameParts.pop()! : "";
    this.basename = filenameParts.join(".");
    this.name = filename;

    // Get real stats from memfs if file exists
    try {
      const stats = fs.statSync(this.path);
      this.stat = {
        mtime: stats.mtimeMs || Date.now(),
        ctime: stats.ctimeMs || Date.now(),
        size: stats.size || 0,
      };
    } catch {
      this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
    }
  }
}

export class MockTFolder implements TFolder {
  path: string;
  name: string;
  vault: any;
  parent: any;
  basename: string;
  stat: { mtime: number; ctime: number; size: number };

  constructor(path: string) {
    this.path = normalizePath(path) || "/";
    const parts = this.path.split("/").filter(Boolean);
    this.name = parts[parts.length - 1] || "/";
    this.basename = this.name;

    // Get real stats from memfs if folder exists
    try {
      const stats = fs.statSync(this.path);
      this.stat = {
        mtime: stats.mtimeMs || Date.now(),
        ctime: stats.ctimeMs || Date.now(),
        size: stats.size || 0,
      };
    } catch {
      this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
    }
  }

  get children(): Array<MockTFile | MockTFolder> {
    const children: Array<MockTFile | MockTFolder> = [];

    try {
      const entries = fs.readdirSync(this.path, { withFileTypes: true });

      for (const entry of entries) {
        const childPath =
          this.path === "/" ? `/${entry.name}` : `${this.path}/${entry.name}`;

        if (entry.isDirectory()) {
          const folder = new MockTFolder(childPath);
          folder.vault = this.vault;
          folder.parent = this;
          children.push(folder);
        } else if (entry.isFile()) {
          const file = new MockTFile(childPath);
          file.vault = this.vault;
          file.parent = this;
          children.push(file);
        }
      }
    } catch {
      // Directory doesn't exist or other error
    }

    return children;
  }

  isRoot() {
    return this.path === "/";
  }
}

// Create root folder object
const rootFolder = new MockTFolder("/");

export const vault: Vault = {
  getName: () => "Mock Vault",
  configDir: "/mock-config",
  read: async (file: MockTFile) => {
    try {
      return fs.readFileSync(file.path, "utf8");
    } catch (error) {
      throw new Error(`File not found: ${file.path}`);
    }
  },
  readBinary: async (file: MockTFile): Promise<ArrayBuffer> => {
    try {
      const buffer = fs.readFileSync(file.path);
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    } catch (error) {
      throw new Error(`File not found: ${file.path}`);
    }
  },
  getFileByPath: (path: string) => {
    path = normalizePath(path);
    try {
      const stats = fs.statSync(path);
      if (stats.isFile()) {
        const file = new MockTFile(path);
        file.vault = vault;
        return file;
      }
    } catch {
      // File doesn't exist
    }
    return null;
  },
  getFolderByPath: (path: string) => {
    path = normalizePath(path) || "/";

    try {
      const stats = fs.statSync(path);
      if (stats.isDirectory()) {
        const folder = new MockTFolder(path);
        folder.vault = vault;
        return folder;
      }
    } catch {
      // Folder doesn't exist
    }

    // Always return root folder for root path
    if (path === "/") {
      return rootFolder;
    }

    return null;
  },
  getAbstractFileByPath: (path: string) => {
    path = normalizePath(path);

    try {
      const stats = fs.statSync(path);
      if (stats.isFile()) {
        const file = new MockTFile(path);
        file.vault = vault;
        return file;
      } else if (stats.isDirectory()) {
        const folder = new MockTFolder(path);
        folder.vault = vault;
        return folder;
      }
    } catch {
      // File/folder doesn't exist
    }

    return null;
  },
  getRoot: () => {
    return rootFolder;
  },
  create: async (path: string, content: string) => {
    path = normalizePath(path);

    // Ensure parent directory exists
    const parentPath = path.substring(0, path.lastIndexOf("/"));
    if (parentPath && parentPath !== "/") {
      try {
        fs.mkdirSync(parentPath, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }

    fs.writeFileSync(path, content, "utf8");
    const file = new MockTFile(path);
    file.vault = vault;

    // Parse frontmatter if present
    parseFrontmatterAndCache(path, content);

    // Set parent folder
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentPath = path.substring(0, lastSlash);
      file.parent = vault.getFolderByPath(parentPath);
    } else {
      file.parent = rootFolder;
    }

    return file;
  },
  createBinary: async (path: string, data: ArrayBuffer) => {
    path = normalizePath(path);

    // Ensure parent directory exists
    const parentPath = path.substring(0, path.lastIndexOf("/"));
    if (parentPath && parentPath !== "/") {
      try {
        fs.mkdirSync(parentPath, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }

    fs.writeFileSync(path, Buffer.from(data));
    const file = new MockTFile(path);
    file.vault = vault;

    // Set parent folder
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentPath = path.substring(0, lastSlash);
      file.parent = vault.getFolderByPath(parentPath);
    } else {
      file.parent = rootFolder;
    }

    return file;
  },
  createFolder: async (path: string) => {
    path = normalizePath(path);

    // Create the directory in memfs
    fs.mkdirSync(path, { recursive: true });

    const folder = new MockTFolder(path);
    folder.vault = vault;

    // Set parent folder
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentPath = path.substring(0, lastSlash);
      const parentFolder = vault.getFolderByPath(parentPath);
      if (parentFolder) {
        folder.parent = parentFolder;
      }
    } else {
      folder.parent = rootFolder;
    }

    return folder;
  },
  modify: async (file: MockTFile, content: string) => {
    fs.writeFileSync(file.path, content, "utf8");
  },
  modifyBinary(
    file: TFile,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    fs.writeFileSync(file.path, Buffer.from(data));
    return;
  },
  delete: async (file: MockTFile | MockTFolder) => {
    try {
      const stats = fs.statSync(file.path);
      if (stats.isDirectory()) {
        fs.rmSync(file.path, { recursive: true, force: true });
      } else {
        fs.unlinkSync(file.path);
      }
    } catch {
      // File/folder doesn't exist or other error
    }
  },
  rename: async (file: MockTFile | MockTFolder, newPath: string) => {
    newPath = normalizePath(newPath);

    // Ensure parent directory exists for new path
    const parentPath = newPath.substring(0, newPath.lastIndexOf("/"));
    if (parentPath && parentPath !== "/") {
      try {
        fs.mkdirSync(parentPath, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }

    try {
      fs.renameSync(file.path, newPath);
      file.path = newPath;
    } catch (error) {
      throw new Error(`Failed to rename ${file.path} to ${newPath}`);
    }
  },
  append: async (file: MockTFile, content: string) => {
    fs.appendFileSync(file.path, content, "utf8");
  },
  process: async (file: MockTFile, fn: (data: string) => string) => {
    const existingContent = fs.readFileSync(file.path, "utf8");
    const newContent = fn(existingContent);
    fs.writeFileSync(file.path, newContent, "utf8");
    return newContent;
  },

  // @ts-expect-error adapter missing props
  adapter: {
    read: async (path: string) => {
      try {
        return fs.readFileSync(path, "utf8");
      } catch (error) {
        throw new Error(`File not found: ${path}`);
      }
    },
    exists: async (path: string) => {
      try {
        fs.statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    write: async (path: string, content: string) => {
      fs.writeFileSync(path, content, "utf8");
    },
    mkdir: async (path: string) => {
      fs.mkdirSync(path, { recursive: true });
    },
    readBinary: async (path: string) => {
      try {
        const buffer = fs.readFileSync(path);
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        );
      } catch (error) {
        throw new Error(`File not found: ${path}`);
      }
    },
    writeBinary: async (path: string, data: ArrayBuffer) => {
      fs.writeFileSync(path, Buffer.from(data));
    },
    stat: async (path: string) => {
      try {
        const stat = fs.statSync(path);
        return {
          type: fs.statSync(path).isDirectory() ? "folder" : "file",
          mtime: stat.mtimeMs || Date.now(),
          ctime: stat.ctimeMs || Date.now(),
          size: stat.size || 0,
        };
      } catch (error) {
        throw new Error(`File not found: ${path}`);
      }
    },
  },

  // Helper method that returns all files from memfs
  getFiles: () => {
    const files: MockTFile[] = [];

    function traverse(dirPath: string) {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath =
            dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;
          if (entry.isFile()) {
            files.push(new MockTFile(fullPath));
          } else if (entry.isDirectory()) {
            traverse(fullPath);
          }
        }
      } catch {
        // Directory doesn't exist or other error
      }
    }

    traverse("/");
    return files;
  },
};

export const metadataCache = {
  getFileCache: (file: MockTFile) => {
    return fileCache.get(file.path) || null;
  },

  // Helper method for tests to set cache data
  setFileCache: (file: MockTFile, cache: any) => {
    fileCache.set(file.path, cache);
  },

  getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
    // Try exact path first
    const exactFile = vault.getFileByPath(linkpath);
    if (exactFile) {
      return exactFile;
    }

    // If not found by exact path, try to find by basename
    const allFiles = vault.getFiles();
    const filesByBasename = allFiles.filter((file) => {
      const basename = file.basename;
      return basename === linkpath;
    });

    // Return first match, or null if none found
    return filesByBasename.length > 0 ? filesByBasename[0] : null;
  },

  // Required MetadataCache properties with correct signatures
  getCache: (path: string) => {
    return fileCache.get(path) || null;
  },

  fileToLinktext: (
    file: MockTFile,
    sourcePath: string,
    omitMdExtension?: boolean,
  ) => {
    return omitMdExtension && file.extension === "md"
      ? file.basename
      : file.name;
  },

  resolvedLinks: {},
  unresolvedLinks: {},

  // Event system methods - unimplemented, throw errors
  on: (name: string, callback: Function, ctx?: any) => {
    throw new Error("MetadataCache.on() not implemented in mock");
  },

  off: (name: string, callback: Function, ctx?: any) => {
    throw new Error("MetadataCache.off() not implemented in mock");
  },

  offref: (ref: any) => {
    throw new Error("MetadataCache.offref() not implemented in mock");
  },

  // Other unimplemented methods
  trigger: (...args: any[]) => {
    throw new Error("MetadataCache.trigger() not implemented in mock");
  },

  tryTrigger: (...args: any[]) => {
    throw new Error("MetadataCache.tryTrigger() not implemented in mock");
  },
};

export const helpers = {
  addFile(path: string, content: string) {
    path = normalizePath(path);

    // Ensure parent directories exist
    const parentPath = path.substring(0, path.lastIndexOf("/"));
    if (parentPath && parentPath !== "/") {
      try {
        fs.mkdirSync(parentPath, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }

    // Write file to memfs
    fs.writeFileSync(path, content, { encoding: "utf8" });

    // Create file object
    const file = new MockTFile(path);
    file.vault = vault;

    // Parse frontmatter if present
    parseFrontmatterAndCache(path, content);

    return file;
  },

  addFolder(path: string) {
    path = normalizePath(path);

    // Create the directory in memfs
    fs.mkdirSync(path, { recursive: true });

    // Create folder object
    const folder = new MockTFolder(path);
    folder.vault = vault;

    return folder;
  },

  ensureParentFolders(path: string) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentPath = path.substring(0, lastSlash);

      // Create parent directory if it doesn't exist
      try {
        fs.mkdirSync(parentPath, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }
  },

  async reset() {
    // Clear the entire volume and recreate root
    fileCache.clear();
    try {
      fs.rmSync("/", { recursive: true, force: true });
    } catch (error) {
      // File/folder doesn't exist or other error
    }
    // Ensure root directory exists
    try {
      fs.mkdirSync("/", { recursive: true });
    } catch {
      // Textarea already exists
    }
  },
};

export const app = {
  vault,
  metadataCache,
  workspace: {
    getLeavesOfType: (type: string) => {
      return [];
    },
  }
};

const settings = migrateToLatest({});

export const plugin = {
  app,
  manifest: { dir: "test-dir" },
  settings: settings,
  loadSettings: () => settings,

};

window.Env = {
  Plugin: plugin,
};

export default {
  normalizePath: (path: string) => path,
  requestUrl: mockRequestUrl,

  Plugin: class {
    app = app;
    manifest = { dir: "test-dir" };
  },
};
