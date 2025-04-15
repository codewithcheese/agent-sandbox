// Utility for resolving Obsidian-style internal links
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
