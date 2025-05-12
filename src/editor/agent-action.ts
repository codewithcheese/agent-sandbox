import { usePlugin } from "$lib/utils";
import { MarkdownView, type WorkspaceLeaf } from "obsidian";
import { AgentView } from "./agent-view.ts";
import { isAgent } from "../chat/agents.svelte.ts";

export class AgentAction {
  constructor() {
    const plugin = usePlugin();
    plugin.registerEvent(
      plugin.app.workspace.on(
        "active-leaf-change",
        (leaf: WorkspaceLeaf | null) => leaf && this.tryAddAction(leaf),
      ),
    );
  }

  private tryAddAction(leaf: WorkspaceLeaf) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    if (!isAgent(view.file)) return;

    if ("agentAction" in view) return;
    Object.defineProperty(view, "agentAction", {
      value: view.addAction("bot", "Agent view", () =>
        this.onActionClick(view),
      ),
    });
  }

  async onActionClick(view: MarkdownView) {
    await AgentView.open(view.file.path);
  }
}
