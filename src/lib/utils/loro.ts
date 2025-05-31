import { LoroText, LoroTreeNode } from "loro-crdt";

export function text(node: LoroTreeNode): string | undefined {
  return (node.data.get("text") as LoroText)?.toString();
}
