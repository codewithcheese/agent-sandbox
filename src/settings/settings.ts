import { App, PluginSettingTab } from "obsidian";
import AgentSandboxPlugin from "../plugin.ts";
import SettingsPage from "./SettingsPage.svelte";
import {
  type ChatModel,
  type EmbeddingModel,
  models,
  type TranscriptionModel,
} from "./models.ts";
import type { AIAccount } from "./providers.ts";
import { mount, unmount } from "svelte";

export interface PluginSettings {
  services: {
    rapidapi: {
      name: string;
      apiKey: string;
    };
  };
  defaults: {
    modelId: string;
    accountId: string;
  };
  vault: {
    chatbotsPath: string;
    chatsPath: string;
  };
  accounts: AIAccount[];
  models: (ChatModel | EmbeddingModel | TranscriptionModel)[];
  recording: {
    modelId?: string;
    accountId?: string;
    language?: string;
  };
}

export const DEFAULT_SETTINGS: PluginSettings = {
  services: {
    rapidapi: {
      name: "RapidAPI",
      apiKey: "",
    },
  },
  defaults: {
    modelId: "",
    accountId: "",
  },
  vault: {
    chatbotsPath: "chatbots",
    chatsPath: "chats",
  },
  accounts: [],
  models,
  recording: {},
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
