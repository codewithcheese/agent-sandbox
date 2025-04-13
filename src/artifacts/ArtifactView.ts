import { ItemView, WorkspaceLeaf } from "obsidian";

export const ARTIFACT_VIEW_TYPE = "artifact-view";

export class ArtifactView extends ItemView {
  private iframeEl: HTMLIFrameElement | null = null;
  private html: string = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

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
    if (this.html) {
      this.loadHtml(this.html);
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
  }

  /**
   * Custom method that can be called to load AI-generated content
   * into the iframe. You might call this from a command, or from
   * another part of your plugin where the AI is returning HTML.
   */
  loadHtml(generatedHtml: string): void {
    if (!this.iframeEl) return;

    // Store the content for potential state restoration
    this.html = generatedHtml;

    // Use srcdoc to directly provide the HTML for the iframe
    this.iframeEl.srcdoc = generatedHtml;

    // Request that Obsidian save the layout
    this.app.workspace.requestSaveLayout();
  }

  /**
   * Get the state to be persisted in the workspace
   */
  getState(): Record<string, unknown> {
    return {
      lastHtmlContent: this.html,
    };
  }

  /**
   * Restore state when Obsidian loads the view
   */
  async setState(state: any): Promise<void> {
    if (state?.html) {
      this.html = state.html;

      // If the view is already open, load the content
      if (this.iframeEl) {
        this.loadHtml(this.html);
      }
    }
    return Promise.resolve();
  }
}
