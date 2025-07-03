import { App, Notice, Plugin, type PluginManifest } from "obsidian";
import { MERGE_VIEW_TYPE, MergeView } from "$lib/merge/merge-view.svelte.ts";
import { ChatView } from "./chat/chat-view.svelte.ts";
import { ChatHistoryView } from "./chat/chat-history-view.svelte.ts";
import {
  type Artifact,
  ARTIFACT_VIEW_TYPE,
  ArtifactView,
} from "$lib/artifacts/artifact-vew.svelte.ts";
import { FileTreeModal } from "$lib/modals/file-tree-modal.ts";
import { SettingsManager } from "./settings/settings-manager.ts";
import type { CurrentSettings } from "./settings/settings.ts";
import { PGliteProvider } from "$lib/pglite/provider.ts";
import { installTools } from "./tools/command.ts";
import { registerChatRenameHandler } from "./chat/chat.svelte.ts";
import { RenameTracker } from "./chat/rename-tracker.ts";
import { registerMobileLogger } from "$lib/utils/mobile-logger.ts";
import { RecorderView } from "./recorder/recorder-view.svelte.ts";
import mainCss from "./main.css?inline";
import { JsonSchemaCodeBlockProcessor } from "./editor/schema/json-schema-code-block.ts";
import { AgentView } from "./editor/agent/agent-view.ts";
import { AgentBannerComponent } from "./editor/agent/agent-banner-component.svelte.ts";
import { PromptCommand } from "./editor/prompt-command.ts";
import { ContextMenu } from "./editor/context-menu.ts";
import { HtmlEscapeCommand } from "./editor/html-escape-command.ts";
import { TestSetCommand } from "./tools/evals/test-set-command.ts";
import { Prompts } from "./chat/prompts.svelte.ts";

export class AgentSandboxPlugin extends Plugin {
  settingsManager: SettingsManager;
  pglite: PGliteProvider;
  styleEl?: HTMLStyleElement;
  jsonSchemaCodeBlock: JsonSchemaCodeBlockProcessor;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    registerMobileLogger(this);
    window.Env = {
      Plugin: this,
    };
    this.pglite = new PGliteProvider();
    this.settingsManager = new SettingsManager(this);
  }

  /**
   * Backward compatibility
   */
  get settings(): CurrentSettings {
    return this.settingsManager.getSettings();
  }

  async saveSettings(newSettings?: CurrentSettings): Promise<void> {
    try {
      if (newSettings) {
        await this.settingsManager.replaceSettings(newSettings);
      } else {
        await this.settingsManager.saveSettings();
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      new Notice(
        `Failed to save settings: ${error instanceof Error ? error.message : "Unknown error"}`,
        8000,
      );
      throw error; // Re-throw so calling code can handle it
    }
  }

  async loadSettings(): Promise<void> {
    await this.settingsManager.loadSettings();
  }

  async onload() {
    this.loadCSS();
    await this.settingsManager.init();
    await this.initializePGlite();

    this.registerView(ARTIFACT_VIEW_TYPE, (leaf) => new ArtifactView(leaf));
    this.registerView(MERGE_VIEW_TYPE, (leaf) => new MergeView(leaf));

    registerChatRenameHandler();

    ChatView.register(this);
    ChatHistoryView.register(this);
    AgentView.register(this);
    AgentBannerComponent.register(this);
    PromptCommand.register(this);
    ContextMenu.register(this);
    HtmlEscapeCommand.register(this);
    TestSetCommand.register(this);
    RenameTracker.register(this);
    RecorderView.register(this);
    Prompts.register(this);
    this.jsonSchemaCodeBlock = new JsonSchemaCodeBlockProcessor();

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

    // Open recorder view on startup
    this.app.workspace.onLayoutReady(async () => {
      // await RecorderView.openRecorderView();
      await Prompts.refresh();
    });
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
}

export default AgentSandboxPlugin;
