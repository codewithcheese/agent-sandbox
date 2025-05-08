import { usePlugin } from "$lib/utils";
import { TFile } from "obsidian";

let instance: Agents | null = null;

export class Agents {
  entries = $state<{ name: string; file: TFile }[]>();

  static async load() {
    if (!instance) {
      instance = new Agents();
      await instance.refresh();
    }
    return instance;
  }

  constructor() {
    const plugin = usePlugin();

    // Handle file deletion
    plugin.registerEvent(
      plugin.app.vault.on("delete", (file: TFile) => {
        const index = this.entries.findIndex(
          (entry) => entry.file.path === file.path,
        );
        if (index !== -1) {
          this.entries.splice(index, 1);
        }
      }),
    );

    // Handle file rename
    plugin.registerEvent(
      plugin.app.vault.on("rename", (file: TFile, oldPath: string) => {
        // Remove old entry if it existed
        const index = this.entries.findIndex(
          (entry) => entry.file.path === oldPath,
        );
        if (index !== -1) {
          this.entries.splice(index, 1);
        }

        // Check if the renamed file is an agent and add if needed
        this.updateEntryForFile(file);
      }),
    );

    // Handle file modification
    plugin.registerEvent(
      plugin.app.vault.on("modify", (file: TFile) => {
        this.updateEntryForFile(file);
      }),
    );

    plugin.registerEvent(
      plugin.app.metadataCache.on("changed", (file: TFile) => {
        // This event fires when metadata (including frontmatter) changes
        // It's particularly important for catching frontmatter changes
        // that might not trigger a "modify" event
        this.updateEntryForFile(file);
      }),
    );
  }

  /**
   * Update the entries list for a specific file
   */
  private updateEntryForFile(file: TFile): void {
    // Get agent name if this is an agent file
    const agentName = isAgent(file);

    // Find if this file is already in our entries
    const existingIndex = this.entries.findIndex(
      (entry) => entry.file.path === file.path,
    );

    if (agentName) {
      // It's an agent - update or add
      if (existingIndex !== -1) {
        // Update existing entry
        this.entries[existingIndex].name = agentName;
      } else {
        // Add new entry
        this.entries.push({ name: agentName, file });
      }
    } else if (existingIndex !== -1) {
      // Not an agent but was in our list - remove it
      this.entries.splice(existingIndex, 1);
    }
  }

  async refresh() {
    const plugin = usePlugin();
    this.entries = [];

    const markdownFiles = plugin.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      const agentName = isAgent(file);
      if (agentName) {
        this.entries.push({ name: agentName, file });
      }
    }
  }
}

export function isAgent(file: TFile): string | null {
  if (file.extension !== "md") return null;

  const plugin = usePlugin();
  const metadata = plugin.app.metadataCache.getFileCache(file);

  if (!metadata?.frontmatter) return null;

  const agentField = metadata.frontmatter.agent;
  if (agentField === true || agentField === "true") {
    return metadata.frontmatter.name || file.basename;
  }

  return null;
}
