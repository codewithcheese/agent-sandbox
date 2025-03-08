import { App, PluginSettingTab } from "obsidian";
import AgentSandboxPlugin from "./main";
import { mountComponent } from "./svelte";
import SettingsPage from "../src/SettingsPage.svelte";
import { ModelConfig, ModelProvider } from "$lib/models";

export type ModelProviderProfile = {
  name: string;
  provider: keyof typeof ModelProvider;
  config: ModelConfig;
};

export interface PluginSettings {
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  RAPIDAPI_KEY: string;
  chatbotsPath: string;
  modelProviders: ModelProviderProfile[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  RAPIDAPI_KEY: "",
  chatbotsPath: "chatbots",
  modelProviders: [],
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

    // containerEl.createEl("h2", {text: "Settings for my awesome plugin."});
    //
    // // todo how to create a second view with HMR?
    // new Setting(containerEl).setName("Anthropic API Key").addText((text) =>
    //     text
    //         .setPlaceholder("Enter your Anthropic API Key")
    //         .setValue(this.plugin.settings.ANTHROPIC_API_KEY)
    //         .onChange(async (value) => {
    //             this.plugin.settings.ANTHROPIC_API_KEY = value;
    //             await this.plugin.saveSettings();
    //         }),
    // );
    //
    // new Setting(containerEl).setName("OpenAI API Key").addText((text) =>
    //     text
    //         .setPlaceholder("Enter your OpenAI API Key")
    //         .setValue(this.plugin.settings.OPENAI_API_KEY)
    //         .onChange(async (value) => {
    //             this.plugin.settings.OPENAI_API_KEY = value;
    //             await this.plugin.saveSettings();
    //         }),
    // );
    //
    // new Setting(containerEl).setName("RapidAPI Key").addText((text) =>
    //     text
    //         .setPlaceholder("Enter your RapidAPI Key")
    //         .setValue(this.plugin.settings.RAPIDAPI_KEY)
    //         .onChange(async (value) => {
    //             this.plugin.settings.RAPIDAPI_KEY = value;
    //             await this.plugin.saveSettings();
    //         }),
    // );
    //
    // new Setting(containerEl).setName("Chatbots Directory").addText((text) =>
    //     text
    //         .setPlaceholder("Enter chatbots directory")
    //         .setValue(this.plugin.settings.CHATBOTS_PATH)
    //         .onChange(async (value) => {
    //             this.plugin.settings.CHATBOTS_PATH = value;
    //             await this.plugin.saveSettings();
    //         }),
    // );
  }
}
