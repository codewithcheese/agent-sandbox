import {
  App,
  CachedMetadata,
  ItemView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginManifest,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { FileSelectModal } from "./fileSelect";
import { showFiles } from "$lib/utils/showFiles";
import ChatView from "../src/ChatView.svelte";

export type File = {
  path: string;
  fileName: string;
  extension: string;
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };
  metadata: CachedMetadata | null;
};

interface SvelteViteAgentSettings {
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  RAPIDAPI_KEY: string;
  CHATBOTS_PATH: string;
}

const DEFAULT_SETTINGS: SvelteViteAgentSettings = {
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  RAPIDAPI_KEY: "",
  CHATBOTS_PATH: "/chatbots",
};

const VITE_AGENT_VIEW_SLUG = "svelte-vite-agent-view";

export class SvelteViteAgentPlugin extends Plugin {
  // @ts-ignore
  settings: SvelteViteAgentSettings;

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

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VITE_AGENT_VIEW_SLUG)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VITE_AGENT_VIEW_SLUG });
    }
    await workspace.revealLeaf(leaf);
  }

  async onload() {
    await this.loadSettings();

    // Register custom view
    this.registerView(
      VITE_AGENT_VIEW_SLUG,
      (leaf) => new SlenderAgentView(leaf, this),
    );

    // Add ribbon icon for custom view
    this.addRibbonIcon("layout", "Open Slender Agent", async () => {
      await this.activateView();
    });

    // Add ribbon icon for library tree
    this.addRibbonIcon("folder-tree", "Show Library Tree", async () => {
      new LibraryTreeModal(this.app).open();
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SampleSettingTab(this.app, this));
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
}

class SlenderAgentView extends ItemView {
  private plugin: SvelteViteAgentPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SvelteViteAgentPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VITE_AGENT_VIEW_SLUG;
  }

  getDisplayText(): string {
    return "Vite Agent";
  }

  onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string): void {
    // if (source === "tab-header") {
    //   menu.addItem((item) => {
    //     item
    //       .setTitle("Reload view")
    //       .setIcon("refresh-cw")
    //       .onClick(() => {
    //         this.reloadView();
    //       });
    //   });
    // }
  }

  // async reloadView() {
  //   const container = this.containerEl.children[1];
  //
  //   // Remove existing script elements
  //   container.querySelectorAll('script[type="module"]').forEach((script) => {
  //     script.remove();
  //   });
  //
  //   // Clear the chat view container but keep the div
  //   const chatViewDiv = container.querySelector("#chat-view");
  //   if (chatViewDiv) {
  //     chatViewDiv.innerHTML = "";
  //   } else {
  //     // If the div doesn't exist, recreate it
  //     const div = document.createElement("div");
  //     div.setAttribute("id", "chat-view");
  //     div.style.height = "100%";
  //     container.appendChild(div);
  //   }
  //
  //   // Add a new script with a fresh timestamp
  //   const script = document.createElement("script");
  //   script.setAttribute("type", "module");
  //   script.setAttribute(
  //     "src",
  //     "http://localhost:15173/src/index.svelte.ts?t=" + Date.now(),
  //   );
  //   container.appendChild(script);
  // }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();

    try {
      const div = document.createElement("div");
      div.setAttribute("id", "chat-view");
      div.style.height = "100%";
      container.appendChild(div);

      if (process.env.NODE_ENV === "development") {
        // Development mode: Use Vite dev server with HMR
        const script = document.createElement("script");
        script.setAttribute("type", "module");
        script.setAttribute(
          "src",
          "http://localhost:15173/src/index.svelte.ts?t=" + Date.now(),
        );
        container.appendChild(script);
      } else {
        // Production mode: Import and mount the component directly
        // await import("../src/index.svelte.js");
        if (!customElements.get("chat-view")) {
          // @ts-expect-error types incorrect for .element
          customElements.define("chat-view", ChatView.element);
        }

        container.innerHTML = `<chat-view></chat-view>`;
      }
    } catch (error) {
      console.error(error);
    }
  }

  async onClose() {
    // @ts-expect-error fixme shared global
    window.Client = undefined;
  }
}

class LibraryTreeModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Library Tree" });

    const container = contentEl.createEl("div", {
      cls: "library-tree-container",
    });
    const tree = await showFiles();
    container.createEl("pre", { text: tree });

    // Add some basic styling
    container.style.maxHeight = "70vh";
    container.style.overflow = "auto";
    container.style.fontFamily = "monospace";
    container.style.whiteSpace = "pre-wrap";
    container.style.padding = "10px";
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: SvelteViteAgentPlugin;

  constructor(app: App, plugin: SvelteViteAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Settings for my awesome plugin." });

    // todo how to create a second view with HMR?
    new Setting(containerEl).setName("Anthropic API Key").addText((text) =>
      text
        .setPlaceholder("Enter your Anthropic API Key")
        .setValue(this.plugin.settings.ANTHROPIC_API_KEY)
        .onChange(async (value) => {
          this.plugin.settings.ANTHROPIC_API_KEY = value;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName("OpenAI API Key").addText((text) =>
      text
        .setPlaceholder("Enter your OpenAI API Key")
        .setValue(this.plugin.settings.OPENAI_API_KEY)
        .onChange(async (value) => {
          this.plugin.settings.OPENAI_API_KEY = value;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName("RapidAPI Key").addText((text) =>
      text
        .setPlaceholder("Enter your RapidAPI Key")
        .setValue(this.plugin.settings.RAPIDAPI_KEY)
        .onChange(async (value) => {
          this.plugin.settings.RAPIDAPI_KEY = value;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl).setName("Chatbots Directory").addText((text) =>
      text
        .setPlaceholder("Enter chatbots directory")
        .setValue(this.plugin.settings.CHATBOTS_PATH)
        .onChange(async (value) => {
          this.plugin.settings.CHATBOTS_PATH = value;
          await this.plugin.saveSettings();
        }),
    );
  }
}

export default SvelteViteAgentPlugin;
