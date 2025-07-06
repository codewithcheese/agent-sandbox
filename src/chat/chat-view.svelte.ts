import {
  FileView,
  Menu,
  TFile,
  Plugin,
  WorkspaceLeaf,
  Platform,
  normalizePath,
  Notice,
} from "obsidian";
import { mount, unmount } from "svelte";
import type { ViewContext } from "$lib/obsidian/view.ts";
import ChatPage from "./ChatPage.svelte";
import { Chat, type ChatOptions } from "./chat.svelte.ts";
import { Agents } from "./agents.svelte.ts";
import superjson from "superjson";
import { ChatSerializer, type CurrentChatFile } from "./chat-serializer.ts";
import { usePlugin } from "$lib/utils";
import { ChatHistoryView } from "./chat-history-view.svelte.ts";
import { DeleteChatModal } from "$lib/modals/delete-chat-modal.ts";
import { ChatInputState } from "./chat-input-state.svelte.ts";

export const CHAT_VIEW_TYPE = "sandbox-chat-view";

export class ChatView extends FileView {
  allowNoFile: boolean = false;
  private component: any = null;
  floatingEl: HTMLDivElement | null = null;
  view = $state<ViewContext>({
    position: "center",
    name: "",
  });
  chat: Chat | null = null;
  inputState: ChatInputState;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.inputState = new ChatInputState();
    this.addAction("history", "View Chat History", async () => {
      await ChatHistoryView.openChatHistory();
    });
  }

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
          .setTitle("Regenerate title")
          .setIcon("refresh-cw")
          .onClick(async () => {
            const chat = await Chat.load(this.file.path);
            await chat.generateTitle();
          });
      });
      menu.addItem((item) => {
        item
          .setTitle("Delete chat")
          .setIcon("trash")
          .onClick(async () => {
            const modal = new DeleteChatModal(
              usePlugin().app,
              this.file,
              () => {
                return usePlugin().app.vault.trash(this.file);
              },
            );
            modal.open();
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
    this.inputState.reset();
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

    this.chat = await Chat.load(file.path);

    // Mount the Svelte component with props
    this.component = mount(ChatPage, {
      target: this.containerEl.children[1],
      props: {
        agents: await Agents.load(),
        chat: this.chat,
        view: this.view,
        inputState: this.inputState,
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

  static async newChat(
    leaf?: WorkspaceLeaf,
    options?: Partial<ChatOptions>,
  ): Promise<ChatView> {
    const plugin = usePlugin();
    const baseName = "New chat";
    let fileName = baseName;
    let counter = 1;

    // Get the chatsPath from settings
    const chatsPath = normalizePath(plugin.settings.vault.chatsPath);

    // Ensure the directory exists
    try {
      const folderExists = plugin.app.vault.getAbstractFileByPath(chatsPath);
      if (!folderExists) {
        await plugin.app.vault.createFolder(chatsPath);
      }
    } catch (error) {
      console.error("Error creating chats directory:", error);
      new Notice("Failed to create chats directory", 3000);
    }

    // Create a unique filename
    while (
      plugin.app.vault.getAbstractFileByPath(`${chatsPath}/${fileName}.chat`)
    ) {
      fileName = `${baseName} ${counter}`;
      counter++;
    }

    const filePath = `${chatsPath}/${fileName}.chat`;

    // Create initial data with user defaults applied
    const initialData: CurrentChatFile = { ...ChatSerializer.INITIAL_DATA };
    initialData.payload.options.modelId = plugin.settings.defaults.modelId;
    initialData.payload.options.accountId = plugin.settings.defaults.accountId;

    const file = await plugin.app.vault.create(
      filePath,
      superjson.stringify(initialData),
    );

    if (!leaf) {
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
    }

    await leaf.openFile(file, {
      active: true,
      state: { mode: CHAT_VIEW_TYPE },
    });
    await plugin.app.workspace.revealLeaf(leaf);
    await (leaf.view as ChatView).chat.updateOptions(options);
    return leaf.view as ChatView;
  }

  static findActiveChatView(): ChatView | null {
    const plugin = usePlugin();
    const { workspace } = plugin.app;
    // First, try to find an active chat view
    let leaf = workspace.getActiveViewOfType(ChatView);
    if (leaf && leaf.view instanceof ChatView) {
      return leaf.view;
    }

    // If no active chat view, find any chat view (prefer right sidebar)
    leaf = workspace.getMostRecentLeaf(workspace.rightSplit);
    if (leaf && leaf.view instanceof ChatView) {
      return leaf.view;
    }

    return null;
  }
}
