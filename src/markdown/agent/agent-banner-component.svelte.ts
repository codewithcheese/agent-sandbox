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
  protected file: TFile;
  protected target: HTMLElement;
  protected ref: any;
  protected props = $state<BannerProps>({} as any);

  constructor(protected view: MarkdownView | AgentView) {
    super();
    const plugin = usePlugin();
    this.file = this.getFile();
    this.props.path = this.file.path;
    this.props.errors = [];
    this.props.openRenderView = () => AgentView.open(this.file.path);
    this.props.openMarkdownView = () => view.leaf.openFile(this.file);
    this.props.viewType =
      this.view instanceof MarkdownView ? "MarkdownView" : "AgentView";
    this.registerEvent(
      plugin.app.vault.on("modify", async (file: TFile) => {
        if (file.path === this.file.path) {
          await this.update();
        }
      }),
    );
    plugin.registerEvent(
      plugin.app.metadataCache.on("changed", async (file: TFile) => {
        if (file.path === this.file.path) {
          await this.update();
        }
      }),
    );
  }

  insertTarget() {
    const viewEl = this.view.containerEl.querySelector(".view-content");
    this.target = document.createElement("div");
    if (viewEl) {
      if (viewEl.firstChild) {
        viewEl.insertBefore(this.target, viewEl.firstChild);
      } else {
        viewEl.appendChild(this.target);
      }
    }
  }

  removeTarget() {
    if (this.target) {
      this.target.remove();
      this.target = undefined;
    }
  }

  getFile() {
    if (this.view instanceof MarkdownView) {
      return this.view.file;
    } else if (this.view instanceof AgentView) {
      const plugin = usePlugin();
      return plugin.app.vault.getFileByPath(this.view.path);
    }
  }

  async onload() {
    super.onload();
    await this.update();
  }

  async update() {
    if (isAgent(this.file)) {
      if (!this.target) {
        this.insertTarget();
      }
      if (!this.ref) {
        this.ref = mount(AgentBanner, {
          target: this.target,
          props: this.props,
        });
      }
      await this.rerender();
    } else {
      if (this.ref) {
        await unmount(this.ref);
        this.ref = null;
      }
      if (this.target) {
        this.removeTarget();
      }
    }
  }

  async rerender() {
    try {
      this.props.errors = [];
      await createSystemContent(this.file, {
        template: { throwOnUndefined: true },
      });
    } catch (e) {
      this.props.errors.push(e.message || String(e));
    }
  }

  static register(plugin: Plugin) {
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
            if ("agentBanner" in view) return;
            const agentBanner = new AgentBannerComponent(view);
            view.addChild(agentBanner);
            Object.defineProperty(view, "agentBanner", { value: agentBanner });
          }
        },
      ),
    );
  }
}
