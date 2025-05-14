import {
  MarkdownView,
  type WorkspaceLeaf,
  Plugin,
  type TFile,
  Component,
} from "obsidian";
import { usePlugin } from "$lib/utils";
import { createSystemContent } from "../../chat/system.ts";
import { AgentView } from "./agent-view.ts";
import { isAgent } from "../../chat/agents.svelte.ts";
import AgentBanner from "./AgentBanner.svelte";
import { mount, unmount } from "svelte";

export type BannerProps = {
  path: string;
  errors: string[];
  openRenderView: () => any;
  openMarkdownView: () => any;
  viewType: "MarkdownView" | "AgentView";
};

export class AgentBannerComponent extends Component {
  private plugin = usePlugin();
  private file: TFile;
  private target?: HTMLElement;
  private ref: any;
  private props = $state<BannerProps>({
    path: "",
    errors: [],
    openRenderView: () => {},
    openMarkdownView: () => {},
    viewType: "MarkdownView",
  });

  constructor(private view: MarkdownView | AgentView) {
    super();

    this.file = this.resolveFile();
    const { path } = this.file;

    Object.assign(this.props, {
      path,
      openRenderView: () => AgentView.open(this.file.path),
      openMarkdownView: () => this.view.leaf.openFile(this.file),
      viewType:
        this.view instanceof MarkdownView ? "MarkdownView" : "AgentView",
    });

    const refresh = async (file: TFile) => {
      if (file.path === path) await this.update();
    };

    this.registerEvent(this.plugin.app.vault.on("modify", refresh));
    this.registerEvent(this.plugin.app.metadataCache.on("changed", refresh));
  }

  async onload() {
    super.onload();
    await this.update();
  }

  async onunload() {
    await this.dispose();
    super.onunload();
  }

  async update(view?: MarkdownView | AgentView) {
    if (view) {
      this.file = this.resolveFile();
      this.props.path = this.file.path;
      this.props.errors = [];
    }

    if (isAgent(this.file)) {
      this.ensureMounted();
      await this.renderBanner();
    } else {
      await this.dispose();
    }
  }

  private async renderBanner() {
    try {
      this.props.errors = [];
      await createSystemContent(this.file, {
        template: { throwOnUndefined: true },
      });
    } catch (e) {
      this.props.errors = [(e as Error).message ?? String(e)];
    }
  }

  private ensureMounted() {
    if (!this.target) {
      const container = this.view.containerEl.querySelector(".view-content");
      this.target = document.createElement("div");
      container?.insertBefore(this.target, container.firstChild);
    }

    if (!this.ref) {
      this.ref = mount(AgentBanner, { target: this.target, props: this.props });
    }
  }

  private async dispose() {
    if (this.ref) {
      await unmount(this.ref);
      this.ref = null;
    }
    this.target?.remove();
    this.target = undefined;
  }

  private resolveFile() {
    if (this.view instanceof MarkdownView) return this.view.file;
    return this.plugin.app.vault.getFileByPath(this.view.path);
  }

  static register(plugin: Plugin) {
    console.log("Agent banner register plugin", plugin);
    plugin.registerEvent(
      plugin.app.workspace.on(
        "active-leaf-change",
        (leaf: WorkspaceLeaf | null) => {
          if (
            leaf &&
            (leaf.view instanceof MarkdownView ||
              leaf.view instanceof AgentView)
          ) {
            const { view } = leaf;
            if (
              "agentBanner" in view &&
              view.agentBanner instanceof AgentBannerComponent
            ) {
              view.agentBanner.update(view);
            } else {
              const agentBanner = new AgentBannerComponent(view);
              view.addChild(agentBanner);
              Object.defineProperty(view, "agentBanner", {
                value: agentBanner,
              });
            }
          }
        },
      ),
    );
  }
}
