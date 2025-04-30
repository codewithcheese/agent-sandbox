// Utility for resolving Obsidian-style internal links
import { WorkspaceLeaf } from "obsidian";
import { usePlugin } from "$lib/utils/index.ts";

export function resolveInternalLink(toolLink: string, plugin: any): any {
  // Only process internal links [[path/to/tool]]
  const internalLinkMatch = toolLink.match(/\[\[([^\]]+)\]\]/);
  if (!internalLinkMatch) {
    return undefined;
  }
  const [, linkText] = internalLinkMatch;
  const toolPath = linkText.split("|")[0];
  // Get the target file using Obsidian's link resolution
  // This handles shortest path matching and spaces in filenames
  return plugin.app.metadataCache.getFirstLinkpathDest(toolPath, "");
}

/**
 * Attempt to locate the “center leaf” by:
 * 1) Checking the workspace’s root split;
 * 2) Picking the middle child of that root split;
 * 3) Recursively drilling down until we find a real leaf.
 */
export function findCenterLeaf(): WorkspaceLeaf | null {
  // The rootSplit is typically a WorkspaceSplit, though it can sometimes be null
  const plugin = usePlugin();
  const rootSplit = plugin.app.workspace.rootSplit;
  if (!rootSplit) {
    return null;
  }

  // If there are no child splits/leaves, nothing to do
  if (rootSplit.children.length === 0) {
    return null;
  }

  // Choose the middle child index (for 3 children → index 1; for 5 → index 2, etc.)
  // If there are only 2 children, “middle” becomes index 1 (the second child).
  const middleIndex = Math.floor(rootSplit.children.length / 2);
  const middleChild = rootSplit.children[middleIndex];

  // Recursively find an actual leaf within that child
  return findFirstLeaf(middleChild);
}

/**
 * Given either a WorkspaceSplit or a WorkspaceLeaf, return
 * the first actual leaf we find. If the node is already a leaf,
 * we return it immediately.
 */
export function findFirstLeaf(node: WorkspaceLeaf): WorkspaceLeaf | null {
  if (node instanceof WorkspaceLeaf) {
    // We’ve found a real leaf
    return node;
  }
  // Otherwise, node is another split: check its children, in order
  // @ts-expect-error children not typed
  for (const child of node.children) {
    const found = findFirstLeaf(child);
    if (found) {
      return found;
    }
  }
  return null;
}
