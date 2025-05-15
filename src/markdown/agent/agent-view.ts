import {
  ItemView,
  MarkdownView,
  Plugin,
  type TFile,
  Notice,
  FileView,
} from "obsidian";
import { isAgent } from "../../chat/agents.svelte.ts";
import { usePlugin } from "$lib/utils";
import { mount, unmount } from "svelte";
import AgentPage from "./AgentPage.svelte";
import { createSystemContent } from "../../chat/system.ts";
import { createDebug } from "$lib/debug.ts";

const debug = createDebug();

const AGENT_VIEW_TYPE = "sandbox-agent-view";

export class AgentView extends FileView {
  private component: any = null;
  navigation = true;

  static async open(file: TFile) {
    debug("this.open", file);
    const plugin = usePlugin();
    let { leaf } = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!leaf) {
      leaf = plugin.app.workspace.getLeaf(true);
    }
    await leaf.setViewState({
      type: AGENT_VIEW_TYPE,
      state: {
        file: file.path,
      },
    });
  }

  static register(plugin: Plugin) {
    plugin.registerView(AGENT_VIEW_TYPE, (leaf) => new AgentView(leaf));
  }

  onload() {
    super.onload();
    this.addAction("markdown", "Markdown view", async () => {
      const plugin = usePlugin();
      let { leaf } = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!leaf) {
        leaf = plugin.app.workspace.getLeaf(true);
      }
      await leaf.openFile(this.file);
    });
  }

  getViewType(): string {
    return AGENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    const name = this.file && isAgent(this.file);
    if (name) {
      return `${name}`;
    } else {
      return "Agent view";
    }
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
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

    let content = "";
    let errors: string[] = [];

    try {
      content = await createSystemContent(this.file, {
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
        name: isAgent(this.file) || this.file.basename,
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
