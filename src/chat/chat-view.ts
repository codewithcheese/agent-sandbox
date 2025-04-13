import { FileView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import ChatElement from "./ChatElement.svelte";

export const CHAT_VIEW_SLUG = "agent-sandbox-chat-view";

export class ChatView extends FileView {
  allowNoFile: boolean = false;
  private component: any = null;

  getViewType(): string {
    return CHAT_VIEW_SLUG;
  }

  getDisplayText(): string {
    return this.file ? `${this.file.basename}` : "Chat";
  }

  getIcon(): string {
    return "message-square";
  }

  onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string): void {
    if (source === "tab-header") {
      menu.addItem((item) => {
        item
          .setTitle("Reload view")
          .setIcon("refresh-cw")
          .onClick(async () => {
            await this.onClose();
            await this.onOpen();
          });
      });
    }
  }

  async onClose() {
    console.log("ChatView onClose");

    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    await super.onClose();
  }

  async onLoadFile(file: TFile) {
    await super.onLoadFile(file);
    console.log("onLoadFile", file);
    await this.mount(file);
  }

  async mount(file: TFile) {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    const viewContent = this.containerEl.children[1] as HTMLDivElement;
    viewContent.style.padding = "0px";

    // Mount the Svelte component with props
    this.component = mount(ChatElement, {
      target: this.containerEl.children[1],
      props: {
        data: await this.app.vault.read(file),
        onSave: (data: string) => this.app.vault.modify(this.file, data),
      },
    });
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "chat";
  }
}
