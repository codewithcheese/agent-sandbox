import { type MetadataCache, TFile, type CachedMetadata } from "obsidian";
import { normalizePath } from "obsidian";
import { basename, dirname } from "path-browserify";
import matter from "front-matter";
import type { VaultOverlay } from "./vault-overlay.svelte.ts";
import { type TreeNode, TRASH_FOLDER, TMP_FOLDER } from "./vault-state/index.ts";

export class MetadataCacheOverlay implements MetadataCache {
  constructor(
    private vaultOverlay: VaultOverlay,
    private baseMetadataCache: MetadataCache,
  ) {}

  getFileCache(file: TFile): CachedMetadata | null {
    // Check if file has proposed changes
    const proposedNode = this.vaultOverlay.proposedDoc.findByPath(file.path);

    if (proposedNode && !proposedNode.isTrashed()) {
      // File exists in proposed state
      const proposedText = proposedNode.text;
      if (proposedText !== undefined) {
        // Text file - parse frontmatter
        const { attributes } = matter(proposedText);
        return { frontmatter: attributes };
      } else {
        // Binary file or file without text content - return empty frontmatter
        return { frontmatter: {} };
      }
    }

    // No proposed changes - delegate to vault's metadata cache
    return this.baseMetadataCache.getFileCache(file) || null;
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    // First check if target exists in proposed state
    const resolvedFile = this.resolveInProposed(linkpath, sourcePath);
    if (resolvedFile) {
      return resolvedFile;
    }

    // Fall back to vault resolution
    return this.baseMetadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  }

  private resolveInProposed(
    linkpath: string,
    sourcePath: string,
  ): TFile | null {
    const cleanLinkpath = this.cleanLinkpath(linkpath);

    // Try exact path match first
    let proposedNode = this.vaultOverlay.proposedDoc.findByPath(cleanLinkpath);
    if (
      proposedNode &&
      !proposedNode.isTrashed() &&
      !proposedNode.isDirectory
    ) {
      return this.createTFileFromProposed(cleanLinkpath, proposedNode);
    }

    // Try with .md extension if no extension provided
    if (!cleanLinkpath.includes(".")) {
      const mdPath = `${cleanLinkpath}.md`;
      proposedNode = this.vaultOverlay.proposedDoc.findByPath(mdPath);
      if (
        proposedNode &&
        !proposedNode.isTrashed() &&
        !proposedNode.isDirectory
      ) {
        return this.createTFileFromProposed(mdPath, proposedNode);
      }
    }

    // Try relative to source path
    if (sourcePath && !cleanLinkpath.startsWith("/")) {
      const sourceDir = dirname(sourcePath);
      const relativePath = normalizePath(`${sourceDir}/${cleanLinkpath}`);

      proposedNode = this.vaultOverlay.proposedDoc.findByPath(relativePath);
      if (
        proposedNode &&
        !proposedNode.isTrashed() &&
        !proposedNode.isDirectory
      ) {
        return this.createTFileFromProposed(relativePath, proposedNode);
      }

      // Try relative path with .md extension
      if (!cleanLinkpath.includes(".")) {
        const relativeMdPath = `${relativePath}.md`;
        proposedNode = this.vaultOverlay.proposedDoc.findByPath(relativeMdPath);
        if (
          proposedNode &&
          !proposedNode.isTrashed() &&
          !proposedNode.isDirectory
        ) {
          return this.createTFileFromProposed(relativeMdPath, proposedNode);
        }
      }
    }

    // Basename search using on-demand tree traversal
    const targetBasename = this.extractBasename(cleanLinkpath);
    if (targetBasename) {
      const matchingPath = this.findPathByBasename(targetBasename);
      if (matchingPath) {
        proposedNode = this.vaultOverlay.proposedDoc.findByPath(matchingPath);
        if (
          proposedNode &&
          !proposedNode.isTrashed() &&
          !proposedNode.isDirectory
        ) {
          return this.createTFileFromProposed(matchingPath, proposedNode);
        }
      }
    }

    return null;
  }

  private cleanLinkpath(linkpath: string): string {
    // Remove display text after pipe: "file|display" -> "file"
    const pipeIndex = linkpath.indexOf("|");
    if (pipeIndex !== -1) {
      linkpath = linkpath.substring(0, pipeIndex);
    }

    // Remove anchor: "file#heading" -> "file"
    const hashIndex = linkpath.indexOf("#");
    if (hashIndex !== -1) {
      linkpath = linkpath.substring(0, hashIndex);
    }

    return normalizePath(linkpath.trim());
  }

  private extractBasename(path: string): string | null {
    const filename = basename(path);
    if (!filename) return null;

    // Remove extension for basename matching
    const dotIndex = filename.lastIndexOf(".");
    return dotIndex > 0 ? filename.substring(0, dotIndex) : filename;
  }

  /**
   * Find a path matching the target basename by traversing the tree on-demand.
   * Returns the shortest matching path (deterministic resolution).
   */
  private findPathByBasename(targetBasename: string): string | null {
    const matchingPaths: string[] = [];
    const root = this.vaultOverlay.proposedDoc.getNode("0");

    if (root) {
      this.collectMatchingPaths(root, "", targetBasename, matchingPaths);
    }

    if (matchingPaths.length === 0) {
      return null;
    }

    // Sort paths to ensure deterministic resolution
    // Prefer shorter paths, then alphabetical order
    matchingPaths.sort((a, b) => {
      const lengthDiff = a.length - b.length;
      return lengthDiff !== 0 ? lengthDiff : a.localeCompare(b);
    });

    return matchingPaths[0];
  }

  /**
   * Recursively collect paths matching the target basename.
   */
  private collectMatchingPaths(
    node: TreeNode,
    parentPath: string,
    targetBasename: string,
    matchingPaths: string[],
  ): void {
    const name = node.data.name;
    const path = parentPath ? `${parentPath}/${name}` : name;

    // Skip root, trash, and tmp folders
    if (path && !path.startsWith(TRASH_FOLDER) && !path.startsWith(TMP_FOLDER)) {
      const pathBasename = this.extractBasename(path);
      if (pathBasename === targetBasename) {
        matchingPaths.push(path);
      }
    }

    // Recurse into children
    for (const child of node.children()) {
      this.collectMatchingPaths(child, path, targetBasename, matchingPaths);
    }
  }

  private createTFileFromProposed(path: string, node: TreeNode): TFile {
    return this.vaultOverlay.createTFile(path, node.stat);
  }

  getCache(path: string): CachedMetadata | null {
    // Let vault overlay resolve the path to a TFile
    const file = this.vaultOverlay.getFileByPath(path);
    if (file instanceof TFile) {
      return this.getFileCache(file);
    }
    return null;
  }

  fileToLinktext(
    _file: TFile,
    _sourcePath: string,
    _omitMdExtension?: boolean,
  ): string {
    throw new Error("fileToLinktext not implemented in MetadataCacheOverlay");
  }

  // Properties for resolved/unresolved links
  get resolvedLinks(): Record<string, Record<string, number>> {
    throw new Error("resolvedLinks not implemented in MetadataCacheOverlay");
  }

  get unresolvedLinks(): Record<string, Record<string, number>> {
    throw new Error("unresolvedLinks not implemented in MetadataCacheOverlay");
  }

  // Event system methods inherited from Events class
  on(_name: string, _callback: (...args: any[]) => any, _ctx?: any): any {
    throw new Error("on not implemented in MetadataCacheOverlay");
  }

  off(_name: string, _callback: (...args: any[]) => any): void {
    throw new Error("off not implemented in MetadataCacheOverlay");
  }

  offref(_ref: any): void {
    throw new Error("offref not implemented in MetadataCacheOverlay");
  }

  trigger(_name: string, ..._data: any[]): void {
    throw new Error("trigger not implemented in MetadataCacheOverlay");
  }

  tryTrigger(_evt: any, _args: any[]): void {
    throw new Error("tryTrigger not implemented in MetadataCacheOverlay");
  }
}
