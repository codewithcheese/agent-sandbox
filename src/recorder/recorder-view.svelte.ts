import {
  ItemView,
  Plugin,
  WorkspaceLeaf,
} from "obsidian";
import { mount, unmount } from "svelte";
import RecorderPage from "./RecorderPage.svelte";

export const RECORDER_VIEW_TYPE = "sandbox-recorder-view";

export class RecorderView extends ItemView {
  private component: any = null;

  getViewType(): string {
    return RECORDER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Recorder";
  }

  getIcon(): string {
    return "mic";
  }

  async onOpen() {
    await this.mount();
  }

  async onClose() {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }
    await super.onClose();
  }

  private async mount() {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    const viewContent = this.containerEl.children[1] as HTMLDivElement;
    viewContent.style.padding = "0px";
    viewContent.style.backgroundColor = "var(--background-primary)";

    // Mount the Svelte component
    this.component = mount(RecorderPage, {
      target: viewContent,
      props: {},
    });
  }

  static register(plugin: Plugin) {
    plugin.registerView(RECORDER_VIEW_TYPE, (leaf) => new RecorderView(leaf));
    
    // Add ribbon icon to open the recorder view
    plugin.addRibbonIcon("mic", "Open Recorder", async () => {
      await RecorderView.openRecorderView();
    });
  }

  static async openRecorderView(): Promise<RecorderView> {
    const plugin = window.Env.Plugin;

    // Try to find existing recorder view in left sidebar
    const existingRecorderLeaves = plugin.app.workspace.getLeavesOfType(
      RECORDER_VIEW_TYPE,
    );

    let leaf: WorkspaceLeaf;

    if (existingRecorderLeaves.length > 0) {
      leaf = existingRecorderLeaves[0];
      await plugin.app.workspace.revealLeaf(leaf);
    } else {
      // Create new leaf in left sidebar
      leaf = plugin.app.workspace.getLeftLeaf(false);
      await leaf.setViewState({
        type: RECORDER_VIEW_TYPE,
        active: true,
      });
      await plugin.app.workspace.revealLeaf(leaf);
    }

    return leaf.view as RecorderView;
  }
}
