import { ItemView, MarkdownView, normalizePath, Notice } from "obsidian";
import { mount, unmount } from "svelte";
import MergePage from "./MergePage.svelte";
import { Chat } from "../../chat/chat.svelte.ts";
import * as diff from "diff";
import { getBaseName } from "$lib/utils/path.ts";
import { findMatchingView } from "$lib/obsidian/leaf.ts";
import type { ProposedChange } from "../../chat/vault-overlay.svelte.ts";
import { createDebug } from "$lib/debug.ts";

const debug = createDebug();

export const MERGE_VIEW_TYPE = "sandbox-merge-view";

export interface MergeViewState {
  chatPath: string;
  path: string;
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
    const changes = chat.vault
      .getFileChanges()
      .filter((c) => c.path === this.state.path);
    if (!changes.length) {
      new Notice(`No changes for ${this.state.path}`);
      return;
    }

    const currentPath =
      changes.find((c) => c.type === "rename")?.info.oldPath || this.state.path;

    let currentContent = "";
    let currentFile = this.app.vault.getFileByPath(normalizePath(currentPath));
    if (currentFile) {
      currentContent = await this.app.vault.read(currentFile);
    }
    const newFile = chat.vault.getFileByPath(this.state.path);
    const newContent = await chat.vault.read(newFile);

    debug(`${currentPath} content on disk`, currentContent);
    debug(`${this.state.path} modified content`, newContent);
    debug("Changes", changes);

    // Mount the Svelte component with props
    this.component = mount(MergePage, {
      target: viewContent,
      props: {
        currentContent,
        newContent,
        name: getBaseName(this.state.path),
        onSave: async (resolvedContent: string, pendingContent: string) => {
          debug("On save", resolvedContent, pendingContent);

          const change = changes.find((c) =>
            ["create", "modify"].includes(c.type),
          );

          if (!change) {
            new Notice(
              "Failed to save. Could not find proposed change for: " +
                this.state.path,
            );
            return;
          }

          await chat.vault.approve([
            {
              type: change.type,
              path: change.path,
              override: { text: resolvedContent },
            },
          ]);
          // if some changes are remaining then apply them to the overlay
          if (resolvedContent !== pendingContent) {
            const remaining = diff.createPatch(
              change.path,
              resolvedContent,
              pendingContent,
            );
            debug("Applying unapproved changes to overlay", remaining);
            await chat.vault.modify(currentFile, pendingContent);
          }
          chat.vault.computeChanges();
          debug("Remaining changes", $state.snapshot(chat.vault.changes));
          await chat.save();

          if (resolvedContent === pendingContent) {
            debug("Closing merge view for path: ", change.path);
            const file = this.app.vault.getFileByPath(
              normalizePath(change.path),
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
