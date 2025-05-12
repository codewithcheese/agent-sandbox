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
import { Agents } from "../chat/agents.svelte.ts";
import { usePlugin } from "$lib/utils";

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
    chatsPath: string;
  };
  accounts: AIAccount[];
  models: (ChatModel | EmbeddingModel | TranscriptionModel)[];
  recording: {
    modelId?: string;
    accountId?: string;
    language?: string;
  };
  title: {
    prompt: string;
    accountId?: string;
    modelId?: string;
  };
  agents: {
    templateRepairAgentPath: string;
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
    chatsPath: "chats",
  },
  accounts: [],
  models,
  recording: {},
  agents: {
    templateRepairAgentPath: "",
  },
  title: {
    prompt: `Your task is to generate a short and concise title that summarizes the main topic or theme of the conversation.

<conversation>
{{ conversation }}
</conversation>

Guidelines for creating the title:
1. Keep the title brief, ideally 3-7 words.
2. Capture the main topic or theme of the conversation.
3. Use clear and simple language.
4. Avoid using specific names unless they are crucial to the main topic.
5. Do not include unnecessary details or tangential information.

Generate the title and output it within <title> tags. Do not include any explanation or additional text outside the tags.`,
    accountId: "",
    modelId: "",
  },
};

export class Settings extends PluginSettingTab {
  protected component: any;

  constructor(app: App, plugin: AgentSandboxPlugin) {
    super(app, plugin);
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    const plugin = usePlugin();
    await plugin.loadSettings();
    this.component = mount(SettingsPage, {
      target: containerEl,
      props: {
        agents: await Agents.load(),
      },
    });
  }

  async hide() {
    if (this.component) {
      await unmount(this.component);
    }
  }
}
