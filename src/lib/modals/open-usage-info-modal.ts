import { Modal } from "obsidian";
import UsageInfoModal from "../../chat/UsageInfoModal.svelte";
import { mount, unmount } from "svelte";
import type { UIMessageWithMetadata } from "../../chat/chat.svelte.ts";
import { usePlugin } from "$lib/utils";

export function openUsageInfoModal(message: UIMessageWithMetadata) {
  const plugin = usePlugin();
  const modal = new (class extends Modal {
    private component: any;
    onOpen() {
      this.component = mount(UsageInfoModal, {
        target: this.contentEl,
        props: {
          message,
          close: () => this.close(),
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