import { App, PluginSettingTab } from "obsidian";
import AgentSandboxPlugin from "./main";
import { mountComponent } from "./svelte";
import SettingsPage from "../src/SettingsPage.svelte";
import type { ModelConfig, ModelProvider } from "$lib/models";
import { ChatModel, EmbeddingModel, models } from "./models";

export type ModelProviderProfile = {
  name: string;
  provider: keyof typeof ModelProvider;
  config: ModelConfig;
};

export interface PluginSettings {
  services: {
    rapidapi: {
      apiKey: string;
    };
  };
  chatbotsPath: string;
  modelProviders: ModelProviderProfile[];
  models: (ChatModel | EmbeddingModel)[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  services: {
    rapidapi: {
      apiKey: "",
    },
  },
  chatbotsPath: "chatbots",
  modelProviders: [],
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
