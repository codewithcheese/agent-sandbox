import { vi } from "vitest";

// polyfill for grey-matter
import { Buffer } from "buffer";
if (typeof window !== "undefined" && typeof window.Buffer === "undefined") {
  window.Buffer = Buffer;
}

import matter from "gray-matter";

export const fileSystem = new Map<
  string,
  { content: string; metadata?: any }
>();
export const fileCache = new Map<string, any>();

export class MockTFile {
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

export const vault = {
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
    fileSystem.set(path, { content });

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

    return new MockTFile(path);
  },
  reset() {
    fileSystem.clear();
    fileCache.clear();
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
