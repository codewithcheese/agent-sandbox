import { ItemView } from "obsidian";
import { mount, unmount } from "svelte";
import MergePage from "./MergePage.svelte";

/**
 * todo: add title
 * todo: add margins (sizer)
 */

export const MERGE_VIEW_TYPE = "sandbox-merge-view";

export interface MergeViewState {
  originalFilePath?: string;
  proposedContent?: string;
}

export class MergeView extends ItemView {
  private component: any = null;
  private originalContent: string = "";
  private proposedContent: string = "";
  private originalFilePath: string = "";
  private initialized: boolean = false;

  getViewType(): string {
    return MERGE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Merge View";
  }

  getIcon(): string {
    return "git-pull-request";
  }

  canResume(): boolean {
    return false;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();

    console.log("merge view onOpen", this);

    const container = this.containerEl.children[1];
    container.empty();

    // Mount the Svelte component
    await this.mountComponent();
    this.initialized = true;
  }

  /**
   * Mount the Svelte component
   */
  private async mountComponent(): Promise<void> {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    const viewContent = this.containerEl.children[1] as HTMLDivElement;
    viewContent.style.padding = "0px";
    viewContent.style.backgroundColor = "var(--background-primary)";

    // Mount the Svelte component with props
    this.component = mount(MergePage, {
      target: viewContent,
      props: {
        originalContent: this.originalContent,
        proposedContent: this.proposedContent,
        originalFilePath: this.originalFilePath,
        onSave: (originalContent: string) => {
          console.log("Merge onSave", originalContent);
        },
      },
    });
  }

  /**
   * Update the component content
   */
  async updateContent(): Promise<void> {
    if (!this.component || !this.containerEl) return;

    // Remount the component with updated props
    this.mountComponent();
  }

  async onClose(): Promise<void> {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }
    await super.onClose();
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
  // getState(): Record<string, unknown> {
  //   console.log("Getting state", this.originalFilePath, this.proposedContent);
  //   return {
  //     originalFilePath: this.originalFilePath,
  //     proposedContent: this.proposedContent,
  //   };
  // }

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
