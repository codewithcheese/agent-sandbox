import {
  Editor,
  MarkdownView,
  Modal,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { mount, unmount } from "svelte";
import { usePlugin } from "$lib/utils";
import AgentStatusBar from "./AgentStatusBar.svelte";
import AgentStatusModal from "./AgentStatusModal.svelte";
import { createSystemContent } from "../chat/system.ts";

export class AgentStatus {
  statusEl: HTMLElement;
  statusBar: any;
  template = $state<{ file?: TFile }>({});

  constructor() {
    const plugin = usePlugin();
    this.statusEl = plugin.addStatusBarItem();
    this.statusEl.classList.add("mod-clickable");
    this.statusBar = mount(AgentStatusBar, {
      target: this.statusEl,
      props: {
        template: this.template,
        openModal: this.openModal,
      },
    });
    plugin.register(async () => {
      if (this.statusBar) {
        await unmount(this.statusBar);
      }
    });

    plugin.registerEvent(
      plugin.app.workspace.on(
        "active-leaf-change",
        (leaf: WorkspaceLeaf | null) => {
          if (leaf && leaf.view instanceof MarkdownView) {
            this.onActiveUpdate(leaf.view.file);
          }
        },
      ),
    );

    plugin.registerEvent(
      plugin.app.workspace.on(
        "editor-change",
        (editor: Editor, info: MarkdownView) => {
          console.log("editor-change", editor, info);
          const active = plugin.app.workspace.getActiveViewOfType(MarkdownView);
          if (active && active === info) {
            this.onActiveUpdate(active.file);
          }
        },
      ),
    );
  }

  onActiveUpdate(file: TFile) {
    const plugin = usePlugin();
    const metadata = plugin.app.metadataCache.getFileCache(file);
    if (
      metadata.frontmatter &&
      "agent" in metadata.frontmatter &&
      (metadata.frontmatter["agent"] === true ||
        metadata.frontmatter["agent"] === "true")
    ) {
      this.template.file = file;
    } else {
      this.template.file = undefined;
    }
  }

  openModal = async (file: TFile) => {
    const plugin = usePlugin();
    let content = "";
    let error = null;
    try {
      content = await createSystemContent(file);
      error = null;
    } catch (e) {
      content = null;
      error = e;
    }
    const modal = new (class extends Modal {
      private component?: any;
      onOpen() {
        this.component = mount(AgentStatusModal, {
          target: this.contentEl,
          props: { file, content, error },
        });
      }
      async onClose() {
        if (this.component) {
          await unmount(this.component);
        }
        this.contentEl.empty();
      }
    })(plugin.app);
    modal.open();
  };
}
