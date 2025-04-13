import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { getOriginalDoc, unifiedMergeView } from "@codemirror/merge";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";

/**
 * todo: add title
 * todo: add margins (sizer)
 */

export const MERGE_VIEW_TYPE = "merge-view";

export interface MergeViewState {
  originalFilePath?: string;
  proposedContent?: string;
}

export class MergeView extends ItemView {
  private editorView: EditorView | null = null;
  private originalContent: string = "";
  private proposedContent: string = "";
  private originalFilePath: string = "";
  private initialized: boolean = false;
  private hasUnsavedChanges: boolean = false;

  getViewType(): string {
    return MERGE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Merge View";
  }

  getIcon(): string {
    return "git-pull-request";
  }

  async onOpen(): Promise<void> {
    console.log("MergeView state", this.getState());

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("markdown-source-view");
    container.addClass("mod-cm6");

    // Add unsaved changes indicator
    this.createUnsavedIndicator(container as HTMLElement);

    // Create the editor container
    const editorContainer = container.createDiv("merge-editor-container");
    editorContainer.style.height = "100%";

    // Create the editor with current content
    this.createEditor(editorContainer);
    this.initialized = true;
  }

  /**
   * Create or update the editor instance
   */
  private createEditor(container: HTMLElement): void {
    // Destroy existing editor if it exists
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    // Create the editor
    this.editorView = new EditorView({
      state: EditorState.create({
        doc: this.proposedContent,
        extensions: [
          drawSelection(),
          keymap.of([...defaultKeymap, indentWithTab]),
          history(),
          EditorView.updateListener.of(async (v) => {
            if (v.docChanged) {
              console.log("Doc changed", v.state.doc.toString());
              // Update proposedContent when edited
              this.proposedContent = v.state.doc.toString();
              // Save the layout
              this.app.workspace.requestSaveLayout();
            }

            // Check for accept/reject actions
            if (
              v.transactions.some(
                (tr) =>
                  tr.annotation(Transaction.userEvent) === "accept" ||
                  tr.annotation(Transaction.userEvent) === "revert",
              )
            ) {
              console.log("Accept or reject action detected");
              this.hasUnsavedChanges = true;
              this.updateUnsavedIndicator();

              // Auto-save changes
              await this.saveChanges();
            }
          }),
          unifiedMergeView({
            original: this.originalContent,
          }),
        ],
      }),
      parent: container,
    });
  }

  /**
   * Update the editor content without recreating the entire view
   */
  async updateContent(): Promise<void> {
    if (!this.editorView || !this.containerEl) return;

    // Update the editor with new content
    const editorContainer = this.containerEl.querySelector(
      ".merge-editor-container",
    );
    if (editorContainer) {
      this.createEditor(editorContainer as HTMLElement);
    }
  }

  async onClose(): Promise<void> {
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }
    await super.onClose();
  }

  /**
   * Create unsaved changes indicator
   */
  private createUnsavedIndicator(container: HTMLElement): void {
    const indicator = container.createDiv("merge-unsaved-indicator");
    indicator.style.display = "none";
    indicator.textContent = "Unsaved Changes";
    indicator.style.position = "absolute";
    indicator.style.top = "5px";
    indicator.style.right = "10px";
    indicator.style.backgroundColor = "var(--background-modifier-error)";
    indicator.style.color = "var(--text-on-accent)";
    indicator.style.padding = "2px 8px";
    indicator.style.borderRadius = "4px";
    indicator.style.fontSize = "12px";
    indicator.style.zIndex = "10";
  }

  /**
   * Update the unsaved changes indicator visibility
   */
  private updateUnsavedIndicator(): void {
    const indicator = this.containerEl.querySelector(
      ".merge-unsaved-indicator",
    ) as HTMLElement;
    if (indicator) {
      indicator.style.display = this.hasUnsavedChanges ? "block" : "none";
    }
  }

  /**
   * Save changes to the original file
   */
  private async saveChanges(): Promise<void> {
    if (!this.editorView) return;

    try {
      // Get the original document (which includes all accepted changes)
      const state = this.editorView.state;
      const originalDocText = getOriginalDoc(state).toString();

      // Write back to the original file
      await this.app.vault.adapter.write(
        this.originalFilePath,
        originalDocText,
      );

      // Reset unsaved changes flag
      this.hasUnsavedChanges = false;
      this.updateUnsavedIndicator();

      // Show success notification
      new Notice(`Changes saved to ${this.originalFilePath.split("/").pop()}`);
    } catch (error) {
      console.error("Error saving changes:", error);
      new Notice(`Error saving changes: ${(error as Error).message}`);
    }
  }

  /**
   * Sets or updates the content for the merge view
   * @param originalContent The content of the current file
   * @param proposedContent The content of the file to merge with
   * @param originalFilePath The path to the original file
   */
  async setContent(
    originalContent: string,
    proposedContent: string,
    originalFilePath: string,
  ): Promise<void> {
    this.originalContent = originalContent;
    this.proposedContent = proposedContent;
    this.originalFilePath = originalFilePath;

    if (this.containerEl) {
      await this.updateContent();
    }

    this.initialized = true;

    // Request that Obsidian save the layout
    this.app.workspace.requestSaveLayout();
  }

  /**
   * Get the state to be persisted in the workspace
   */
  getState(): Record<string, unknown> {
    console.log("Getting state", this.originalFilePath, this.proposedContent);
    return {
      originalFilePath: this.originalFilePath,
      proposedContent: this.proposedContent,
    };
  }

  async setState(state: any, result: any): Promise<void> {
    console.log("Setting state", state);

    if (state?.originalFilePath) {
      this.originalFilePath = state.originalFilePath;

      try {
        // Load the original content from the file
        this.originalContent = await this.app.vault.adapter.read(
          this.originalFilePath,
        );

        // Set the proposed content directly from state
        if (state.proposedContent) {
          this.proposedContent = state.proposedContent;
        }

        // Update the view if it's already initialized
        if (this.containerEl && this.initialized) {
          await this.updateContent();
        }
      } catch (error) {
        console.error("Error loading original file content:", error);
      }
    }
  }
}
