import { decodeBase64, encodeBase64 } from "$lib/utils/base64.ts";
import type { DataWriteOptions, FileStats } from "obsidian";
import {
  deletedFrom,
  isDirectoryKey,
  type NodeData,
} from "../../chat/tree-fs.ts";

export type FileContent =
  | { type: "text"; content: string }
  | { type: "binary" }
  | { type: "missing" };

// Type for TreeNodeProxy (VaultState nodes)
type TreeNodeLike = {
  data: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
};

export function getText(node: TreeNodeLike): string | undefined {
  const text = node.data.get("text");
  return typeof text === "string" ? text : undefined;
}

export function getBuffer(node: TreeNodeLike): ArrayBuffer | undefined {
  const buf = node.data.get("buffer");
  return buf instanceof ArrayBuffer ? buf : undefined;
}

export function updateText(node: TreeNodeLike, text: string) {
  node.data.set("text", text);
}

export function replaceBuffer(node: TreeNodeLike, buffer: ArrayBuffer) {
  node.data.set("buffer", buffer);
}

export function replaceText(node: TreeNodeLike, text: string) {
  node.data.delete("text");
  node.data.set("text", text);
}

export function getNodeData(node: TreeNodeLike): NodeData {
  return {
    isDirectory: isDirectory(node) || undefined,
    text: getText(node),
    buffer: getBuffer(node),
    stat: getStat(node),
  };
}

export function getStat(node: TreeNodeLike): FileStats | undefined {
  return node.data.get("stat") as FileStats | undefined;
}

export function setStat(node: TreeNodeLike, stat: FileStats) {
  node.data.set("stat", stat);
}

export function isDirectory(node: TreeNodeLike): boolean {
  return node.data.get(isDirectoryKey) === true;
}

export function setDirectory(node: TreeNodeLike, isDirectory: boolean) {
  node.data.set(isDirectoryKey, isDirectory);
}

export function setDeletedFrom(node: TreeNodeLike, path: string) {
  node.data.set(deletedFrom, path);
}

export function getDeletedFrom(node: TreeNodeLike): string | undefined {
  return node.data.get(deletedFrom) as string | undefined;
}

export function getName(node: TreeNodeLike): string {
  return node.data.get("name") as string;
}

export function setName(node: TreeNodeLike, name: string) {
  node.data.set("name", name);
}

export function createStat(
  size: number,
  options?: DataWriteOptions,
): FileStats {
  return {
    size,
    mtime: Date.now(),
    ctime: Date.now(),
    ...(options ?? {}),
  };
}

export function isTrashed(node: TreeNodeLike): boolean {
  return !!getDeletedFrom(node);
}

export function hasContentChanged(
  trackingNode: TreeNodeLike,
  proposedNode: TreeNodeLike,
): boolean {
  const proposedIsDirectory = isDirectory(proposedNode); // Using helper
  if (proposedIsDirectory) {
    // Directories don't have "content" in the same way files do for this comparison.
    // If directory metadata (like name, which is handled by rename) or children changes,
    // those are separate concerns.
    return false;
  }

  // Ensure trackingNode is also a file for a meaningful content comparison.
  // If trackingNode was a directory and proposedNode (same ID) is a file,
  // that's a fundamental type change, definitely "modified".
  const trackingIsDirectory = isDirectory(trackingNode); // Using helper
  if (trackingIsDirectory) {
    // This scenario (same ID, type changes from dir to file) is unusual but would be a modification.
    return true;
  }

  // Compare text content
  const trackingText = getText(trackingNode); // Using helper
  const proposedText = getText(proposedNode); // Using helper

  if (trackingText !== proposedText) {
    // Further check: if one is undefined and the other is an empty string, consider them the same.
    // This handles cases where a file might be newly created with empty content vs. not having text.
    if (
      !(
        (trackingText === undefined && proposedText === "") ||
        (trackingText === "" && proposedText === undefined)
      )
    ) {
      return true;
    }
  }

  // Compare binary buffer
  const trackingBuffer = getBuffer(trackingNode); // Using helper
  const proposedBuffer = getBuffer(proposedNode); // Using helper

  // Direct ArrayBuffer comparison is tricky. For simplicity, if they are different objects,
  // assume changed. For more robust comparison, you might compare byte-by-byte or length + checksum.
  // Your current getBuffer likely returns new ArrayBuffer instances from decodeBase64.
  // So, we need to compare their content if both exist.
  if (trackingBuffer && proposedBuffer) {
    if (trackingBuffer.byteLength !== proposedBuffer.byteLength) {
      return true;
    }
    // Simple byte-by-byte comparison for ArrayBuffers
    const trackingView = new Uint8Array(trackingBuffer);
    const proposedView = new Uint8Array(proposedBuffer);
    for (let i = 0; i < trackingBuffer.byteLength; i++) {
      if (trackingView[i] !== proposedView[i]) {
        return true;
      }
    }
  } else if (trackingBuffer !== proposedBuffer) {
    // Handles one being defined and the other not
    return true;
  }

  return false;
}

export function getFileContent(node: TreeNodeLike | null | undefined): FileContent {
  if (!node) return { type: "missing" };

  const text = getText(node);
  if (text === null || text === undefined) return { type: "binary" };

  return { type: "text", content: text };
}
