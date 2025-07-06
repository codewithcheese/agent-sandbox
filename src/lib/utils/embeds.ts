import { TFile, type Vault, type MetadataCache } from "obsidian";
import { usePlugin } from "./index";
import { stripFrontmatter } from "../../chat/system.ts";

export async function processEmbeds(
  sourceFile: TFile,
  content: string,
  vault: Vault,
  metadataCache: MetadataCache,
): Promise<string> {
  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  let match;
  let processedContent = content;

  while ((match = embedRegex.exec(content)) !== null) {
    const [fullMatch, path] = match;
    try {
      // Use overlay-aware metadata cache to resolve the path relative to the source file
      const targetPath = metadataCache.getFirstLinkpathDest(
        path,
        sourceFile.path,
      );
      if (!targetPath) {
        console.warn(`File not found: ${path} (resolved to ${targetPath})`);
        continue;
      }
      // Read the file content using overlay-aware vault
      const fileContent = await vault.read(targetPath);
      // Replace the embed with the file content
      processedContent = processedContent.replace(
        fullMatch,
        stripFrontmatter(fileContent),
      );
    } catch (error) {
      console.error(`Error processing embed ${path}:`, error);
    }
  }

  return processedContent;
}

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
