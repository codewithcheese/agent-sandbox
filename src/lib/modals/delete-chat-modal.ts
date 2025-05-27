import { App, Modal, Setting, TFile } from "obsidian";

export class DeleteChatModal extends Modal {
  constructor(
    app: App,
    private readonly file: TFile,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    // Set modal title
    this.titleEl.setText("Delete chat");

    // Create main content
    const contentDiv = this.contentEl.createDiv();

    // Main question
    contentDiv.createEl("p", {
      text: `Are you sure you want to delete "${this.file.basename}"?`,
      cls: "modal-content",
    });

    // Subtitle
    contentDiv.createEl("p", {
      text: "It will be moved to your system trash.",
      cls: "modal-content",
    });

    // Button container
    const buttonContainer = this.contentEl.createDiv("modal-button-container");

    // Delete button
    const deleteBtn = buttonContainer.createEl("button", {
      text: "Delete",
      cls: "mod-warning",
    });
    deleteBtn.onclick = async () => {
      await this.onConfirm();
      this.close();
    };

    // Cancel button
    const cancelBtn = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelBtn.onclick = () => this.close();
  }
}
