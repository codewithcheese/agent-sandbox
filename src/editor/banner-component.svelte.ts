import { MarkdownView, type WorkspaceLeaf, Plugin, type TFile } from "obsidian";
import { SvelteComponent } from "$lib/obsidian/svelte-component.svelte.ts";
import AgentBanner from "./AgentBanner.svelte";
import { usePlugin } from "$lib/utils";
import { createSystemContent } from "../chat/system.ts";
import { AgentView } from "./agent-view.ts";

export type BannerProps = {
  path: string;
  errors: string[];
  openRenderView: () => any;
  openMarkdownView: () => any;
  viewType: "MarkdownView" | "AgentView";
};

export class BannerComponent extends SvelteComponent<BannerProps> {
  file: TFile;

  constructor(view: MarkdownView | AgentView) {
    const path = view instanceof MarkdownView ? view.file.path : view.path;
    super(AgentBanner, view.containerEl.querySelector(".view-content"), {
      path,
      errors: [],
      viewType: view instanceof MarkdownView ? "MarkdownView" : "AgentView",
      openPreview: () => {},
    });
    const plugin = usePlugin();
    if (view instanceof MarkdownView) {
      this.file = view.file;
    } else if (view instanceof AgentView) {
      this.file = plugin.app.vault.getFileByPath(view.path);
    }
    this.props.openRenderView = () => AgentView.open(this.file.path);
    this.props.openMarkdownView = () => view.leaf.openFile(this.file);
    this.registerEvent(
      plugin.app.vault.on("modify", (file: TFile) => this.render()),
    );
  }

  async onload() {
    // re-assign target to be first child of view el
    const viewEl = this.target;
    this.target = document.createElement("div");
    if (viewEl) {
      if (viewEl.firstChild) {
        viewEl.insertBefore(this.target, viewEl.firstChild);
      } else {
        viewEl.appendChild(this.target);
      }
    }
    super.onload();
    await this.render();
  }

  async render() {
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
            // todo: check frontmatter for agent flag
            const { view } = leaf;
            if ("agentBanner" in view) return;
            const agentBanner = new BannerComponent(view);
            view.addChild(agentBanner);
            Object.defineProperty(view, "agentBanner", { value: agentBanner });
          }
        },
      ),
    );
    plugin.registerEvent(
      plugin.app.metadataCache.on("changed", (file: TFile) => {
        // todo: check frontmatter for agent flag
      }),
    );
  }
}
