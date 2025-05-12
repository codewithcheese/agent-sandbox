import { ItemView, MarkdownView, Plugin, type TFile, Notice } from "obsidian";
import { isAgent } from "../../chat/agents.svelte.ts";
import { usePlugin } from "$lib/utils";
import { mount, unmount } from "svelte";
import AgentPage from "./AgentPage.svelte";
import { createSystemContent } from "../../chat/system.ts";

const AGENT_VIEW_TYPE = "sandbox-agent-view";

export class AgentView extends ItemView {
  path: string;
  private component: any = null;

  static async open(path: string) {
    console.log("AgentView open", path);
    const plugin = usePlugin();
    let { leaf } = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!leaf) {
      leaf = plugin.app.workspace.getLeaf(true);
    }
    await leaf.setViewState({
      type: AGENT_VIEW_TYPE,
      active: true,
      state: { path },
    });
  }

  static register(plugin: Plugin) {
    plugin.registerView(AGENT_VIEW_TYPE, (leaf) => new AgentView(leaf));
  }

  onload() {
    super.onload();
    this.addAction("markdown", "Markdown view", async () => {
      if (!this.path) return;
      const plugin = usePlugin();
      let { leaf } = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!leaf) {
        leaf = plugin.app.workspace.getLeaf(true);
      }
      const file = plugin.app.vault.getFileByPath(this.path);
      if (file) {
        await leaf.openFile(file);
      } else {
        new Notice(`File not found: ${this.path}`);
      }
    });
  }

  getViewType(): string {
    return AGENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    console.log("AgentView getDisplayText");
    const file = this.app.vault.getFileByPath(this.path);
    const name = file && isAgent(file);
    if (file && name) {
      return `${name}`;
    } else {
      return "Agent view";
    }
  }

  getState(): { path: string } {
    return {
      path: this.path,
    };
  }

  async setState(state: any, result: any): Promise<void> {
    this.path = state.path;
    await this.mount();
  }

  /**
   * Mount the Svelte component
   */
  private async mount(): Promise<void> {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    const viewContent = this.containerEl.children[1] as HTMLDivElement;
    viewContent.style.padding = "0px";
    viewContent.style.backgroundColor = "var(--background-primary)";

    const file = this.app.vault.getFileByPath(this.path) as TFile;
    if (!file) {
      throw new Error(`File not found: ${this.path}`);
    }

    let content = "";
    let errors: string[] = [];

    try {
      content = await createSystemContent(file, {
        template: { throwOnUndefined: true },
      });
    } catch (e) {
      errors.push(e.message || String(e));
      console.error("Error rendering agent content:", e);
    }

    // Mount the Svelte component with props
    this.component = mount(AgentPage, {
      target: viewContent,
      props: {
        name: isAgent(file) || file.basename,
        content,
        errors,
      },
    });
  }

  async onClose(): Promise<void> {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }
    await super.onClose();
  }
}
