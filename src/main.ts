import {
  App,
  Modal,
  Notice,
  Platform,
  Plugin,
  type PluginManifest,
  TFile,
} from "obsidian";
import { FileSelectModal } from "$lib/modals/file-select-modal.ts";
import { MERGE_VIEW_TYPE, MergeView } from "$lib/merge/MergeView.ts";
import { CHAT_VIEW_SLUG, ChatView } from "./chat/chat-view.svelte.ts";
import {
  type Artifact,
  ARTIFACT_VIEW_TYPE,
  ArtifactView,
} from "./artifacts/artifact-vew.svelte.ts";
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

  async openChatView() {
    const baseName = "Untitled";
    let fileName = baseName;
    let counter = 1;

    while (this.app.vault.getAbstractFileByPath(`${fileName}.chat`)) {
      fileName = `${baseName} ${counter}`;
      counter++;
    }

    const filePath = `${fileName}.chat`;
    const file = await this.app.vault.create(filePath, "");

    const leaf = Platform.isMobile
      ? this.app.workspace.getLeaf()
      : this.app.workspace.getRightLeaf(false);

    await leaf.openFile(file, {
      active: true,
      state: { mode: CHAT_VIEW_SLUG },
    });

    await this.app.workspace.revealLeaf(leaf);
  }

  async onload() {
    await this.loadSettings();
    await this.initializePGlite();

    this.registerView(CHAT_VIEW_SLUG, (leaf) => new ChatView(leaf));
    this.registerView(ARTIFACT_VIEW_TYPE, (leaf) => new ArtifactView(leaf));

    this.registerExtensions(["chat"], CHAT_VIEW_SLUG);

    this.addRibbonIcon("layout", "Open Agent Sandbox Chat", async () => {
      await this.openChatView();
    });

    this.addRibbonIcon("folder-tree", "Show Files Tree", async () => {
      new FileTreeModal(this.app).open();
    });

    this.addRibbonIcon("git-merge", "Merge Documents", async () => {
      await this.openMergeView();
    });

    this.addRibbonIcon("code-block", "Open Artifact View", async () => {
      await this.openArtifactView({ name: "Empty", html: "" });
    });

    this.addCommand({
      id: "install-tools",
      name: "Install Built-in Tools",
      callback: async () => {
        await installTools();
      },
    });

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
    const shouldSave = !settings;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    if (shouldSave) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
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
          await view.setContent(
            currentContent,
            selectedContent,
            activeFile.path,
          );
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

  async openArtifactView(artifact: Artifact) {
    // Find or create a leaf in Obsidian's workspace
    let leaf = this.app.workspace
      .getLeavesOfType(ARTIFACT_VIEW_TYPE)
      .find((leaf) => {
        return (
          leaf.view instanceof ArtifactView &&
          leaf.view.artifact.name === artifact.name
        );
      });

    console.log("openArtifactView", leaf);

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: ARTIFACT_VIEW_TYPE,
        active: true,
      });
    } else {
      await this.app.workspace.revealLeaf(leaf);
    }

    // Load the content
    if (leaf.view instanceof ArtifactView) {
      const artifactView = leaf.view;
      artifactView.loadArtifact(artifact);
    }

    return leaf;
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
