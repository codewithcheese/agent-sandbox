/**
 * Utility functions for working with TreeNode data.
 * These functions provide a clean API for accessing and modifying node data.
 */

import type { FileStats, DataWriteOptions } from "obsidian";
import type { TreeNode } from "../../chat/vault-state/tree-node.ts";
import type { NodeData } from "../../chat/vault-state/types.ts";
import { DELETED_FROM_KEY, WAS_CREATED_KEY, TRASH_FOLDER, TMP_FOLDER } from "../../chat/vault-state/types.ts";

export type FileContent =
  | { type: "text"; content: string }
  | { type: "binary" }
  | { type: "missing" };

// Re-export constants for convenience
export { DELETED_FROM_KEY, WAS_CREATED_KEY, TRASH_FOLDER, TMP_FOLDER };

export function getText(node: TreeNode): string | undefined {
  const text = node.data.text;
  return typeof text === "string" ? text : undefined;
}

export function getBuffer(node: TreeNode): ArrayBuffer | undefined {
  const buf = node.data.buffer;
  return buf instanceof ArrayBuffer ? buf : undefined;
}

export function updateText(node: TreeNode, text: string) {
  node.modify({ text });
}

export function replaceBuffer(node: TreeNode, buffer: ArrayBuffer) {
  node.modify({ buffer });
}

export function replaceText(node: TreeNode, text: string) {
  node.modify({ text });
}

/**
 * Core node data without the name field (since name is derived from path).
 * This type avoids the index signature in NodeData for better type safety.
 */
export interface NodeDataWithoutName {
  isDirectory: boolean;
  text?: string;
  buffer?: ArrayBuffer;
  stat?: FileStats;
}

export function getNodeData(node: TreeNode): NodeDataWithoutName {
  return {
    isDirectory: node.data.isDirectory ?? false,
    text: getText(node),
    buffer: getBuffer(node),
    stat: getStat(node),
  };
}

export function getStat(node: TreeNode): FileStats | undefined {
  return node.data.stat as FileStats | undefined;
}

export function setStat(node: TreeNode, stat: FileStats) {
  node.modify({ stat });
}

export function isDirectory(node: TreeNode): boolean {
  return node.data.isDirectory === true;
}

export function setDirectory(node: TreeNode, isDir: boolean) {
  node.modify({ isDirectory: isDir });
}

export function setDeletedFrom(node: TreeNode, path: string) {
  node.modify({ [DELETED_FROM_KEY]: path });
}

export function getDeletedFrom(node: TreeNode): string | undefined {
  return node.data[DELETED_FROM_KEY] as string | undefined;
}

export function getName(node: TreeNode): string {
  return node.data.name;
}

export function setName(node: TreeNode, name: string) {
  node.modify({ name });
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

export function isTrashed(node: TreeNode): boolean {
  return !!getDeletedFrom(node);
}

export function hasContentChanged(
  trackingNode: TreeNode,
  proposedNode: TreeNode,
): boolean {
  const proposedIsDirectory = isDirectory(proposedNode);
  if (proposedIsDirectory) {
    // Directories don't have "content" in the same way files do for this comparison.
    return false;
  }

  // Ensure trackingNode is also a file for a meaningful content comparison.
  const trackingIsDirectory = isDirectory(trackingNode);
  if (trackingIsDirectory) {
    // Type change from dir to file is a modification.
    return true;
  }

  // Compare text content
  const trackingText = getText(trackingNode);
  const proposedText = getText(proposedNode);

  if (trackingText !== proposedText) {
    // Handle cases where a file might be newly created with empty content vs. not having text.
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
  const trackingBuffer = getBuffer(trackingNode);
  const proposedBuffer = getBuffer(proposedNode);

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

export function getFileContent(node: TreeNode | null | undefined): FileContent {
  if (!node) return { type: "missing" };

  const text = getText(node);
  if (text === null || text === undefined) return { type: "binary" };

  return { type: "text", content: text };
}
