import {
  ItemView,
  MarkdownView,
  normalizePath,
  Notice,
  type TAbstractFile,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { mount, unmount } from "svelte";
import MergePage from "./MergePage.svelte";
import { Chat } from "../../chat/chat.svelte.ts";
import * as diff from "diff";
import { getBaseName } from "$lib/utils/path.ts";
import { findMatchingView } from "$lib/obsidian/leaf.ts";
import type { ProposedChange } from "../../chat/vault-overlay.svelte.ts";
import { createDebug } from "$lib/debug.ts";
import { usePlugin } from "$lib/utils";
import { Text, EditorState, Transaction, ChangeSet } from "@codemirror/state";
import {
  updateOriginalDoc,
  unifiedMergeView,
  getChunks,
  getOriginalDoc,
} from "@codemirror/merge";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
import { gnosis } from "@glifox/gnosis";
import { obsidianTheme } from "./theme.ts";

const debug = createDebug();

export const MERGE_VIEW_TYPE = "sandbox-merge-view";

export interface MergeViewState {
  chatPath: string;
  path: string;
}

export type NavigationState = {
  totalChunks: number;
  currentChunkIndex: number;
  changedFilePaths: string[];
  currentFilePathIndex: number;
};

export class MergeView extends ItemView {
  private component: any = null;
  private state: MergeViewState | undefined;
  private editorView: EditorView | null = null;

  // Store content as properties for comparison
  private currentContent: string = "";
  private newContent: string = "";
  private navigationState = $state<NavigationState>({
    totalChunks: 0,
    currentChunkIndex: 0,
    changedFilePaths: [],
    currentFilePathIndex: 0,
  });

  navigation = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.registerEvent(
      this.app.vault.on("modify", (file) => this.onVaultModify(file)),
    );
  }

  onVaultModify(file: TAbstractFile) {
    if (file instanceof TFile && file.path === this.state?.path) {
      return this.refreshContent();
    }
  }

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
  private getChangedFilePaths(changes: ProposedChange[]): string[] {
    return changes
      .filter((change) => !change.info.isDirectory) // Only files
      .map((change) => change.path)
      .filter((path, index, arr) => arr.indexOf(path) === index) // Deduplicate
      .sort(); // Consistent ordering for predictable navigation
  }

  /**
   * Navigate to a different file
   */
  private async navigateToFile(direction: "prev" | "next"): Promise<void> {
    const chat = await Chat.load(this.state.chatPath);
    const allChanges = chat.vault.getFileChanges();
    const allChangedFiles = this.getChangedFilePaths(allChanges);

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
      if (direction === "next") {
        // Cycle to first file if at the end
        newIndex = (currentIndex + 1) % allChangedFiles.length;
      } else {
        // Cycle to last file if at the beginning
        newIndex =
          currentIndex === 0 ? allChangedFiles.length - 1 : currentIndex - 1;
      }
    }

    if (newIndex === currentIndex && currentIndex !== -1) {
      return; // No change needed
    }

    // Navigate to new file - only update path, index computed on remount
    await this.setState(
      {
        chatPath: this.state.chatPath,
        path: allChangedFiles[newIndex],
      },
      null,
    );
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
    const changedFilePaths = this.getChangedFilePaths(allChanges);

    // Handle empty file list
    if (changedFilePaths.length === 0) {
      new Notice("No files with changes remaining");
      this.leaf.detach();
      return;
    }

    // Handle current file no longer in list
    if (!changedFilePaths.includes(this.state.path)) {
      // Auto-navigate to first available file
      await this.setState(
        {
          chatPath: this.state.chatPath,
          path: changedFilePaths[0],
        },
        null,
      );
      return; // Will remount with new file
    }

    this.updateNavigationState(allChanges);

    // Get changes for current file
    const pathChanges = allChanges.filter((c) => c.path === this.state.path);
    if (!pathChanges.length) {
      new Notice(`No changes for ${this.state.path}`);
      return;
    }

    const currentPath =
      pathChanges.find((c) => c.type === "rename")?.info.oldPath ||
      this.state.path;

    // Read and store content as properties
    let currentFile = this.app.vault.getFileByPath(normalizePath(currentPath));
    if (currentFile) {
      this.currentContent = await this.app.vault.read(currentFile);
    } else {
      this.currentContent = "";
    }
    const newFile = chat.vault.getFileByPath(this.state.path);
    this.newContent = await chat.vault.read(newFile);

    debug(`${currentPath} content on disk`, this.currentContent);
    debug(`${this.state.path} modified content`, this.newContent);
    debug("Changes", pathChanges);

    // Destroy existing editor if it exists
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    // Create CodeMirror editor in MergeView
    this.editorView = new EditorView({
      state: EditorState.create({
        doc: this.newContent,
        extensions: [
          drawSelection(),
          keymap.of([...defaultKeymap, indentWithTab]),
          history(),
          EditorView.lineWrapping,
          EditorView.updateListener.of(async (v) => {
            // Update chunk info when content changes
            this.updateChunkInfo();

            // Check for accept/reject actions
            if (
              v.transactions.some(
                (tr) => tr.annotation(Transaction.userEvent) === "accept",
              )
            ) {
              await this.acceptChange(v.state);
            }

            if (
              v.transactions.some(
                (tr) => tr.annotation(Transaction.userEvent) === "revert",
              )
            ) {
              await this.rejectChange(v.state);
            }
          }),
          unifiedMergeView({
            original: this.currentContent,
            gutter: false,
          }),
          (gnosis() as any[]).toSpliced(1, 1), // splice out the gnosis theme
          obsidianTheme,
        ],
      }),
      // Don't attach to DOM yet - Svelte will handle that
    });

    // Initialize chunk info
    this.updateChunkInfo();

    // Mount the Svelte component with props
    this.component = mount(MergePage, {
      target: viewContent,
      props: {
        editorView: this.editorView,
        name: getBaseName(this.state.path),
        navigationState: this.navigationState,
        onNavigateFile: async (direction: "prev" | "next") => {
          await this.navigateToFile(direction);
        },
        // Bulk operation callbacks
        onAcceptAll: async () => {
          await this.acceptAllChunks();
        },
        onRejectAll: async () => {
          await this.rejectAllChunks();
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

  private updateChunkInfo(): void {
    if (!this.editorView) return;

    const chunkInfo = getChunks(this.editorView.state);
    this.navigationState.totalChunks = chunkInfo?.chunks.length || 0;

    // Reset to first chunk when chunks change
    if (
      this.navigationState.currentChunkIndex >= this.navigationState.totalChunks
    ) {
      this.navigationState.currentChunkIndex = 0;
    }
    debug("Navigation state", this.navigationState);
  }

  private updateNavigationState(changes: ProposedChange[]) {
    this.navigationState.changedFilePaths = this.getChangedFilePaths(changes);
    this.navigationState.currentFilePathIndex =
      this.navigationState.changedFilePaths.indexOf(this.state.path);
  }

  async refreshContent(): Promise<void> {
    try {
      const chat = await Chat.load(this.state.chatPath);

      // Get changes for current file to determine paths
      const allChanges = chat.vault.getFileChanges();
      this.updateNavigationState(allChanges);

      const pathChanges = allChanges.filter((c) => c.path === this.state.path);

      if (!pathChanges.length) {
        debug("No changes found for current file, skipping refresh");
        return;
      }

      const currentPath =
        pathChanges.find((c) => c.type === "rename")?.info.oldPath ||
        this.state.path;

      // Read latest content from both sources
      let latestCurrentContent = "";
      const currentFile = this.app.vault.getFileByPath(
        normalizePath(currentPath),
      );
      if (currentFile) {
        latestCurrentContent = await this.app.vault.read(currentFile);
      }

      const newFile = chat.vault.getFileByPath(this.state.path);
      const latestNewContent = await chat.vault.read(newFile);

      // Compare with stored content
      const currentContentChanged =
        latestCurrentContent !== this.currentContent;
      const newContentChanged = latestNewContent !== this.newContent;

      if (currentContentChanged || newContentChanged) {
        debug(
          `Content changed - Current: ${currentContentChanged}, New: ${newContentChanged}`,
        );
        debug(`Old new content length: ${this.newContent.length}`);
        debug(`New new content length: ${latestNewContent.length}`);

        if (currentContentChanged) {
          const newDoc = Text.of(latestCurrentContent.split("\n"));

          const oldDoc = getOriginalDoc(this.editorView.state);
          const changes = ChangeSet.of(
            { from: 0, to: oldDoc.length, insert: latestCurrentContent },
            oldDoc.length, // length of the old original
          );

          this.editorView.dispatch({
            effects: updateOriginalDoc.of({ doc: newDoc, changes }),
          });

          this.currentContent = latestCurrentContent;
        }

        if (newContentChanged) {
          // Update editor content
          this.editorView?.dispatch({
            changes: {
              from: 0,
              to: this.editorView.state.doc.length,
              insert: latestNewContent,
            },
          });
          this.newContent = latestNewContent;
        }

        // Update chunk info after content changes
        this.updateChunkInfo();
      } else {
        debug("No content changes detected");
      }
    } catch (error) {
      console.error("Error refreshing content:", error);
      // Fallback to full remount
      await this.mount();
    }
  }

  private async acceptChange(state: EditorState): Promise<void> {
    if (!this.editorView) return;
    try {
      const chunkInfo = getChunks(state);
      const resolvedContent = getOriginalDoc(state).toString();
      const pendingContent = state.doc.toString();

      // Call the onAccept callback from the component props
      this.onAccept(resolvedContent, pendingContent, chunkInfo.chunks.length);
    } catch (error) {
      console.error("Error accepting changes:", error);
      new Notice(`Error accepting changes: ${(error as Error).message}`);
    }
  }

  private async rejectChange(state: EditorState): Promise<void> {
    if (!this.editorView) return;
    try {
      const chunkInfo = getChunks(state);
      const resolvedContent = getOriginalDoc(state).toString();
      const pendingContent = state.doc.toString();

      // Call the onReject callback from the component props
      this.onReject(resolvedContent, pendingContent, chunkInfo.chunks.length);
    } catch (error) {
      console.error("Error rejecting changes:", error);
      new Notice(`Error rejecting changes: ${(error as Error).message}`);
    }
  }

  private async acceptAllChunks(): Promise<void> {
    if (!this.editorView) return;
    try {
      // Accept all: resolved content = new content (accept all changes)
      const resolvedContent = this.newContent;
      const pendingContent = this.newContent;
      const chunksLeft = 0; // No chunks remaining

      // Call the onAccept method
      await this.onAccept(resolvedContent, pendingContent, chunksLeft);
    } catch (error) {
      console.error("Error accepting all changes:", error);
      new Notice(`Error accepting all changes: ${(error as Error).message}`);
    }
  }

  private async rejectAllChunks(): Promise<void> {
    if (!this.editorView) return;
    try {
      // Reject all: resolved content = original content (reject all changes)
      const resolvedContent = this.currentContent;
      const pendingContent = this.currentContent;
      const chunksLeft = 0; // No chunks remaining

      // Call the onReject method
      await this.onReject(resolvedContent, pendingContent, chunksLeft);
    } catch (error) {
      console.error("Error rejecting all changes:", error);
      new Notice(`Error rejecting all changes: ${(error as Error).message}`);
    }
  }

  private async onAccept(
    resolvedContent: string,
    pendingContent: string,
    chunksLeft: number,
  ): Promise<void> {
    debug("On save", { resolvedContent, pendingContent, chunksLeft });

    const chat = await Chat.load(this.state.chatPath);
    const changes = chat.vault
      .getFileChanges()
      .filter((c) => c.path === this.state.path);
    const change = changes.find((c) => ["create", "modify"].includes(c.type));

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
      (chunksLeft === 0 && resolvedContent !== this.newContent)
    ) {
      const remaining = diff.createPatch(
        change.path,
        resolvedContent,
        pendingContent,
      );
      debug("Applying unapproved/resolved changes to overlay", remaining);
      const currentFile = this.app.vault.getFileByPath(
        normalizePath(this.state.path),
      );
      if (currentFile) {
        await chat.vault.modify(currentFile, pendingContent);
      }
    }

    chat.vault.computeChanges();
    debug("Remaining changes", $state.snapshot(chat.vault.changes));
    await chat.save();

    if (resolvedContent === pendingContent) {
      debug("File fully resolved, checking for other files with changes");

      // Check if there are other files with changes remaining
      const currentChanges = chat.vault.getFileChanges();
      const allChangedFiles = this.getChangedFilePaths(currentChanges);
      const otherFilesWithChanges = allChangedFiles.filter(
        (filePath) => filePath !== this.state.path,
      );

      if (otherFilesWithChanges.length > 0) {
        // Navigate to the next file with changes
        debug(
          "Navigating to next file with changes:",
          otherFilesWithChanges[0],
        );
        await this.setState(
          {
            chatPath: this.state.chatPath,
            path: otherFilesWithChanges[0],
          },
          {},
        );
      } else {
        // No more files with changes, close the merge view
        debug("No more files with changes, closing merge view");
        const file = this.app.vault.getFileByPath(normalizePath(change.path));
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
  }

  private async onReject(
    resolvedContent: string,
    pendingContent: string,
    chunksLeft: number,
  ): Promise<void> {
    const chat = await Chat.load(this.state.chatPath);
    const changes = chat.vault
      .getFileChanges()
      .filter((c) => c.path === this.state.path);
    const change = changes.find((c) => ["create", "modify"].includes(c.type));

    debug("Handling onReject", change, chunksLeft);

    if (chunksLeft === 0) {
      debug(`Rejecting ${change.type} changes`);
      await chat.vault.reject(change);
      chat.vault.computeChanges();
      await chat.save();

      // Check if there are other files with changes remaining
      const currentChanges = chat.vault.getFileChanges();
      const allChangedFiles = this.getChangedFilePaths(currentChanges);
      const otherFilesWithChanges = allChangedFiles.filter(
        (filePath) => filePath !== this.state.path,
      );

      if (otherFilesWithChanges.length > 0) {
        // Navigate to the next file with changes
        debug(
          "Navigating to next file with changes after reject:",
          otherFilesWithChanges[0],
        );
        await this.setState(
          {
            chatPath: this.state.chatPath,
            path: otherFilesWithChanges[0],
          },
          {},
        );
      } else {
        // No more files with changes, close the merge view
        debug("No more files with changes after reject, closing merge view");
        this.leaf.detach();
      }
    }
  }

  /**
   * Static function to automatically open merge view when changes are detected
   * Only opens if merge view is not already open
   */
  static async openForChanges(chatPath: string): Promise<void> {
    const plugin = usePlugin();
    debug("Opening merge view for changes", chatPath);

    try {
      const chat = await Chat.load(chatPath);
      const changes = chat.vault.getFileChanges();
      debug("All changes", changes);

      // Filter to file changes only (exclude directories)
      const fileChanges = changes.filter((change) => !change.info.isDirectory);

      if (fileChanges.length === 0) {
        debug("No file changes to display");
        return;
      }

      // Check if merge view is already open
      const existingLeaf =
        plugin.app.workspace.getLeavesOfType(MERGE_VIEW_TYPE)[0];
      const existingView = existingLeaf?.view as MergeView;

      if (existingView) {
        // Always refresh - let refreshContent() do the content comparison
        debug(`Refreshing merge view content`);
        await existingView.refreshContent();

        // Focus the existing view
        return plugin.app.workspace.revealLeaf(existingLeaf);
      }

      // Open new merge view with first file that has changes
      const firstFileWithChanges = fileChanges[0].path;
      debug("Opening merge view for first file", firstFileWithChanges);

      const leaf = plugin.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type: MERGE_VIEW_TYPE,
        state: {
          chatPath,
          path: firstFileWithChanges,
        },
      });

      return plugin.app.workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("Error opening merge view:", error);
      new Notice(`Error opening merge view: ${(error as Error).message}`);
    }
  }
}
