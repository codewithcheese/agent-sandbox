import { App, Modal, Notice, Plugin, PluginManifest, TFile } from "obsidian";
import { FileSelectModal } from "./fileSelect";
import { CHAT_VIEW_SLUG, ChatView } from "./chatView";
import { FileTreeModal } from "./fileTreeModal";
import {
  DEFAULT_SETTINGS,
  AIAccount,
  PluginSettings,
  Settings,
} from "./settings";
import { mountComponent } from "./svelte";
import AccountModal from "../src/AccountModal.svelte";
import ModelModal from "../src/ModelModal.svelte";
import type { ChatModel, EmbeddingModel } from "./models";

export class AgentSandboxPlugin extends Plugin {
  // @ts-ignore
  settings: PluginSettings;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    window.Env = {
      Plugin: this,
    };
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

    // Register custom view
    this.registerView(CHAT_VIEW_SLUG, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon for custom view
    this.addRibbonIcon("layout", "Open Agent Sandbox Chat", async () => {
      await this.activateChatView();
    });

    // Add ribbon icon for library tree
    this.addRibbonIcon("folder-tree", "Show Files Tree", async () => {
      new FileTreeModal(this.app).open();
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new Settings(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  showNotice(message: string, duration?: number) {
    new Notice(message, duration);
  }

  openAccountModal(onSave: (account: AIAccount) => void, current?: AIAccount) {
    const modal = new (class extends Modal {
      onOpen() {
        mountComponent(this.contentEl, AccountModal, "component", {
          current,
          close: () => this.close(),
          save: (account: AIAccount) => {
            this.close();
            onSave(account);
          },
        });
      }
      onClose() {
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
      onOpen() {
        mountComponent(this.contentEl, ModelModal, "component", {
          current,
          close: () => this.close(),
          save: (model: ChatModel | EmbeddingModel) => {
            this.close();
            onSave(model);
          },
        });
      }
      onClose() {
        this.contentEl.empty();
      }
    })(this.app);
    modal.open();
  }
}

export default AgentSandboxPlugin;
