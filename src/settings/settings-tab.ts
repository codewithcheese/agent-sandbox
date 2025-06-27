import { App, PluginSettingTab } from "obsidian";
import AgentSandboxPlugin from "../plugin.ts";
import SettingsPage from "./SettingsPage.svelte";
import { mount, unmount } from "svelte";
import { Agents } from "../chat/agents.svelte.ts";
import { usePlugin } from "$lib/utils";

export class SettingsTab extends PluginSettingTab {
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
