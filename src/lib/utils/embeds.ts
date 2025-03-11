import { TFile } from "obsidian";
import { usePlugin } from "./index";

/**
 * Strip frontmatter from content
 * @param content Content to strip frontmatter from
 * @returns Content without frontmatter
 */
export function stripFrontMatter(content: string): string {
  // Match YAML frontmatter between --- delimiters at the start of the content
  const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
  return content.replace(frontmatterRegex, '');
}

/**
 * Process Obsidian-style embeds in the content
 * @param sourceFile The source file containing the embeds, used for resolving relative paths
 * @param content Content to process
 * @returns Content with embeds resolved
 */
export async function processEmbeds(
  sourceFile: TFile,
  content: string,
): Promise<string> {
  const plugin = usePlugin();
  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  let match;
  let processedContent = content;

  while ((match = embedRegex.exec(content)) !== null) {
    const [fullMatch, path] = match;
    try {
      // Use Obsidian's getLinkpath to resolve the path relative to the source file
      const targetPath = plugin.app.metadataCache.getFirstLinkpathDest(
        path,
        sourceFile.path,
      );
      if (!targetPath) {
        console.warn(`File not found: ${path} (resolved to ${targetPath})`);
        continue;
      }
      // Read the file content
      const fileContent = await plugin.app.vault.read(targetPath);
      // Replace the embed with the file content
      processedContent = processedContent.replace(fullMatch, fileContent);
    } catch (error) {
      console.error(`Error processing embed ${path}:`, error);
    }
  }

  return processedContent;
}

/**
 * Process Obsidian-style links in the content
 * @param sourceFile The source file containing the links, used for resolving relative paths
 * @param content Content to process
 * @returns Content with links resolved
 */
export async function processLinks(
  sourceFile: TFile,
  content: string,
): Promise<string> {
  const plugin = usePlugin();
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  let match;
  let processedContent = content;

  while ((match = linkRegex.exec(content)) !== null) {
    const [fullMatch, path] = match;
    try {
      // Use Obsidian's getLinkpath to resolve the path relative to the source file
      const targetPath = plugin.app.metadataCache.getFirstLinkpathDest(
        path,
        sourceFile.path,
      );
      if (!targetPath) {
        console.warn(`File not found: ${path} (resolved to ${targetPath})`);
        continue;
      }
      // Read the file content
      const fileContent = await plugin.app.vault.read(targetPath);
      // Replace the link with the file content
      processedContent = processedContent.replace(fullMatch, fileContent);
    } catch (error) {
      console.error(`Error processing link ${path}:`, error);
    }
  }

  return processedContent;
}
