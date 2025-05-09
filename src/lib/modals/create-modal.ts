import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import { usePlugin } from "$lib/utils";

export function createModal(component: any, props: any) {
  const plugin = usePlugin();
  return new (class extends Modal {
    private component?: any;
    onOpen() {
      this.component = mount(component, {
        target: this.contentEl,
        props,
      });
    }
    async onClose() {
      if (this.component) {
        await unmount(this.component);
      }
      this.contentEl.empty();
    }
  })(plugin.app);
}
