import {
  App,
  Modal,
  Notice,
  Platform,
  Plugin,
  type PluginManifest,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { FileSelectModal } from "$lib/modals/file-select-modal.ts";
import { MERGE_VIEW_TYPE, MergeView } from "$lib/merge/merge-view.ts";
import { CHAT_VIEW_TYPE, ChatView } from "./chat/chat-view.svelte.ts";
import {
  type Artifact,
  ARTIFACT_VIEW_TYPE,
  ArtifactView,
} from "$lib/artifacts/artifact-vew.svelte.ts";
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
import superjson from "superjson";
import { ChatSerializer } from "./chat/chat-serializer.ts";
import { registerChatRenameHandler } from "./chat/chat.svelte.ts";
import { registerMobileLogger } from "$lib/utils/mobile-logger.ts";
import { RecorderWidget } from "./recorder/recorder-widget.ts";
import { AgentStatus } from "./status/agent-status.svelte.ts";
import mainCss from "./main.css?inline";

export class AgentSandboxPlugin extends Plugin {
  settings: PluginSettings;
  pglite: PGliteProvider;
  recorder: RecorderWidget;
  styleEl?: HTMLStyleElement;
  agentStatus: AgentStatus;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    registerMobileLogger(this);
    window.Env = {
      Plugin: this,
    };
    this.pglite = new PGliteProvider(this);
    this.recorder = new RecorderWidget();
  }

  async onload() {
    this.loadCSS();
    await this.loadSettings();
    await this.initializePGlite();

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf));
    this.registerView(ARTIFACT_VIEW_TYPE, (leaf) => new ArtifactView(leaf));
    this.registerView(MERGE_VIEW_TYPE, (leaf) => new MergeView(leaf));

    registerChatRenameHandler();

    this.registerExtensions(["chat"], CHAT_VIEW_TYPE);

    this.agentStatus = new AgentStatus();

    this.addRibbonIcon(
      "message-square",
      "Open Agent Sandbox Chat",
      async () => {
        await this.openChatView();
      },
    );

    this.addRibbonIcon("mic", "Toggle Recorder", () => {
      this.recorder.toggle();
    });

    this.addRibbonIcon("folder-tree", "Show Files Tree", async () => {
      new FileTreeModal(this.app).open();
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

  async reload() {
    // reload CSS
    const css = await import("./main.css?inline&t=" + Date.now());
    this.styleEl.textContent = css.default;
  }

  loadCSS() {
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = mainCss;
    document.head.appendChild(this.styleEl);
    this.register(() => {
      if (this.styleEl) this.styleEl.remove();
    });
  }

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

  async openFileSelect(onSelect: (file: TFile) => void) {
    const modal = new FileSelectModal(this.app, onSelect);
    modal.open();
  }

  async openChatView() {
    const baseName = "Untitled";
    let fileName = baseName;
    let counter = 1;

    // Get the chats path from settings
    const chatsPath = this.settings.vault.chatsPath;
    const normalizedPath = chatsPath.startsWith("/")
      ? chatsPath.slice(1)
      : chatsPath;

    // Ensure the directory exists
    try {
      const folderExists = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (!folderExists) {
        await this.app.vault.createFolder(normalizedPath);
      }
    } catch (error) {
      console.error("Error creating chats directory:", error);
      this.showNotice("Failed to create chats directory", 3000);
    }

    // Create a unique filename
    while (
      this.app.vault.getAbstractFileByPath(`${normalizedPath}/${fileName}.chat`)
    ) {
      fileName = `${baseName} ${counter}`;
      counter++;
    }

    const filePath = `${normalizedPath}/${fileName}.chat`;
    const file = await this.app.vault.create(
      filePath,
      superjson.stringify(ChatSerializer.INITIAL_DATA),
    );

    let leaf: WorkspaceLeaf;

    if (!Platform.isMobile) {
      const rightChatLeaves = this.app.workspace
        .getLeavesOfType(CHAT_VIEW_TYPE)
        // @ts-expect-error containerEl not typed
        .filter((l) => l.containerEl.closest(".mod-right-split"));

      if (rightChatLeaves.length > 0) {
        leaf = rightChatLeaves[0];
      } else {
        leaf = this.app.workspace.getRightLeaf(false);
      }
    } else {
      // Mobile: fall back to the current/only leaf
      leaf = this.app.workspace.getLeaf();
    }

    await leaf.openFile(file, {
      active: true,
      state: { mode: CHAT_VIEW_TYPE },
    });

    await this.app.workspace.revealLeaf(leaf);
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
