import { LoroText, LoroTreeNode } from "loro-crdt";
import { decodeBase64 } from "$lib/utils/base64.ts";

export function text(node: LoroTreeNode): string | undefined {
  return (node.data.get("text") as LoroText)?.toString();
}

export function buffer(node: LoroTreeNode): ArrayBuffer | undefined {
  const enc = node.data.get("buffer") as string | undefined;
  return enc && decodeBase64(enc);
}
