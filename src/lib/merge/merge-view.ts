import { ItemView } from "obsidian";
import { mount, unmount } from "svelte";
import MergePage from "./MergePage.svelte";
import { Chat } from "../../chat/chat.svelte.ts";
import * as diff from "diff";
import { getBaseName } from "$lib/utils/path.ts";
import { getPatchStats } from "../../tools/tool-request.ts";

export const MERGE_VIEW_TYPE = "sandbox-merge-view";

export interface MergeViewState {
  chatPath: string;
  toolRequestId: string;
}

export class MergeView extends ItemView {
  private component: any = null;
  private state: MergeViewState | undefined;

  getViewType(): string {
    return MERGE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Merge View";
  }

  getIcon(): string {
    return "git-pull-request";
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

    console.log("Mount", this.state);

    const chat = await Chat.load(this.state.chatPath);

    const toolRequest = chat.toolRequests.find(
      (tr) => tr.id === this.state.toolRequestId,
    );
    if (!toolRequest) {
      throw new Error("Tool request not found");
    }
    if (toolRequest.type !== "modify") {
      throw new Error(`Merge does not support ${toolRequest.type} operations.`);
    }

    const file = this.app.vault.getAbstractFileByPath(toolRequest.path);
    const ogContent = await this.app.vault.adapter.read(file.path);

    const newContent = diff.applyPatch(ogContent, toolRequest.patch);

    // Mount the Svelte component with props
    this.component = mount(MergePage, {
      target: viewContent,
      props: {
        ogContent,
        newContent,
        name: getBaseName(toolRequest.path),
        onSave: async (resolvedContent: string, pendingContent: string) => {
          const remaining = diff.createPatch(
            toolRequest.path,
            resolvedContent,
            pendingContent,
          );
          await this.app.vault.adapter.write(toolRequest.path, resolvedContent);
          toolRequest.patch = remaining;
          toolRequest.stats = getPatchStats(remaining);
          if (toolRequest.stats.removed < 1 && toolRequest.stats.added < 1) {
            toolRequest.status = "success";
          }
          await chat.save();
        },
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

  getState(): Record<string, undefined> {
    console.log("Getting state", this.state);
    return this.state as any;
  }

  async setState(state: any, result: any): Promise<void> {
    this.state = state;
    await this.mount();
  }
}
