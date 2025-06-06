import { LoroText, LoroTreeNode } from "loro-crdt/base64";
import { decodeBase64, encodeBase64 } from "$lib/utils/base64.ts";
import type { DataWriteOptions, FileStats } from "obsidian";
import type { NodeData } from "../../chat/tree-fs.ts";

const trashPath = ".overlay-trash" as const;
const deletedFrom = "deletedFrom" as const;
export const isDirectoryKey = "isDirectory" as const;

export function getText(node: LoroTreeNode): string | undefined {
  return (node.data.get("text") as LoroText)?.toString();
}

export function getBuffer(node: LoroTreeNode): ArrayBuffer | undefined {
  const enc = node.data.get("buffer") as string | undefined;
  return enc && decodeBase64(enc);
}

export function updateText(node: LoroTreeNode, text: string) {
  const txtC = node.data.get("text") as LoroText;
  // Loro recommends updateByLine for texts > 50_000 characters
  if (text.length > 50_000) {
    txtC.updateByLine(text);
  } else {
    txtC.update(text);
  }
}

export function replaceBuffer(node: LoroTreeNode, buffer: ArrayBuffer) {
  node.data.set("buffer", encodeBase64(buffer));
}

export function replaceText(node: LoroTreeNode, text: string) {
  node.data.delete("text");
  const txtC = node.data.setContainer("text", new LoroText());
  txtC.insert(0, text);
}

export function getNodeData(node: LoroTreeNode): NodeData {
  return {
    isDirectory: isDirectory(node) || undefined,
    text: getText(node),
    buffer: getBuffer(node),
    stat: getStat(node),
  };
}

export function getStat(node: LoroTreeNode): FileStats | undefined {
  return node.data.get("stat") as FileStats | undefined;
}

export function setStat(node: LoroTreeNode, stat: FileStats) {
  node.data.set("stat", stat);
}

export function isDirectory(node: LoroTreeNode): boolean {
  return node.data.get("isDirectory") === true;
}

export function setDirectory(node: LoroTreeNode, isDirectory: boolean) {
  node.data.set("isDirectory", isDirectory);
}

export function setDeletedFrom(node: LoroTreeNode, path: string) {
  node.data.set(deletedFrom, path);
}

export function getDeletedFrom(node: LoroTreeNode): string | undefined {
  return node.data.get(deletedFrom) as string | undefined;
}

export function getName(node: LoroTreeNode): string {
  return node.data.get("name") as string;
}

export function setName(node: LoroTreeNode, name: string) {
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

export function isTrashed(node: LoroTreeNode): boolean {
  return !!getDeletedFrom(node);
}

export function hasContentChanged(
  trackingNode: LoroTreeNode,
  proposedNode: LoroTreeNode,
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
