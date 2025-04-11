import {
  App,
  Modal,
  Notice,
  Plugin,
  type PluginManifest,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { FileSelectModal } from "$lib/modals/file-select-modal.ts";
import { MERGE_VIEW_TYPE, MergeView } from "$lib/merge/MergeView.ts";
import { CHAT_VIEW_SLUG, ChatView } from "./chat/chat-view.ts";
import { FileTreeModal } from "$lib/modals/file-tree-modal.ts";
import {
  DEFAULT_SETTINGS,
  type PluginSettings,
  Settings,
} from "./settings/settings.ts";
import AccountModal from "./settings/AccountModal.svelte";
import ModelModal from "./settings/ModelModal.svelte";
import type { ChatModel, EmbeddingModel } from "./settings/models.ts";
import type { AIAccount } from "./settings/providers.ts";
import { mount, unmount } from "svelte";
import { PGliteProvider } from "./pglite/provider.ts";
import { installTools } from "./tools/command.ts";

export class AgentSandboxPlugin extends Plugin {
  settings: PluginSettings;
  pglite: PGliteProvider;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    window.Env = {
      Plugin: this,
    };
    this.pglite = new PGliteProvider(this);
  }

  async openFileSelect(onSelect: (file: TFile) => void) {
    const modal = new FileSelectModal(this.app, onSelect);
    modal.open();
  }

  async activateChatView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_SLUG)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: CHAT_VIEW_SLUG });
    }
    await workspace.revealLeaf(leaf);
  }

  async onload() {
    await this.loadSettings();
    await this.initializePGlite();

    // Register custom views
    this.registerView(CHAT_VIEW_SLUG, (leaf) => new ChatView(leaf));
    this.registerView(MERGE_VIEW_TYPE, (leaf) => {
      // This is a placeholder - actual content will be set later
      return new MergeView(leaf);
    });

    // Add ribbon icon for custom view
    this.addRibbonIcon("layout", "Open Agent Sandbox Chat", async () => {
      await this.activateChatView();
    });

    // Add ribbon icon for library tree
    this.addRibbonIcon("folder-tree", "Show Files Tree", async () => {
      new FileTreeModal(this.app).open();
    });

    // Add ribbon icon for merge view
    this.addRibbonIcon("git-merge", "Merge Documents", async () => {
      await this.openMergeView();
    });

    // Add command to install tools
    this.addCommand({
      id: "install-tools",
      name: "Install Built-in Tools",
      callback: async () => {
        await installTools();
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new Settings(this.app, this));
  }

  onunload() {}

  async initializePGlite() {
    try {
      await this.pglite.initialize();
    } catch (error) {
      console.error("Failed to initialize PGlite:", error);
      new Notice("Failed to initialize PGlite: " + (error as Error).message);
    }
  }

  async loadSettings() {
    const settings = await this.loadData();
    console.log("Loading settings", settings);
    const shouldSave = !settings;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    if (shouldSave) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    console.log("Saving settings", this.settings);
    await this.saveData(this.settings);
  }

  async openMergeView() {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      this.showNotice("No active file to merge with", 3000);
      return;
    }

    const currentContent = await this.app.vault.read(activeFile);

    this.openFileSelect(async (selectedFile: TFile) => {
      if (selectedFile.path === activeFile.path) {
        this.showNotice("Cannot merge a file with itself", 3000);
        return;
      }

      try {
        const selectedContent = await this.app.vault.read(selectedFile);

        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({
          type: MERGE_VIEW_TYPE,
          state: {},
        });

        // Get the view and initialize it with the content
        if (leaf.view instanceof MergeView) {
          const view = leaf.view as MergeView;
          await view.setContent(currentContent, selectedContent, activeFile.path);
        } else {
          this.showNotice("Failed to create merge view", 3000);
        }

        await this.app.workspace.revealLeaf(leaf);
        this.showNotice(
          `Merging ${activeFile.name} with ${selectedFile.name}`,
          3000,
        );
      } catch (error) {
        console.error("Error opening merge view:", error);
        this.showNotice(`Error: ${(error as Error).message}`, 3000);
      }
    });
  }

  showNotice(message: string, duration?: number) {
    new Notice(message, duration);
  }

  openAccountModal(onSave: (account: AIAccount) => void, current?: AIAccount) {
    const modal = new (class extends Modal {
      private component?: any;
      onOpen() {
        this.component = mount(AccountModal, {
          target: this.contentEl,
          props: {
            current,
            close: () => this.close(),
            save: (account: AIAccount) => {
              this.close();
              onSave(account);
            },
          },
        });
      }
      onClose() {
        if (this.component) {
          unmount(this.component);
        }
        this.contentEl.empty();
      }
    })(this.app);
    modal.open();
  }

  openModelModal(
    onSave: (model: ChatModel | EmbeddingModel) => void,
    current?: ChatModel | EmbeddingModel,
  ) {
    const modal = new (class extends Modal {
      private component?: any;
      onOpen() {
        this.component = mount(ModelModal, {
          target: this.contentEl,
          props: {
            current,
            close: () => this.close(),
            save: (model: ChatModel | EmbeddingModel) => {
              this.close();
              onSave(model);
            },
          },
        });
      }
      async onClose() {
        if (this.component) {
          await unmount(this.component);
        }
        this.contentEl.empty();
      }
    })(this.app);
    modal.open();
  }
}

export default AgentSandboxPlugin;
