import { type MetadataCache, TFile, type CachedMetadata } from "obsidian";
import { normalizePath } from "obsidian";
import { basename, dirname } from "path-browserify";
import matter from "gray-matter";
import type { VaultOverlay } from "./vault-overlay.svelte.ts";
import { getText, getStat, isDirectory, isTrashed } from "$lib/utils/loro.ts";
import { trashPath, overlayTmpPath } from "./tree-fs.ts";

export class MetadataCacheOverlay implements MetadataCache {
  constructor(
    private vaultOverlay: VaultOverlay,
    private baseMetadataCache: MetadataCache,
  ) {}

  getFileCache(file: TFile): CachedMetadata | null {
    // Check if file has proposed changes
    const proposedNode = this.vaultOverlay.proposedFS.findByPath(file.path);

    if (proposedNode && !isTrashed(proposedNode)) {
      // File exists in proposed state
      const proposedText = getText(proposedNode);
      if (proposedText !== undefined) {
        // Text file - parse frontmatter
        const { data: frontmatter } = matter(proposedText);
        return { frontmatter };
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

    // Try exact path match first (O(1) via pathCache)
    let proposedNode = this.vaultOverlay.proposedFS.findByPath(cleanLinkpath);
    if (
      proposedNode &&
      !isTrashed(proposedNode) &&
      !isDirectory(proposedNode)
    ) {
      return this.createTFileFromProposed(cleanLinkpath, proposedNode);
    }

    // Try with .md extension if no extension provided
    if (!cleanLinkpath.includes(".")) {
      const mdPath = `${cleanLinkpath}.md`;
      proposedNode = this.vaultOverlay.proposedFS.findByPath(mdPath);
      if (
        proposedNode &&
        !isTrashed(proposedNode) &&
        !isDirectory(proposedNode)
      ) {
        return this.createTFileFromProposed(mdPath, proposedNode);
      }
    }

    // Try relative to source path
    if (sourcePath && !cleanLinkpath.startsWith("/")) {
      const sourceDir = dirname(sourcePath);
      const relativePath = normalizePath(`${sourceDir}/${cleanLinkpath}`);

      proposedNode = this.vaultOverlay.proposedFS.findByPath(relativePath);
      if (
        proposedNode &&
        !isTrashed(proposedNode) &&
        !isDirectory(proposedNode)
      ) {
        return this.createTFileFromProposed(relativePath, proposedNode);
      }

      // Try relative path with .md extension
      if (!cleanLinkpath.includes(".")) {
        const relativeMdPath = `${relativePath}.md`;
        proposedNode = this.vaultOverlay.proposedFS.findByPath(relativeMdPath);
        if (
          proposedNode &&
          !isTrashed(proposedNode) &&
          !isDirectory(proposedNode)
        ) {
          return this.createTFileFromProposed(relativeMdPath, proposedNode);
        }
      }
    }

    // Basename search using path cache (much faster than tree traversal)
    const basename = this.extractBasename(cleanLinkpath);
    if (basename) {
      const matchingPath = this.findPathByBasename(basename);
      if (matchingPath) {
        proposedNode = this.vaultOverlay.proposedFS.findByPath(matchingPath);
        if (
          proposedNode &&
          !isTrashed(proposedNode) &&
          !isDirectory(proposedNode)
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

  private findPathByBasename(targetBasename: string): string | null {
    // Access the validated path cache - this is O(n) but much faster than tree traversal
    // since it's just iterating over a Map's keys (all in JavaScript, no WASM boundary)
    const pathCache = this.vaultOverlay.proposedFS.getValidatedPathCache();
    const matchingPaths: string[] = [];

    for (const [path, _nodeId] of pathCache) {
      // Skip trash and tmp paths
      if (path.startsWith(trashPath) || path.startsWith(overlayTmpPath)) {
        continue;
      }

      const pathBasename = this.extractBasename(path);
      if (pathBasename === targetBasename) {
        matchingPaths.push(path);
      }
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

  private createTFileFromProposed(path: string, node: any): TFile {
    const stat = getStat(node);
    return this.vaultOverlay.createTFile(path, stat);
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
