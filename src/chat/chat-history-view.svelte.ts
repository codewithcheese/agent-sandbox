import {
  FileView,
  Plugin,
  WorkspaceLeaf,
  normalizePath,
  TFile,
} from "obsidian";
import { mount, unmount } from "svelte";
import ChatHistory from "./ChatHistory.svelte";
import { usePlugin } from "$lib/utils";
import { ChatView } from "./chat-view.svelte.ts";
import _ from "lodash";

export const CHAT_HISTORY_VIEW_TYPE = "sandbox-chat-history-view";

export type ChatItem = {
  title: string;
  path: string;
  lastModified: number;
};

export class ChatHistoryView extends FileView {
  allowNoFile: boolean = true;
  private component: any = null;
  history = $state<{ chats: ChatItem[] }>({ chats: [] });

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.watch();
  }

  getViewType(): string {
    return CHAT_HISTORY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Chat History";
  }

  getIcon(): string {
    return "history";
  }

  watch() {
    const refresh = _.debounce(() => this.loadChats(), 150);

    const isChat = (f: TFile | string) => {
      const path = typeof f === "string" ? f : f.path;
      return path.endsWith(".chat") || path.endsWith(".chat.md");
    };

    // New or deleted files
    ["create", "delete"].forEach((evt) =>
      this.registerEvent(
        this.app.vault.on(evt as any, (file: TFile) => {
          if (isChat(file)) refresh();
        }),
      ),
    );

    // Renames (file is new name, oldPath is the previous name)
    this.registerEvent(
      this.app.vault.on("rename", (file: TFile, oldPath: string) => {
        if (isChat(file) || isChat(oldPath)) refresh();
      }),
    );
  }

  async onOpen() {
    await super.onOpen();
    await this.mount();
  }

  async onClose() {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    await super.onClose();
  }

  onResize() {
    super.onResize();
  }

  async loadChats() {
    const plugin = usePlugin();
    const chatsPath = normalizePath(plugin.settings.vault.chatsPath);

    try {
      const files = plugin.app.vault
        .getFiles()
        .filter(
          (file) =>
            (file.extension === "chat" || file.path.endsWith(".chat.md")) && 
            file.path.startsWith(chatsPath),
        );

      this.history.chats = await Promise.all(
        files.map(async (file) => {
          // For .chat.md files, remove the trailing .chat from basename
          let title = file.basename;
          if (file.path.endsWith('.chat.md') && title.endsWith('.chat')) {
            title = title.slice(0, -5); // Remove '.chat' suffix
          }
          
          return {
            title,
            path: file.path,
            lastModified: file.stat.mtime,
          };
        }),
      );

      // Sort by last modified (newest first)
      this.history.chats.sort((a, b) => b.lastModified - a.lastModified);
    } catch (error) {
      console.error("Error loading chats:", error);
    }
  }

  async openChat(path: string) {
    const plugin = usePlugin();
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!file) return;

    await this.leaf.openFile(file, { active: true });
  }

  private async mount() {
    if (this.component) {
      await unmount(this.component);
      this.component = null;
    }

    // Load chats before mounting the component
    await this.loadChats();

    const viewHeader = this.containerEl.children[0] as HTMLDivElement;
    viewHeader.style.display = "flex";

    const viewContent = this.containerEl.children[1] as HTMLDivElement;
    // Reset padding
    viewContent.style.padding = "0px";
    viewContent.style.backgroundColor = "var(--background-primary)";

    // Mount the Svelte component with props
    this.component = mount(ChatHistory, {
      target: this.containerEl.children[1],
      props: {
        history: this.history,
        onChatClick: (path: string) => this.openChat(path),
        onNewChatClick: () => ChatView.newChat(this.leaf),
      },
    });
  }

  static register(plugin: Plugin) {
    plugin.registerView(
      CHAT_HISTORY_VIEW_TYPE,
      (leaf) => new ChatHistoryView(leaf),
    );
  }

  static async openChatHistory(): Promise<ChatHistoryView> {
    const plugin = usePlugin();

    let leaf: WorkspaceLeaf;

    // Try to find existing history view
    const existingHistoryLeaves = plugin.app.workspace.getLeavesOfType(
      CHAT_HISTORY_VIEW_TYPE,
    );

    if (existingHistoryLeaves.length > 0) {
      leaf = existingHistoryLeaves[0];
    } else {
      leaf = plugin.app.workspace.getLeaf();
    }

    await leaf.setViewState({
      type: CHAT_HISTORY_VIEW_TYPE,
      active: true,
    });

    await plugin.app.workspace.revealLeaf(leaf);

    return leaf.view as ChatHistoryView;
  }
}
