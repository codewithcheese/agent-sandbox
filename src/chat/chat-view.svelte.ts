import { FileView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import ChatElement from "./ChatElement.svelte";
import type { ViewContext } from "$lib/obsidian/view.ts";

export const CHAT_VIEW_SLUG = "agent-sandbox-chat-view";

export class ChatView extends FileView {
  allowNoFile: boolean = false;
  private component: any = null;
  view = $state<ViewContext>({
    position: "center",
    name: "",
  });

  getViewType(): string {
    return CHAT_VIEW_SLUG;
  }

  getDisplayText(): string {
    return this.file ? `${this.file.basename}` : "Chat";
  }

  getIcon(): string {
    return "message-square";
  }

  updateView() {
    this.view.name = this.file ? `${this.file.basename}` : "Chat";

    // @ts-expect-error containerEl is set but not typed
    if (this.leaf.containerEl.closest(".mod-right-split")) {
      this.view.position = "right";
      // @ts-expect-error containerEl is set but not typed
    } else if (this.leaf.containerEl.closest(".mod-left-split")) {
      this.view.position = "left";
    } else {
      this.view.position = "center";
    }
    console.log("updateView", this, this.view);
  }

  onResize() {
    super.onResize();
    this.updateView();
  }

  onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string): void {
    super.onPaneMenu(menu, source);
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

  async onOpen() {
    await super.onOpen();
    this.updateView();
  }

  async onRename(file: TFile) {
    await super.onRename(file);
    this.updateView();
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
    this.updateView();
    console.log("onLoadFile", file);
    await this.mount(file);
  }

  async mount(file: TFile) {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    const viewHeader = this.containerEl.children[0] as HTMLDivElement;
    viewHeader.style.display = "flex";

    const viewContent = this.containerEl.children[1] as HTMLDivElement;
    // Reset padding
    viewContent.style.padding = "0px";
    viewContent.style.backgroundColor = "var(--background-primary)";

    // Mount the Svelte component with props
    this.component = mount(ChatElement, {
      target: this.containerEl.children[1],
      props: {
        data: await this.app.vault.read(file),
        onSave: (data: string) => this.app.vault.modify(this.file, data),
        view: this.view,
      },
    });
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "chat";
  }
}
