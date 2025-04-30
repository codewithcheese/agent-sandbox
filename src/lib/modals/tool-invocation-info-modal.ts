import { Modal, Notice } from "obsidian";
import ToolInvocationModal from "../../chat/ToolInvocationModal.svelte";
import { mount, unmount } from "svelte";
import type { ToolInvocation } from "@ai-sdk/ui-utils";
import type { Chat } from "../../chat/chat.svelte.ts";
import { usePlugin } from "$lib/utils";
import { executeToolInvocation } from "../../tools";

export function openToolInvocationInfoModal(
  chat: Chat,
  toolInvocation: ToolInvocation,
) {
  const plugin = usePlugin();
  const modal = new (class extends Modal {
    private component: any;
    onOpen() {
      this.component = mount(ToolInvocationModal, {
        target: this.contentEl,
        props: {
          chat: chat,
          toolInvocation,
          close: () => this.close(),
          execute: async () => {
            try {
              const result = await executeToolInvocation(toolInvocation, chat);
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
