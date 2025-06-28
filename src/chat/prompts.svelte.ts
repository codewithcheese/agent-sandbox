import { TFile, Plugin } from "obsidian";
import { usePlugin } from "$lib/utils/index.ts";

export class Prompts {
  private static instance: Prompts | null = null;
  entries = $state<{ name: string; file: TFile }[]>([]);

  static register(plugin: Plugin): Prompts {
    if (!Prompts.instance) {
      Prompts.instance = new Prompts(plugin);
    }
    return Prompts.instance;
  }

  static getInstance(): Prompts | null {
    return Prompts.instance;
  }

  constructor(private plugin: Plugin) {
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle file deletion
    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file: TFile) => {
        const index = this.entries.findIndex(
          (entry) => entry.file.path === file.path,
        );
        if (index !== -1) {
          this.entries.splice(index, 1);
        }
      }),
    );

    // Handle file rename
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file: TFile, oldPath: string) => {
        // Remove old entry if it existed
        const index = this.entries.findIndex(
          (entry) => entry.file.path === oldPath,
        );
        if (index !== -1) {
          this.entries.splice(index, 1);
        }

        // Check if the renamed file is a prompt and add if needed
        this.updateEntryForFile(file);
      }),
    );

    // Handle file modification
    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file: TFile) => {
        this.updateEntryForFile(file);
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file: TFile) => {
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
    // Get prompt name if this is a prompt file
    const promptName = isPrompt(file);

    // Find if this file is already in our entries
    const existingIndex = this.entries.findIndex(
      (entry) => entry.file.path === file.path,
    );

    if (promptName) {
      // It's a prompt - update or add
      if (existingIndex !== -1) {
        // Update existing entry
        this.entries[existingIndex].name = promptName;
      } else {
        // Add new entry
        this.entries.push({ name: promptName, file });
      }
    } else if (existingIndex !== -1) {
      // Not a prompt but was in our list - remove it
      this.entries.splice(existingIndex, 1);
    }
  }

  static async refresh() {
    const instance = Prompts.getInstance();
    if (!instance) return;
    instance.entries = [];

    const plugin = usePlugin();
    const markdownFiles = plugin.app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      const promptName = isPrompt(file);
      if (promptName) {
        instance.entries.push({ name: promptName, file });
      }
    }
  }
}

export function isPrompt(file: TFile): string | null {
  if (file.extension !== "md") return null;

  const plugin = usePlugin();
  const metadata = plugin.app.metadataCache.getFileCache(file);

  if (!metadata?.frontmatter) return null;

  const promptField = metadata.frontmatter.prompt;
  if (promptField === true || promptField === "true") {
    return metadata.frontmatter.name || file.basename;
  }

  return null;
}
