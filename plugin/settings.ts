import { App, PluginSettingTab } from "obsidian";
import AgentSandboxPlugin from "./main";
import { mountComponent } from "./svelte";
import SettingsPage from "../src/SettingsPage.svelte";
import type { ModelConfig, AIProvider } from "$lib/models";
import { ChatModel, EmbeddingModel, models } from "./models";

export type AIAccount = {
  id: string;
  name: string;
  provider: keyof typeof AIProvider;
  config: ModelConfig;
};

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
  plugin: AgentSandboxPlugin;

  constructor(app: App, plugin: AgentSandboxPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    mountComponent(containerEl, SettingsPage, "component");
  }
}
