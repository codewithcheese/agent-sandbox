import { App, Modal } from "obsidian";
import { fileTree } from "$lib/utils/file-tree.ts";

export class FileTreeModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "File Tree" });

    const container = contentEl.createEl("div", {
      cls: "library-tree-container",
    });
    const tree = await fileTree();
    container.createEl("pre", { text: tree });

    // Add some basic styling
    container.style.maxHeight = "70vh";
    container.style.overflow = "auto";
    container.style.fontFamily = "monospace";
    container.style.whiteSpace = "pre-wrap";
    container.style.padding = "10px";
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
