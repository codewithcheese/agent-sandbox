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
   * Get list of file paths that have changes (excluding directories)
   */
  private getAllChangedFilePaths(changes: ProposedChange[]): string[] {
    return changes
      .filter(change => !change.info.isDirectory) // Only files
      .map(change => change.path)
      .filter((path, index, arr) => arr.indexOf(path) === index) // Deduplicate
      .sort(); // Consistent ordering for predictable navigation
  }

  /**
   * Navigate to a different file
   */
  private async navigateToFile(direction: 'prev' | 'next'): Promise<void> {
    const chat = await Chat.load(this.state.chatPath);
    const allChanges = chat.vault.getFileChanges();
    const allChangedFiles = this.getAllChangedFilePaths(allChanges);
    
    if (allChangedFiles.length === 0) {
      new Notice("No files with changes remaining");
      this.leaf.detach();
      return;
    }
    
    // Find current position dynamically
    const currentIndex = allChangedFiles.indexOf(this.state.path);
    
    // Calculate new index with cycling
    let newIndex: number;
    if (currentIndex === -1) {
      // Current file not in list anymore, go to first file
      newIndex = 0;
    } else {
      if (direction === 'next') {
        // Cycle to first file if at the end
        newIndex = (currentIndex + 1) % allChangedFiles.length;
      } else {
        // Cycle to last file if at the beginning
        newIndex = currentIndex === 0 ? allChangedFiles.length - 1 : currentIndex - 1;
      }
    }
    
    if (newIndex === currentIndex && currentIndex !== -1) {
      return; // No change needed
    }
    
    // Navigate to new file - only update path, index computed on remount
    await this.setState({
      chatPath: this.state.chatPath,
      path: allChangedFiles[newIndex]
    }, null);
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
    viewContent.style.position = "relative"; // Create positioning context for control bar

    debug("Mount", this.state);

    const chat = await Chat.load(this.state.chatPath);
    
    // Get changes once and reuse (more efficient)
    const allChanges = chat.vault.getFileChanges();
    const allChangedFiles = this.getAllChangedFilePaths(allChanges);
    
    // Handle empty file list
    if (allChangedFiles.length === 0) {
      new Notice("No files with changes remaining");
      this.leaf.detach();
      return;
    }
    
    // Handle current file no longer in list
    if (!allChangedFiles.includes(this.state.path)) {
      // Auto-navigate to first available file
      await this.setState({
        chatPath: this.state.chatPath,
        path: allChangedFiles[0]
      }, null);
      return; // Will remount with new file
    }
    
    // Calculate current index dynamically
    const currentFileIndex = allChangedFiles.indexOf(this.state.path);
    
    // Get changes for current file
    const changes = allChanges.filter((c) => c.path === this.state.path);
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
        // NEW: Navigation props
        allChangedFiles: allChangedFiles,
        currentFileIndex: currentFileIndex,
        onNavigateFile: async (direction: 'prev' | 'next') => {
          await this.navigateToFile(direction);
        },
        onReject: async (
          resolvedContent: string,
          pendingContent: string,
          chunksLeft: number,
        ) => {
          const change = changes.find((c) =>
            ["create", "modify"].includes(c.type),
          );

          debug("Handling onReject", change, chunksLeft);

          if (chunksLeft === 0) {
            debug(`Rejecting ${change.type} changes`);
            await chat.vault.reject(change);
            chat.vault.computeChanges();
            await chat.save();
            
            // Check if there are other files with changes remaining
            const currentChanges = chat.vault.getFileChanges();
            const allChangedFiles = this.getAllChangedFilePaths(currentChanges);
            const otherFilesWithChanges = allChangedFiles.filter(filePath => filePath !== this.state.path);
            
            if (otherFilesWithChanges.length > 0) {
              // Navigate to the next file with changes
              debug("Navigating to next file with changes after reject:", otherFilesWithChanges[0]);
              await this.setState({
                chatPath: this.state.chatPath,
                path: otherFilesWithChanges[0]
              }, {});
            } else {
              // No more files with changes, close the merge view
              debug("No more files with changes after reject, closing merge view");
              this.leaf.detach();
            }
          }
        },
        onAccept: async (
          resolvedContent: string,
          pendingContent: string,
          chunksLeft: number,
        ) => {
          debug("On save", { resolvedContent, pendingContent, chunksLeft });

          const change = changes.find((c) =>
            ["create", "modify"].includes(c.type),
          );

          debug("Handling onAccept", change);

          if (!change) {
            new Notice(
              "Failed to save. Could not find proposed change for: " +
                this.state.path,
            );
            return;
          }
          if (resolvedContent) {
            try {
              await chat.vault.approve([
                {
                  type: change.type,
                  path: change.path,
                  override: { text: resolvedContent },
                },
              ]);
            } catch (e) {
              console.error(e);
              new Notice("Failed to approve change: " + e);
              return;
            }
          }
          if (
            // if some changes are remaining then apply them to the overlay
            resolvedContent !== pendingContent ||
            // OR if no changes are remaining but content has changed
            (chunksLeft === 0 && resolvedContent !== newContent)
          ) {
            const remaining = diff.createPatch(
              change.path,
              resolvedContent,
              pendingContent,
            );
            debug("Applying unapproved/resolved changes to overlay", remaining);
            await chat.vault.modify(currentFile, pendingContent);
          }
          chat.vault.computeChanges();
          debug("Remaining changes", $state.snapshot(chat.vault.changes));
          await chat.save();

          if (resolvedContent === pendingContent) {
            debug("File fully resolved, checking for other files with changes");
            
            // Check if there are other files with changes remaining
            const currentChanges = chat.vault.getFileChanges();
            const allChangedFiles = this.getAllChangedFilePaths(currentChanges);
            const otherFilesWithChanges = allChangedFiles.filter(filePath => filePath !== this.state.path);
            
            if (otherFilesWithChanges.length > 0) {
              // Navigate to the next file with changes
              debug("Navigating to next file with changes:", otherFilesWithChanges[0]);
              await this.setState({
                chatPath: this.state.chatPath,
                path: otherFilesWithChanges[0]
              }, {});
            } else {
              // No more files with changes, close the merge view
              debug("No more files with changes, closing merge view");
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
