import { ItemView, MarkdownView, normalizePath } from "obsidian";
import { mount, unmount } from "svelte";
import MergePage from "./MergePage.svelte";
import { Chat } from "../../chat/chat.svelte.ts";
import * as diff from "diff";
import { getBaseName } from "$lib/utils/path.ts";
import { getPatchStats } from "../../tools/tool-request.ts";
import { findMatchingView } from "$lib/obsidian/leaf.ts";
import type { ProposedChange } from "../../chat/vault-overlay.svelte.ts";
import { createDebug } from "$lib/debug.ts";

const debug = createDebug();

export const MERGE_VIEW_TYPE = "sandbox-merge-view";

export interface MergeViewState {
  chatPath: string;
  change: ProposedChange;
}

export class MergeView extends ItemView {
  private component: any = null;
  private state: MergeViewState | undefined;
  navigation = false;

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

    debug("Mount", this.state);

    const chat = await Chat.load(this.state.chatPath);

    let ogContent = "";
    let ogFile = this.app.vault.getFileByPath(
      normalizePath(this.state.change.path),
    );
    if (ogFile) {
      ogContent = await this.app.vault.read(ogFile);
    }
    const newFile = chat.vault.getFileByPath(
      normalizePath(this.state.change.path),
    );
    const newContent = await chat.vault.read(newFile);

    debug(`${this.state.change.path} content on disk`, ogContent);
    debug(`${this.state.change.path} modified content`, newContent);

    // Mount the Svelte component with props
    this.component = mount(MergePage, {
      target: viewContent,
      props: {
        ogContent,
        newContent,
        name: getBaseName(this.state.change.path),
        onSave: async (resolvedContent: string, pendingContent: string) => {
          debug("On save", resolvedContent, pendingContent);
          await chat.vault.approve([
            {
              type: "modify",
              path: this.state.change.path,
              override: { text: resolvedContent },
            },
          ]);
          // if some changes are remaining then apply them to the overlay
          if (resolvedContent !== pendingContent) {
            const remaining = diff.createPatch(
              this.state.change.path,
              resolvedContent,
              pendingContent,
            );
            debug("Applying unapproved changes to overlay", remaining);
            await chat.vault.modify(ogFile, pendingContent);
          }
          chat.vault.computeChanges();
          debug("Remaining changes", $state.snapshot(chat.vault.changes));
          await chat.save();

          if (resolvedContent === pendingContent) {
            debug("Closing merge view for path: ", this.state.change.path);
            const file = this.app.vault.getFileByPath(
              normalizePath(this.state.change.path),
            );
            const view = findMatchingView(
              MarkdownView,
              (view) => view.file.path === file.path,
            );
            if (view) {
              await this.app.workspace.revealLeaf(view.leaf);
              this.leaf.detach();
            } else {
              const leaf = this.app.workspace.getLeaf(true);
              await leaf.openFile(file);
              this.leaf.detach();
            }
          }
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
    debug("State", this.state);
    return this.state as any;
  }

  async setState(state: any, result: any): Promise<void> {
    this.state = state;
    await this.mount();
  }
}
