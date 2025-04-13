import { ItemView, WorkspaceLeaf } from "obsidian";

export const ARTIFACT_VIEW_TYPE = "artifact-view";

export type Artifact = {
  name: string;
  html: string;
};

export class ArtifactView extends ItemView {
  private iframeEl: HTMLIFrameElement | null = null;
  public artifact = $state<Artifact>({
    name: "",
    html: "",
  });

  // Required: unique view type
  getViewType(): string {
    return ARTIFACT_VIEW_TYPE;
  }

  // Required: text displayed on the tab
  getDisplayText(): string {
    return "Artifact View";
  }

  // Optional: icon to show on the tab
  getIcon(): string {
    return "code-block";
  }

  /**
   * Called when the view is first opened
   */
  async onOpen(): Promise<void> {
    await super.onOpen();
    console.log("ArtifactView onOpen");

    // 1) Get the container element for the content area
    const container = this.containerEl.children[1];
    container.empty();

    // Add a class for styling
    container.addClass("artifact-container");

    // 2) Create and insert the iframe
    this.iframeEl = container.createEl("iframe", {
      cls: "artifact-iframe",
    });

    // 3) Make the iframe fill the container
    this.iframeEl.style.width = "100%";
    this.iframeEl.style.height = "100%";
    this.iframeEl.style.border = "none";
    this.iframeEl.style.backgroundColor = "var(--background-primary)";

    // 4) Add sandbox attributes to isolate the iframe
    this.iframeEl.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-modals",
    );

    // If we have stored content, load it
    if (this.artifact) {
      // this.loadArtifact(this.artifact);
    }
  }

  /**
   * Called when the view is closed
   */
  async onClose(): Promise<void> {
    console.log("ArtifactView onClose");
    if (this.iframeEl) {
      this.iframeEl.remove();
      this.iframeEl = null;
    }
    await super.onClose();
  }

  loadArtifact(artifact: Artifact): void {
    this.artifact = artifact;
    if (!this.iframeEl) return;
    this.iframeEl.srcdoc = artifact.html;
    this.app.workspace.requestSaveLayout();
  }

  /**
   * Get the state to be persisted in the workspace
   */
  getState(): Record<string, unknown> {
    return {
      artifact: this.artifact,
    };
  }

  /**
   * Restore state when Obsidian loads the view
   */
  async setState(state: any): Promise<void> {
    if (state?.html) {
      this.artifact = state.artifact;

      // If the view is already open, load the content
      if (this.iframeEl) {
        this.loadArtifact(this.artifact);
      }
    }
    return Promise.resolve();
  }
}
