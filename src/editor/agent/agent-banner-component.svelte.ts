import {
  MarkdownView,
  type WorkspaceLeaf,
  Plugin,
  type TFile,
  Component,
  FileView,
} from "obsidian";
import { usePlugin } from "$lib/utils";
import { createSystemContent } from "../../chat/system.ts";
import { AgentView } from "./agent-view.ts";
import { isAgent } from "../../chat/agents.svelte.ts";
import AgentBanner from "./AgentBanner.svelte";
import { mount, unmount } from "svelte";
import { createDebug } from "$lib/debug.ts";
import { watchForRemoval } from "$lib/utils/dom.ts";

const debug = createDebug();

export type BannerProps = {
  path: string;
  errors: string[];
  openAgentView: () => any;
  openMarkdownView: () => any;
  viewType: "MarkdownView" | "AgentView";
};

export class AgentBannerComponent extends Component {
  private plugin = usePlugin();
  private target?: HTMLElement;
  private ref: any;
  private props = $state<BannerProps>({
    path: "",
    errors: [],
    openAgentView: () => {},
    openMarkdownView: () => {},
    viewType: "MarkdownView",
  });

  constructor(private leaf: WorkspaceLeaf) {
    super();

    debug("new AgentBannerComponent()", leaf);

    Object.assign(this.props, {
      path: this.getFile().path,
      openAgentView: () => AgentView.open(this.getFile()),
      openMarkdownView: () => this.leaf.openFile(this.getFile()),
      viewType: this.getViewType(),
    });

    const refresh = async (file: TFile) => {
      if (file.path === this.getFile().path) await this.update();
    };

    leaf.view.addChild(this);
    this.registerEvent(this.plugin.app.vault.on("modify", refresh));
    this.registerEvent(this.plugin.app.metadataCache.on("changed", refresh));
  }

  async onload() {
    super.onload();
    await this.update();
  }

  async onunload() {
    await this.unmount();
    super.onunload();
  }

  async update(leaf?: WorkspaceLeaf) {
    // // @ts-expect-error id not in type
    // debug("update()", leaf?.id);
    // @ts-expect-error id not in type
    if (leaf && leaf.id === this.leaf.id) {
      this.props.path = this.getFile().path;
      this.props.errors = [];
      this.props.viewType = this.getViewType();
      debug("props updated", this.props.path, this.props.viewType);
    }

    if (isAgent(this.getFile())) {
      this.mount();
      await this.updateBanner();
    } else {
      await this.unmount();
    }
  }

  private async updateBanner() {
    try {
      this.props.errors = [];
      await createSystemContent(this.getFile(), this.plugin.app.vault, this.plugin.app.metadataCache, {
        template: { throwOnUndefined: true },
      });
    } catch (e) {
      this.props.errors = [(e as Error).message ?? String(e)];
    }
  }

  private mount() {
    if (!this.target) {
      const container =
        this.leaf.view.containerEl.querySelector(".view-content");
      this.target = document.createElement("div");
      container?.insertBefore(this.target, container.firstChild);
      debug("new target created");
    }

    if (!this.ref) {
      this.ref = mount(AgentBanner, { target: this.target, props: this.props });
      // Switching from AgentView to Markdown view causes contentEl to be cleared
      // watch for target removal to unmount the component
      watchForRemoval(this.target, () => this.unmount());
      debug("mounted");
    } else {
      debug("mount skipped");
    }
  }

  private async unmount() {
    if (this.ref) {
      await unmount(this.ref);
      debug("unmounted");
      this.ref = null;
    }
    this.target?.remove();
    this.target = undefined;
    // debug("target removed");
  }

  private getFile() {
    if (this.leaf.view instanceof FileView) return this.leaf.view.file;
    debug("View not FileView. File undefined.");
    return undefined;
  }

  private getViewType() {
    return this.leaf.view instanceof MarkdownView
      ? "MarkdownView"
      : this.leaf.view instanceof AgentView
        ? "AgentView"
        : null;
  }

  static register(plugin: Plugin) {
    debug("AgentBannerComponent.register");
    plugin.registerEvent(
      plugin.app.workspace.on(
        "active-leaf-change",
        async (
          leaf: (WorkspaceLeaf & { agentBanner?: AgentBannerComponent }) | null,
        ) => {
          if (
            leaf &&
            (leaf.view instanceof MarkdownView ||
              leaf.view instanceof AgentView)
          ) {
            if (leaf.agentBanner) {
              await leaf.agentBanner.update(leaf);
            } else {
              leaf.agentBanner = new AgentBannerComponent(leaf);
            }
          }
        },
      ),
    );
  }
}
