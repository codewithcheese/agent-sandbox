import { encodeBase64 } from "$lib/utils/base64.ts";
import { extensionToMimeType } from "$lib/utils/mime.ts";
import { usePlugin } from "$lib/utils";
import type { FileUIPart } from "ai";

export async function loadFileParts(paths: string[]): Promise<FileUIPart[]> {
  const plugin = usePlugin();
  const files: FileUIPart[] = [];
  if (paths.length > 0) {
    for (const path of paths) {
      try {
        const file = plugin.app.vault.getFileByPath(path);
        if (!file) {
          throw new Error(`Attachment not found: ${path}`);
        }
        let data;
        let mediaType;
        if (
          IMAGE_EXTENSIONS.has(file.extension) ||
          BINARY_EXTENSIONS_NO_IMAGE.has(file.extension)
        ) {
          data = await plugin.app.vault.readBinary(file);
          mediaType = extensionToMimeType(file.extension);
        } else if (["md"].includes(file.extension)) {
          // Read markdown files use read
          data = await plugin.app.vault.read(file);
          mediaType = "text/plain";
        } else {
          // Unknown extension must be read as binary in Obsidian
          data = await plugin.app.vault.readBinary(file);
          mediaType = "text/plain";
        }
        const base64 = encodeBase64(data);
        files.push({
          type: "file",
          filename: path,
          mediaType,
          url: `data:${mediaType};base64,${base64}`,
        });
      } catch (error) {
        console.error("Failed to load attachment data:", error);
      }
    }
  }
  return files;
}

export const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
]);

export const BINARY_EXTENSIONS_NO_IMAGE = new Set([
  "mp3",
  "wav",
  "flac",
  "ogg",
  "aac",
  "m4a",
  "wma",
  "aiff",
  "opus",
  "mp4",
  "avi",
  "mov",
  "wmv",
  "flv",
  "mkv",
  "webm",
  "m4v",
  "mpeg",
  "mpg",
  "zip",
  "rar",
  "tar",
  "gz",
  "bz2",
  "7z",
  "xz",
  "z",
  "tgz",
  "iso",
  "exe",
  "dll",
  "so",
  "dylib",
  "app",
  "msi",
  "deb",
  "rpm",
  "bin",
  "dat",
  "db",
  "sqlite",
  "sqlite3",
  "mdb",
  "idx",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "psd",
  "ai",
  "eps",
  "sketch",
  "fig",
  "xd",
  "blend",
  "obj",
  "3ds",
  "max",
  "class",
  "jar",
  "war",
  "pyc",
  "pyo",
  "rlib",
  "swf",
  "fla",
]);
