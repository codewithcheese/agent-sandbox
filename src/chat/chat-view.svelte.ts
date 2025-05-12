import {
  FileView,
  Menu,
  TFile,
  Plugin,
  WorkspaceLeaf,
  Platform,
  normalizePath,
} from "obsidian";
import { mount, unmount } from "svelte";
import type { ViewContext } from "$lib/obsidian/view.ts";
import ChatPage from "./ChatPage.svelte";
import { Chat } from "./chat.svelte.ts";
import { Agents } from "./agents.svelte.ts";
import superjson from "superjson";
import { ChatSerializer } from "./chat-serializer.ts";
import { usePlugin } from "$lib/utils";

export const CHAT_VIEW_TYPE = "sandbox-chat-view";

export class ChatView extends FileView {
  allowNoFile: boolean = false;
  private component: any = null;
  floatingEl: HTMLDivElement | null = null;
  view = $state<ViewContext>({
    position: "center",
    name: "",
  });

  getViewType(): string {
    return CHAT_VIEW_TYPE;
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
  }

  onload() {
    super.onload();
    // this.createFloatingContainer();
  }

  onunload() {
    if (this.floatingEl) {
      this.floatingEl.remove();
      this.floatingEl = null;
    }
    super.onunload();
  }

  onResize() {
    super.onResize();
    this.updateView();
  }

  onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string): void {
    super.onPaneMenu(menu, source);
    if (source === "more-options") {
      menu.addItem((item) => {
        item
          .setTitle("Regenerate Title")
          .setIcon("refresh-cw")
          .onClick(async () => {
            const chat = await Chat.load(this.file.path);
            await chat.generateTitle();
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
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    await super.onClose();
  }

  async onLoadFile(file: TFile) {
    await super.onLoadFile(file);
    this.updateView();
    await this.mount(file);
  }

  private async mount(file: TFile) {
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
    this.component = mount(ChatPage, {
      target: this.containerEl.children[1],
      props: {
        agents: await Agents.load(),
        chat: await Chat.load(file.path),
        view: this.view,
      },
    });
  }

  private createFloatingContainer() {
    // If already created, do nothing
    if (this.floatingEl) return;

    const container = document.body.createDiv();
    container.id = "chat-floating-container";

    // Basic style: fixed bottom center
    // For advanced styling, consider external CSS or theming
    container.style.position = "fixed";
    container.style.bottom = "20px";
    container.style.left = "50%";
    container.style.transform = "translateX(-50%)";
    container.style.zIndex = "9999"; // ensure it’s on top
    container.style.padding = "8px";
    container.style.borderRadius = "8px";
    container.style.backgroundColor = "var(--background-primary)";

    // Add any initial content or container for your controls
    container.setText("Floating Widget Controls Go Here");

    this.floatingEl = container;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "chat";
  }

  static register(plugin: Plugin) {
    plugin.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf));
    plugin.registerExtensions(["chat"], CHAT_VIEW_TYPE);
    plugin.addRibbonIcon(
      "message-square",
      "Open Agent Sandbox Chat",
      async () => {
        await ChatView.newChat();
      },
    );
  }

  static async newChat(): Promise<ChatView> {
    const plugin = usePlugin();
    const baseName = "New chat";
    let fileName = baseName;
    let counter = 1;

    // Get the chats path from settings
    const chatsPath = normalizePath(plugin.settings.vault.chatsPath);

    // Ensure the directory exists
    try {
      const folderExists = plugin.app.vault.getAbstractFileByPath(chatsPath);
      if (!folderExists) {
        await plugin.app.vault.createFolder(chatsPath);
      }
    } catch (error) {
      console.error("Error creating chats directory:", error);
      plugin.showNotice("Failed to create chats directory", 3000);
    }

    // Create a unique filename
    while (
      plugin.app.vault.getAbstractFileByPath(`${chatsPath}/${fileName}.chat`)
    ) {
      fileName = `${baseName} ${counter}`;
      counter++;
    }

    const filePath = `${chatsPath}/${fileName}.chat`;
    const file = await plugin.app.vault.create(
      filePath,
      superjson.stringify(ChatSerializer.INITIAL_DATA),
    );

    let leaf: WorkspaceLeaf;

    if (!Platform.isMobile) {
      const rightChatLeaves = plugin.app.workspace
        .getLeavesOfType(CHAT_VIEW_TYPE)
        .filter((l) => l.containerEl.closest(".mod-right-split"));

      if (rightChatLeaves.length > 0) {
        leaf = rightChatLeaves[0];
      } else {
        leaf = plugin.app.workspace.getRightLeaf(false);
      }
    } else {
      // Mobile: fall back to the current/only leaf
      leaf = plugin.app.workspace.getLeaf();
    }

    await leaf.openFile(file, {
      active: true,
      state: { mode: CHAT_VIEW_TYPE },
    });

    await plugin.app.workspace.revealLeaf(leaf);

    return leaf.view as ChatView;
  }
}
