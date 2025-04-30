// Utility for extracting lists from frontmatter fields
export function getListFromFrontmatter(metadata: any, key: string): string[] {
  if (!metadata?.frontmatter || !metadata.frontmatter[key]) {
    return [];
  }
  if (typeof metadata.frontmatter[key] === "string") {
    return [metadata.frontmatter[key]];
  } else if (Array.isArray(metadata.frontmatter[key])) {
    return metadata.frontmatter[key];
  }
  return [];
}
