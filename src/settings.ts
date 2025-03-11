import { App, PluginSettingTab } from "obsidian";
import AgentSandboxPlugin from "./main";
import SettingsPage from "./SettingsPage.svelte";
import { type ChatModel, type EmbeddingModel, models } from "./models";
import type { AIAccount } from "./ai";
import { mount, unmount } from "svelte";

export interface PluginSettings {
  services: {
    rapidapi: {
      name: string;
      apiKey: string;
    };
  };
  chatbotsPath: string;
  accounts: AIAccount[];
  models: (ChatModel | EmbeddingModel)[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  services: {
    rapidapi: {
      name: "RapidAPI",
      apiKey: "",
    },
  },
  chatbotsPath: "chatbots",
  accounts: [],
  models,
};

export class Settings extends PluginSettingTab {
  protected component: any;

  constructor(app: App, plugin: AgentSandboxPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.component = mount(SettingsPage, { target: containerEl });
  }

  hide() {
    if (this.component) {
      unmount(this.component);
    }
  }
}
