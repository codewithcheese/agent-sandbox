/**
 * Utility functions for managing user preferences in localStorage
 */
import type { ChatModel } from "../settings/models.ts";
import { usePlugin } from "$lib/utils/index.ts";

export const STORAGE_KEY = "agent-sandbox-chat-preferences";

export class ChatOptions {
  modelId = $state<string | undefined>();
  accountId = $state<string | undefined>();
  agentPath = $state<string | undefined>();
  autosave = $state<boolean>(true);
  cleanup: () => void;

  constructor() {
    const plugin = usePlugin();
    const storedData = plugin.app.loadLocalStorage(STORAGE_KEY);
    if (storedData) {
      Object.assign(this, storedData);
    }

    // Save preferences to localStorage whenever they change
    this.cleanup = $effect.root(() => {
      $effect(() => {
        if (!this.autosave) return;
        console.log("Saving options");
        plugin.app.saveLocalStorage(STORAGE_KEY, {
          modelId: this.modelId,
          accountId: this.accountId,
          agentPath: this.agentPath,
        });
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
      throw Error(`AI account ${this.accountId} not found`);
    }
    return account;
  }
}
