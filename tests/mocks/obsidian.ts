console.log("loading mock obsidian");

import { vi } from "vitest";

const fileSystem = new Map<string, { content: string; metadata?: any }>();
const fileCache = new Map<string, any>();

class MockTFile {
  path: string;
  basename: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    const parts = path.split("/");
    const filename = parts[parts.length - 1];
    const filenameParts = filename.split(".");
    this.extension = filenameParts.length > 1 ? filenameParts.pop()! : "";
    this.basename = filenameParts.join(".");
  }
}

// Clear any existing data
fileSystem.clear();
fileCache.clear();

const vault = {
  read: vi.fn(async (file: MockTFile) => {
    const fileData = fileSystem.get(file.path);
    if (!fileData) {
      throw new Error(`File not found: ${file.path}`);
    }
    return fileData.content;
  }),
  getFileByPath: vi.fn((path: string) => {
    if (fileSystem.has(path)) {
      return new MockTFile(path);
    }
    return null;
  }),
  getAbstractFileByPath: vi.fn((path: string) => {
    if (fileSystem.has(path)) {
      return new MockTFile(path);
    }
    return null;
  }),
  create: vi.fn(async (path: string, content: string) => {
    fileSystem.set(path, { content });
    return new MockTFile(path);
  }),
  createFolder: vi.fn(async (path: string) => {
    // Mark that the directory exists by adding an empty file
    fileSystem.set(path + "/.dir", { content: "" });
    return true;
  }),
  modify: vi.fn(async (file: MockTFile, content: string) => {
    fileSystem.set(file.path, { content });
    return file;
  }),
  delete: vi.fn(async (file: MockTFile) => {
    fileSystem.delete(file.path);
  }),

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
      return true;
    }),
    readBinary: vi.fn(async (path: string) => {
      const fileData = fileSystem.get(path);
      if (!fileData) {
        throw new Error(`File not found: ${path}`);
      }
      // Convert string to ArrayBuffer for binary data simulation
      return new TextEncoder().encode(fileData.content).buffer;
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

const metadataCache = {
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

const app = {
  vault,
  metadataCache,
};

const plugin = {
  app,
  manifest: { dir: "test-dir" },
};

const obsidian = {
  normalizePath: (path: string) => path,

  Plugin: class {
    app = app;
    manifest = { dir: "test-dir" };
  },

  get app() {
    return app;
  },
  get vault() {
    return vault;
  },
  get metadataCache() {
    return metadataCache;
  },
};

// @ts-expect-error see `./src/obsidian.ts` usage in vite.config.ts, its an obsidian module proxy for loading via vite dev server
window.obsidianAPI = obsidian;

vi.mock("obsidian", () => obsidian);

window.Env = {
  Plugin: plugin,
};

// Return the mock environment for tests to use
export default {
  vault: vault,
  metadataCache: metadataCache,
  app: app,
  plugin: plugin,
  // Helper methods for tests
  helpers: {
    // Add a file to the mock vault with optional metadata
    addFile: (path: string, content: string, metadata?: any) => {
      fileSystem.set(path, { content });
      if (metadata) {
        fileCache.set(path, metadata);
      }
      return new MockTFile(path);
    },
    // Get the in-memory file system for inspection
    getFileSystem: () => fileSystem,
    // Get the in-memory file cache for inspection
    getFileCache: () => fileCache,
    // Clear all files and cache
    clear: () => {
      fileSystem.clear();
      fileCache.clear();
    },
  },
};
