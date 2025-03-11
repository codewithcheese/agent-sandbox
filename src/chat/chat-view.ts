import { ItemView, Menu, WorkspaceLeaf } from "obsidian";
import ChatElement from "./ChatElement.svelte";

export const CHAT_VIEW_SLUG = "agent-sandbox-chat-view";

export class ChatView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_SLUG;
  }

  getDisplayText(): string {
    return "Agent Sandbox Chat";
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

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    try {
      const tag = `svelte-chat-element`;
      if (!customElements.get(tag)) {
        //@ts-expect-error
        customElements.define(tag, ChatElement.element);
      }
      container.innerHTML = `<${tag}></${tag}>`;
    } catch (error) {
      console.error(error);
    }
  }

  async onClose() {
    const container = this.containerEl.children[1];
    container.empty();
  }
}
