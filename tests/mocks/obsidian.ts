import { vi } from "vitest";

// polyfill for grey-matter
import { Buffer } from "buffer";
if (typeof window !== "undefined" && typeof window.Buffer === "undefined") {
  window.Buffer = Buffer;
}

import matter from "gray-matter";
import type { TFile, TFolder, TAbstractFile, Vault } from "obsidian";
import { normalizePath } from "./normalize-path.ts";

export const fileSystem = new Map<
  string,
  { content: string; metadata?: any }
>();
export const fileCache = new Map<string, any>();

export class MockTFile implements TFile {
  path: string;
  basename: string;
  extension: string;
  name: string;
  vault: any;
  parent: any;
  stat: { mtime: number; ctime: number; size: number };

  constructor(path: string) {
    this.path = path;
    const parts = path.split("/");
    const filename = parts[parts.length - 1];
    const filenameParts = filename.split(".");
    this.extension = filenameParts.length > 1 ? filenameParts.pop()! : "";
    this.basename = filenameParts.join(".");
    this.name = filename;
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
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
    this.path = path;
    const parts = path.split("/");
    this.name = parts[parts.length - 1] || "/";
    this.basename = this.name;
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
  }

  get children(): Array<MockTFile | MockTFolder> {
    const children: Array<MockTFile | MockTFolder> = [];
    const folderPath = this.path === "/" ? "" : this.path;
    
    // Find all files that are direct children of this folder
    for (const [filePath] of fileSystem) {
      const normalizedFilePath = normalizePath(filePath);
      if (normalizedFilePath.startsWith(folderPath + "/")) {
        const relativePath = normalizedFilePath.slice(folderPath.length + 1);
        // Only direct children (no additional slashes)
        if (!relativePath.includes("/")) {
          const file = new MockTFile(normalizedFilePath);
          file.vault = this.vault;
          file.parent = this;
          children.push(file);
        }
      }
    }
    
    // Find all folders that are direct children of this folder
    for (const [subFolderPath, subFolder] of folderSystem) {
      if (subFolderPath !== this.path && subFolderPath.startsWith(folderPath + "/")) {
        const relativePath = subFolderPath.slice(folderPath.length + 1);
        // Only direct children (no additional slashes)
        if (!relativePath.includes("/")) {
          subFolder.parent = this;
          children.push(subFolder);
        }
      }
    }
    
    return children;
  }

  isRoot() {
    return this.path === "" || this.path === "/";
  }
}

// Keep track of folders separately from files
export const folderSystem = new Map<string, MockTFolder>();

// Create root folder
const rootFolder = new MockTFolder("/");
folderSystem.set("/", rootFolder);

export const vault: Vault = {
  getName: vi.fn(() => "Mock Vault"),
  configDir: "/mock-config",
  read: vi.fn(async (file: MockTFile) => {
    const fileData = fileSystem.get(file.path);
    if (!fileData) {
      throw new Error(`File not found: ${file.path}`);
    }
    return fileData.content;
  }),
  getFileByPath: vi.fn((path: string) => {
    path = normalizePath(path);
    if (fileSystem.has(path)) {
      const file = new MockTFile(path);
      file.vault = vault;
      return file;
    }
    return null;
  }),
  getFolderByPath: vi.fn((path: string) => {
    path = normalizePath(path) || "/";

    // Check if folder exists
    if (folderSystem.has(path)) {
      return folderSystem.get(path);
    }

    // Check if it's the root folder
    if (path === "/") {
      return rootFolder;
    }

    return null;
  }),
  getAbstractFileByPath: vi.fn((path: string) => {
    path = normalizePath(path);

    if (fileSystem.has(path)) {
      const file = new MockTFile(path);
      file.vault = vault;
      return file;
    }

    // Check if it's a folder
    if (folderSystem.has(path)) {
      return folderSystem.get(path);
    }

    return null;
  }),
  getRoot: vi.fn(() => {
    return rootFolder;
  }),
  create: vi.fn(async (path: string, content: string) => {
    fileSystem.set(path, { content });
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
  }),
  createFolder: vi.fn(async (path: string) => {
    // Create the folder
    const folder = new MockTFolder(path);
    folder.vault = vault;
    folderSystem.set(path, folder);

    // Set parent folder
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentPath = path.substring(0, lastSlash);
      const parentFolder = vault.getFolderByPath(parentPath);
      if (parentFolder) {
        folder.parent = parentFolder;
        parentFolder.children.push(folder);
      }
    } else {
      folder.parent = rootFolder;
      rootFolder.children.push(folder);
    }

    // Mark that the directory exists by adding an empty file
    fileSystem.set(path + "/.dir", { content: "" });
    return folder;
  }),
  modify: vi.fn(async (file: MockTFile, content: string) => {
    fileSystem.set(file.path, { content });
  }),
  delete: vi.fn(async (file: MockTFile | MockTFolder) => {
    if (file instanceof MockTFile) {
      fileSystem.delete(file.path);
    } else {
      // Delete folder and all its contents
      folderSystem.delete(file.path);
      // Remove any files that start with this path
      for (const filePath of fileSystem.keys()) {
        if (filePath.startsWith(file.path + "/")) {
          fileSystem.delete(filePath);
        }
      }
    }
  }),
  rename: vi.fn(async (file: MockTFile | MockTFolder, newPath: string) => {
    if (file instanceof MockTFile) {
      const content = fileSystem.get(file.path)?.content || "";
      fileSystem.delete(file.path);
      fileSystem.set(newPath, { content });
    } else {
      // Rename folder
      const folder = folderSystem.get(file.path);
      if (folder) {
        folderSystem.delete(file.path);
        folder.path = newPath;
        folderSystem.set(newPath, folder);
      }
    }
  }),
  append: vi.fn(async (file: MockTFile, content: string) => {
    const existingContent = fileSystem.get(file.path)?.content || "";
    fileSystem.set(file.path, { content: existingContent + content });
  }),
  process: vi.fn(async (file: MockTFile, fn: (data: string) => string) => {
    const existingContent = fileSystem.get(file.path)?.content || "";
    const newContent = fn(existingContent);
    fileSystem.set(file.path, { content: newContent });
    return newContent;
  }),

  // @ts-expect-error adapater missing props
  adapter: {
    read: vi.fn(async (path: string) => {
      const fileData = fileSystem.get(path);
      if (!fileData) {
        throw new Error(`File not found: ${path}`);
      }
      return fileData.content;
    }),
    exists: vi.fn(async (path: string) => {
      return fileSystem.has(path);
    }),
    write: vi.fn(async (path: string, content: string) => {
      fileSystem.set(path, { content });
    }),
    mkdir: vi.fn(async (path: string) => {
      // Just mark that the directory exists by adding an empty file
      fileSystem.set(path + "/.dir", { content: "" });
    }),
    readBinary: vi.fn(async (path: string) => {
      const fileData = fileSystem.get(path);
      if (!fileData) {
        throw new Error(`File not found: ${path}`);
      }
      // Convert string to ArrayBuffer for binary data simulation
      return new TextEncoder().encode(fileData.content).buffer as ArrayBuffer;
    }),
    writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
      // Convert ArrayBuffer to string for storage
      const content = new TextDecoder().decode(data);
      fileSystem.set(path, { content });
    }),
  },

  // Helper method that just returns data from our in-memory store
  getFiles: () => {
    return Array.from(fileSystem.keys()).map((path) => new MockTFile(path));
  },
};

export const metadataCache = {
  getFileCache: vi.fn((file: MockTFile) => {
    return fileCache.get(file.path);
  }),

  // Helper method for tests to set cache data
  setFileCache: (file: MockTFile, cache: any) => {
    fileCache.set(file.path, cache);
  },

  getFirstLinkpathDest: vi.fn(),
  on: vi.fn(),
};

export const app = {
  vault,
  metadataCache,
};

export const plugin = {
  app,
  manifest: { dir: "test-dir" },
};

export const helpers = {
  addFile(path: string, content: string) {
    path = normalizePath(path);
    fileSystem.set(path, { content });

    // Create file object
    const file = new MockTFile(path);
    file.vault = vault;

    // Ensure parent folders exist
    this.ensureParentFolders(path);

    // Parse frontmatter if present
    if (content) {
      try {
        const { data } = matter(content);
        if (Object.keys(data).length > 0) {
          fileCache.set(path, { frontmatter: data });
        }
      } catch (error) {
        console.warn(`Failed to parse frontmatter for ${path}:`, error);
      }
    }

    return file;
  },

  addFolder(path: string) {
    // Create the folder
    const folder = new MockTFolder(path);
    folder.vault = vault;
    folderSystem.set(path, folder);

    // Ensure parent folders exist
    this.ensureParentFolders(path);

    return folder;
  },

  ensureParentFolders(path: string) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentPath = path.substring(0, lastSlash);

      // Create parent folder if it doesn't exist
      if (!folderSystem.has(parentPath)) {
        this.addFolder(parentPath);
      }

      // Set parent-child relationship
      const file = vault.getFileByPath(path);
      const folder = folderSystem.get(parentPath);

      if (file && folder) {
        file.parent = folder;
      }
    }
  },

  reset() {
    fileSystem.clear();
    fileCache.clear();
    folderSystem.clear();

    // Recreate root folder
    const root = new MockTFolder("/");
    root.vault = vault;
    folderSystem.set("/", root);
  },
};

// mock useProxy in src/utils/execute.ts
window.Env = {
  Plugin: plugin,
};

export default {
  normalizePath: (path: string) => path,

  Plugin: class {
    app = app;
    manifest = { dir: "test-dir" };
  },
};
