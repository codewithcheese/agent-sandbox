import { MarkdownView, Notice, Plugin, type TFile } from "obsidian";
import { CHAT_VIEW_TYPE, ChatView } from "../chat/chat-view.svelte.ts";
import { createSystemContent } from "../chat/system.ts";
import { extractLinks, getActiveSidebarLeaf } from "$lib/utils/obsidian.ts";
import { nanoid } from "nanoid";
import { createDebug } from "$lib/debug.ts";
import { tick } from "svelte";
import type { UIMessage } from "ai";
import { loadAttachments } from "../chat/attachments.ts";

const debug = createDebug();

export async function loadPromptMessage(file: TFile): Promise<UIMessage> {
  const content = await createSystemContent(file);
  const links = extractLinks(file, content);
  debug("Prompt links", links);
  return {
    id: nanoid(),
    role: "user",
    content,
    // @ts-expect-error custom property
    metadata: {
      prompt: {
        path: file.path,
      },
    },
    experimental_attachments: await loadAttachments(links),

    parts: [{ type: "text", text: content }],
  };
}

export class PromptCommand {
  static register(plugin: Plugin) {
    plugin.addCommand({
      id: "prompt",
      name: "Insert as prompt",
      editorCallback: async () => {
        const editorView =
          plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!editorView) {
          return new Notice("No active markdown view");
        }

        const leaf = getActiveSidebarLeaf(plugin.app, "right");
        let view: ChatView;
        if (leaf?.getViewState().type === CHAT_VIEW_TYPE) {
          view = leaf.view as ChatView;
        } else {
          view = await ChatView.newChat();
        }
        view.chat.messages.push(await loadPromptMessage(editorView.file));
      },
    });
  }
}
