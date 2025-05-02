/**
 * Utility functions for managing user preferences in localStorage
 */
import { Notice } from "obsidian";
import type { ChatModel } from "../settings/models.ts";
import { usePlugin } from "$lib/utils/index.ts";

export const STORAGE_KEY = "agent-sandbox-chat-preferences";

export class ChatOptions {
  modelId = $state<string | undefined>();
  accountId = $state<string | undefined>();
  chatbotPath = $state<string | undefined>();
  cleanup: () => void;

  constructor() {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
      Object.assign(this, JSON.parse(storedData));
    }

    // Save preferences to localStorage whenever they change
    this.cleanup = $effect.root(() => {
      $effect(() => {
        console.log("Saving options");
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            modelId: this.modelId,
            accountId: this.accountId,
            chatbotPath: this.chatbotPath,
          }),
        );
      });
    });
  }

  getModel() {
    const plugin = usePlugin();
    const model = plugin.settings.models.find(
      (m): m is ChatModel => m.type === "chat" && m.id === this.modelId,
    );
    if (!model) {
      throw Error(`Chat model ${this.modelId} not found`);
    }
    return model;
  }

  getAccount() {
    const plugin = usePlugin();
    const account = plugin.settings.accounts.find(
      (a) => a.id === this.accountId,
    );
    if (!account) {
      throw Error(`AI account ${accountId} not found`);
    }
    return account;
  }
}
