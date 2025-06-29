import { Modal, Notice } from "obsidian";
import ToolPartModal from "../../chat/ToolPartModal.svelte";
import { mount, unmount } from "svelte";
import type { Chat } from "../../chat/chat.svelte.ts";
import { usePlugin } from "$lib/utils";
import { executeToolInvocation } from "../../tools";
import type { ToolUIPart } from "ai";

export function openToolPartModal(chat: Chat, toolPart: ToolUIPart) {
  const plugin = usePlugin();
  const modal = new (class extends Modal {
    private component: any;
    onOpen() {
      this.component = mount(ToolPartModal, {
        target: this.contentEl,
        props: {
          chat: chat,
          toolPart,
          close: () => this.close(),
          execute: async () => {
            try {
              const result = await executeToolInvocation(toolPart, chat);
              new Notice(`Tool result: ${result}`);
            } catch (error) {
              console.error("Error executing tool:", error);
              new Notice(`Error: ${error.message}`, 3000);
            }
          },
        },
      });
    }
    async onClose() {
      if (this.component) await unmount(this.component);
      this.contentEl.empty();
    }
  })(plugin.app);

  modal.open();
}
