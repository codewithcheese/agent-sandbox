import type AgentSandboxPlugin from "../plugin.ts";
import { ChatView } from "../chat/chat-view.svelte.ts";
import { Notice } from "obsidian";

export class ContextMenu {
  static register(plugin: AgentSandboxPlugin) {
    ContextMenu.registerSendToChat(plugin);
  }

  static registerSendToChat(plugin: AgentSandboxPlugin) {
    plugin.registerEvent(
      plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selection = editor.getSelection();
        if (selection) {
          menu.addItem((item) => {
            item
              .setTitle("Copy to chat")
              .setIcon("message-square")
              .onClick(() => {
                let chatView = ChatView.findActiveChatView();
                if (!chatView) {
                  return new Notice(
                    "Chat not found. Open chat in sidebar.",
                    5000,
                  );
                }
                const spacer = chatView.inputState.text ? " " : "";
                chatView.inputState.text += spacer + selection;
              });
          });
        }
      }),
    );
  }
}
