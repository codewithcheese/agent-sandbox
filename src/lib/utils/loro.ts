import { LoroText, LoroTreeNode } from "loro-crdt/base64";
import { decodeBase64, encodeBase64 } from "$lib/utils/base64.ts";
import type { FileStats } from "obsidian";
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
