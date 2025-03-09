import {ItemView, Menu, WorkspaceLeaf} from "obsidian";
import ChatElement from "../src/ChatElement.svelte";
import AgentSandboxPlugin from "./main";
import {mountCustomElement} from "./util/svelte";

export const CHAT_VIEW_SLUG = "agent-sandbox-chat-view";

export class ChatView extends ItemView {
    private plugin: AgentSandboxPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: AgentSandboxPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return CHAT_VIEW_SLUG;
    }

    getDisplayText(): string {
        return "Agent Sandbox Chat";
    }

    onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string): void {
        // if (source === "tab-header") {
        //   menu.addItem((item) => {
        //     item
        //       .setTitle("Reload view")
        //       .setIcon("refresh-cw")
        //       .onClick(() => {
        //         this.reloadView();
        //       });
        //   });
        // }
    }

    // async reloadView() {
    //   const container = this.containerEl.children[1];
    //
    //   // Remove existing script elements
    //   container.querySelectorAll('script[type="module"]').forEach((script) => {
    //     script.remove();
    //   });
    //
    //   // Clear the chat view container but keep the div
    //   const chatViewDiv = container.querySelector("#chat-view");
    //   if (chatViewDiv) {
    //     chatViewDiv.innerHTML = "";
    //   } else {
    //     // If the div doesn't exist, recreate it
    //     const div = document.createElement("div");
    //     div.setAttribute("id", "chat-view");
    //     div.style.height = "100%";
    //     container.appendChild(div);
    //   }
    //
    //   // Add a new script with a fresh timestamp
    //   const script = document.createElement("script");
    //   script.setAttribute("type", "module");
    //   script.setAttribute(
    //     "src",
    //     "http://localhost:15173/src/index.svelte.ts?t=" + Date.now(),
    //   );
    //   container.appendChild(script);
    // }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();

        try {
            mountCustomElement(container, 'http://localhost:15173/src/index.svelte.ts', 'chat-view', ChatElement);
        } catch (error) {
            console.error(error);
        }
    }

    async onClose() {
        // @ts-expect-error fixme shared global
        window.Client = undefined;
    }
}
