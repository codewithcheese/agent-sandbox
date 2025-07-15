import { TFile, Plugin } from "obsidian";
import { usePlugin } from "$lib/utils/index.ts";

export class Commands {
  private static instance: Commands | null = null;
  entries = $state<{ name: string; file: TFile }[]>([]);

  static register(plugin: Plugin): Commands {
    if (!Commands.instance) {
      Commands.instance = new Commands(plugin);
    }
    return Commands.instance;
  }

  static getInstance(): Commands | null {
    return Commands.instance;
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

        // Check if the renamed file is a command and add if needed
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
    // Get command name if this is a command file
    const commandName = isCommand(file);

    // Find if this file is already in our entries
    const existingIndex = this.entries.findIndex(
      (entry) => entry.file.path === file.path,
    );

    if (commandName) {
      // It's a command - update or add
      if (existingIndex !== -1) {
        // Update existing entry
        this.entries[existingIndex].name = commandName;
      } else {
        // Add new entry
        this.entries.push({ name: commandName, file });
      }
    } else if (existingIndex !== -1) {
      // Not a command but was in our list - remove it
      this.entries.splice(existingIndex, 1);
    }
  }

  static async refresh() {
    const instance = Commands.getInstance();
    if (!instance) return;
    instance.entries = [];

    const plugin = usePlugin();
    const markdownFiles = plugin.app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      const commandName = isCommand(file);
      if (commandName) {
        instance.entries.push({ name: commandName, file });
      }
    }
  }
}

export function isCommand(file: TFile): string | null {
  if (file.extension !== "md") return null;

  const plugin = usePlugin();
  const metadata = plugin.app.metadataCache.getFileCache(file);

  if (!metadata?.frontmatter) return null;

  const commandField = metadata.frontmatter.command;
  if (commandField === true || commandField === "true") {
    return metadata.frontmatter.name || file.basename;
  }

  return null;
}
