import {
  type ModelMessage,
  generateText,
  type UIMessage,
  type UIMessagePart,
} from "ai";
import { createAIProvider } from "../settings/providers.ts";
import { nanoid } from "nanoid";
import { type CachedMetadata, normalizePath, Notice, TFile } from "obsidian";
import { usePlugin } from "$lib/utils";
import { ChatSerializer, type CurrentChatFile } from "./chat-serializer.ts";
import { hasVariable, renderStringAsync } from "$lib/utils/nunjucks.ts";
import { VaultOverlay } from "./vault-overlay.svelte.ts";
import { createDebug } from "$lib/debug.ts";
import type { AIAccount } from "../settings/settings.ts";
import { loadFileParts } from "./attachments.ts";
import { invariant } from "@epic-web/invariant";
import type { Frontiers } from "loro-crdt/base64";
import { SessionStore } from "./session-store.svelte.ts";
import { syncChangesReminder } from "./system-reminders.ts";
import { getTextFromParts } from "$lib/utils/ai.ts";
import { MergeView } from "$lib/merge/merge-view.svelte.ts";
import type { LanguageModelV2Usage } from "@ai-sdk/provider";
import { Agent } from "../agent/agent.ts";
import { AgentRunner } from "../agent/agent-runner.svelte.ts";

const debug = createDebug();

export type LoadingState =
  | { type: "idle" }
  | { type: "loading" }
  | {
      type: "retrying";
      attempt: number;
      maxAttempts: number;
      delay: number;
    };

export type WithSystemMetadata = {
  role: "system";
  metadata?: {
    agentPath: string;
    agentModified: number;
  };
};

export type WithUserMetadata = {
  role: "user";
  metadata?: {
    checkpoint?: Frontiers;
    modified?: string[];
    command?: {
      text: string;
      path: string;
    };
    isSystemMeta?: true;
  };
};

export type StepMeta = {
  usage: LanguageModelV2Usage;
  finishReason: string;
  stepIndex: number;
};

export type WithAssistantMetadata = {
  role: "assistant";
  metadata?: {
    finishReason?: string;
    accountId?: string;
    accountName?: string;
    provider?: string;
    modelId?: string;
    steps?: StepMeta[];
  };
};

export type UIMessageWithMetadata = UIMessage<{ createdAt: Date }> &
  (WithSystemMetadata | WithUserMetadata | WithAssistantMetadata);

const chatCache = new Map<string, WeakRef<Chat | Promise<Chat>>>();

const chatRegistry = new FinalizationRegistry((path: string) => {
  debug("Finalizing chat", path);
  chatCache.delete(path);
});

export function registerChatRenameHandler() {
  // Update cache and instance on rename
  const plugin = usePlugin();
  plugin.registerEvent(
    plugin.app.vault.on("rename", async (file: TFile, oldPath: string) => {
      // if in cache
      const chatRef = chatCache.get(oldPath);
      if (!chatRef) return;
      // get from weakref, await if necessary
      const chat = await chatRef.deref();
      // delete old path from cache
      chatCache.delete(oldPath);
      // update chat instance path
      chat.path = file.path;
      // set cache with new path
      chatCache.set(file.path, new WeakRef(chat));
      chatRegistry.register(chat, file.path);
    }),
  );
}

export type ChatOptions = {
  modelId?: string;
  accountId?: string;
  agentPath?: string;
  maxSteps: number;
  temperature: number;
  thinkingEnabled: boolean;
  maxTokens: number;
  thinkingTokensBudget: number;
};

export class Chat {
  id = $state<string>();
  path = $state<string>();
  messages = $state<UIMessageWithMetadata[]>([]);
  state = $state<LoadingState>({ type: "idle" });
  sessionStore = $state<SessionStore>();
  vault = $state<VaultOverlay>();
  createdAt: Date;
  updatedAt: Date;
  options = $state<ChatOptions>({
    maxSteps: 50,
    temperature: 0.7,
    thinkingEnabled: false,
    maxTokens: 4000,
    thinkingTokensBudget: 1024,
  });

  #abortController?: AbortController;

  constructor(path: string, data: CurrentChatFile) {
    Object.assign(this, data.payload);
    this.vault = new VaultOverlay(usePlugin().app.vault, data.payload.vault);
    this.sessionStore = new SessionStore(this.vault);
    this.path = path;
  }

  static async create(path: string) {
    const plugin = usePlugin();
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!file) {
      throw Error(`Chat file not found: ${path}`);
    }
    const raw = await plugin.app.vault.read(file);
    const data = ChatSerializer.parse(raw);
    return new Chat(path, data);
  }

  static async load(path: string) {
    const cachedRef = chatCache.get(path);
    if (cachedRef) {
      const cachedValue = cachedRef.deref();
      if (cachedValue) {
        debug("Loading chat from cache", path);
        return cachedValue;
      } else {
        // Reference was garbage collected
        debug("Chat was garbage collected, reloading", path);
        chatCache.delete(path);
      }
    }
    debug("Loading chat from file", path);
    // synchronously cache the promise to prevent multiple loads
    const chatPromise = Chat.create(path);
    chatCache.set(path, new WeakRef(chatPromise));

    // await chat and register for finalization
    const chat = await chatPromise;
    chatCache.set(path, new WeakRef(chat));
    chatRegistry.register(chat, path);

    return chat;
  }

  updateOptions(options: Partial<ChatOptions>) {
    Object.assign(this.options, options);
    return this.save();
  }

  async submit(
    content: string,
    attachments: string[],
    userMetadata: Partial<WithUserMetadata["metadata"]> = {},
  ) {
    // Checkpoint before sync to enable fresh diff calculation on edit/regenerate
    const checkpoint = this.vault.proposedDoc.frontiers();

    // Get timestamp of last message to filter renames
    const lastMessage = this.messages[this.messages.length - 1];
    const sinceTimestamp = lastMessage?.metadata.createdAt;

    // Sync vault and check for external changes
    const syncResult = await this.vault.syncAll(sinceTimestamp);

    // Add system reminder for external changes if any (before user message)
    if (syncResult.length > 0) {
      const changesSummary = syncChangesReminder(syncResult);
      await this.addSystemMeta(changesSummary);
    }

    const messageParts: UIMessagePart<any, any>[] = [
      { type: "text", text: content },
    ];
    if (attachments.length > 0) {
      messageParts.push(...(await loadFileParts(attachments)));
    }

    // Insert a user message
    this.messages.push({
      id: nanoid(),
      role: "user",
      parts: messageParts,
      metadata: {
        createdAt: new Date(),
        modified: syncResult.map((r) => r.path),
        checkpoint,
        ...userMetadata,
      },
    });

    await this.save();

    // Now run the conversation to completion
    await this.runConversation();
  }

  async edit(
    index: number,
    content: string,
    attachments: string[],
    userMetadata: Partial<WithUserMetadata["metadata"]> = {},
  ) {
    if (!content && attachments.length === 0) {
      new Notice("Please enter a message or attach a file.", 5000);
      return;
    }

    const message = this.messages[index];
    invariant(message, `Cannot edit message. Message not found: #${index}`);
    invariant(message.role === "user", "Can only edit user messages");

    // Revert vault changes to since message
    await this.revert(message);

    // Sync vault and handle external changes
    index = await this.syncVault(index);

    // remove text and file parts
    message.parts = message.parts.filter(
      (p) => p.type !== "text" && p.type !== "file",
    );
    // update text parts
    message.parts.push({
      type: "text",
      text: content,
    });
    // update file parts
    if (attachments.length > 0) {
      message.parts.push(...(await loadFileParts(attachments)));
    }
    // Merge in any additional user metadata
    message.metadata = { ...message.metadata, ...userMetadata };

    // Truncate the conversation
    this.messages = this.messages.slice(0, index + 1);

    await this.save();

    // Now run the conversation to completion
    await this.runConversation();
  }

  async regenerate(index: number) {
    const message = this.messages[index];
    invariant(message, `Cannot edit message. Message not found: #${index}`);
    invariant(message.role === "user", "Can only regenerate user messages");
    // Re-load attachments from their paths
    const fileParts = message.parts.filter((p) => p.type === "file");
    if (fileParts.length > 0) {
      const reloadedFileParts = await loadFileParts(
        fileParts.map((p) => p.filename),
      );
      // remove old file parts
      message.parts = message.parts.filter((p) => p.type !== "file");
      // add reloaded file parts
      message.parts.push(...reloadedFileParts);
    }
    // Revert vault changes to since message
    await this.revert(message);

    // Sync vault and handle external changes
    index = await this.syncVault(index);
    // Truncate the conversation
    this.messages = this.messages.slice(0, index + 1);

    await this.save();

    // Now run the conversation to completion
    await this.runConversation();
  }

  async applySystemMessage() {
    if (!this.options.agentPath) return;

    const plugin = usePlugin();
    const agentFile = plugin.app.vault.getFileByPath(this.options.agentPath);
    if (!agentFile) return;

    const agentStat = await plugin.app.vault.adapter.stat(agentFile.path);
    const agentModified = agentStat?.mtime || 0;

    // Check if system message needs updating
    const systemMessage =
      this.messages[0]?.role === "system" ? this.messages[0] : null;
    const systemMeta = systemMessage?.metadata;

    if (
      !systemMessage ||
      systemMeta?.agentPath !== this.options.agentPath ||
      systemMeta?.agentModified !== agentModified
    ) {
      // Create agent context
      const account = this.getAccount();
      const agentContext = {
        account,
        vault: this.vault,
        sessionStore: this.sessionStore,
        chatPath: this.path,
        options: this.options,
      };

      // Load agent and get system prompt
      const agent = await Agent.fromFile(this.options.agentPath, agentContext);
      const system = await agent.getAgentPrompt(agentContext);

      debug("Updating system message", {
        agentPath: this.options.agentPath,
        agentModified,
        system,
      });

      const newSystemMessage: UIMessage<{ createdAt: Date }> &
        WithSystemMetadata = {
        id: systemMessage?.id || nanoid(),
        role: "system" as const,
        parts: [{ type: "text" as const, text: system }],
        metadata: {
          createdAt: new Date(),
          agentPath: this.options.agentPath!,
          agentModified,
        },
      };

      if (systemMessage) {
        this.messages[0] = newSystemMessage;
      } else {
        this.messages.unshift(newSystemMessage);
      }
    }
  }

  async runConversation() {
    try {
      this.state = { type: "loading" };

      const plugin = usePlugin();
      await plugin.loadSettings();

      // Check agent file exists first (same error handling)
      const agentFile = plugin.app.vault.getFileByPath(this.options.agentPath);
      if (!agentFile) {
        throw Error(`Agent at ${this.options.agentPath} not found`);
      }

      await this.applySystemMessage();

      this.state = { type: "loading" };
      this.#abortController = new AbortController();

      const account = this.getAccount();

      // Create agent context
      const agentContext = {
        account,
        vault: this.vault,
        sessionStore: this.sessionStore,
        chatPath: this.path,
        options: this.options,
      };

      // Load agent and create runner
      const agent = await Agent.fromFile(this.options.agentPath, agentContext);
      const runner = new AgentRunner(this.messages, agentContext);

      // Run the conversation
      await runner.run(agent, {
        signal: this.#abortController?.signal,
        callbacks: {
          onStepFinish: async (step) => {
            this.vault.computeChanges();
            if (this.vault.changes.length > 0) {
              await MergeView.openForChanges(this.path);
            }
          },
          onRetry: (attempt, maxAttempts, delay) => {
            this.state = {
              type: "retrying",
              attempt,
              maxAttempts,
              delay,
            };
          },
        },
      });
    } catch (error: any) {
      if (
        error === "cancelled" ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return new Notice("Cancelled", 3000);
      }

      if (error instanceof Error) {
        // Anthropic's CORS Policy Change (March 2025)
        //
        // Anthropic recently changed their CORS policy for new individual accounts:
        // - New individual accounts now have CORS restrictions by default
        // - The error occurs even with valid API keys and anthropic-dangerous-direct-browser-access: true
        // - The error message contains "CORS requests are not allowed for this Organization"
        //
        // Solution: Users need to create an organization in their Anthropic account
        if (
          error.message.includes(
            "CORS requests are not allowed for this Organization",
          )
        ) {
          console.error("Anthropic CORS error", error);
          throw new Error(
            `Provider ${this.getAccount().id} is experiencing a CORS issue. This is a known issue with new individual Anthropic accounts.

To resolve this issue:

1. Go to https://console.anthropic.com/settings/organization
2. Create a new organization
3. Your API key should work properly after creating an organization

For more information, please refer to the following issue:
https://github.com/glowingjade/obsidian-smart-composer/issues/286`,
          );
        }
      }

      // Global error handling
      console.error("Error in runConversation:", error);
      let errorMessage = "An error occurred while generating the response.";

      if (error.statusCode === 429) {
        errorMessage = "Rate limit exceeded. Please try again later.";
      } else if (error.statusCode === 401 || error.statusCode === 403) {
        errorMessage = "Authentication error. Please check your API key.";
      } else if (error.statusCode >= 500) {
        errorMessage =
          "Server error. The AI service may be experiencing issues.";
      } else if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }

      new Notice(errorMessage);
    } finally {
      // Final cleanup
      this.#abortController = undefined;
      this.state = { type: "idle" };
      await this.save();
    }

    if (this.shouldGenerateTitle()) {
      await this.generateTitle();
    }
  }

  cancel() {
    if (this.#abortController) {
      this.#abortController.abort("cancelled");
    }
    this.state = { type: "idle" };
  }

  async save() {
    const plugin = usePlugin();
    const file = plugin.app.vault.getAbstractFileByPath(this.path);
    if (!file) {
      throw Error(`Chat file not found: ${this.path}`);
    }
    const raw = ChatSerializer.stringify(this);
    // Zero-bytes saved bug when obsidian reloads while saving
    // workaround attempt to fix it. Issue unknown.
    if (raw) {
      await plugin.app.vault.modify(file, raw);
    }
  }

  shouldGenerateTitle() {
    if (this.messages.length < 2) {
      return false;
    }

    const plugin = usePlugin();
    const { title } = plugin.settings;
    if (!title.accountId || !title.modelId) {
      debug("Account and model not configured for chat title generation");
      return false;
    }

    const file = plugin.app.vault.getAbstractFileByPath(this.path);

    if (this.path.endsWith(".chat.md")) {
      return file.basename.startsWith("New chat.chat");
    } else {
      return file.basename.startsWith("New chat");
    }
  }

  async migrateToMarkdown(): Promise<void> {
    if (this.path.endsWith('.chat.md')) {
      new Notice('Chat is already in markdown format');
      return;
    }

    const plugin = usePlugin();
    const currentFile = plugin.app.vault.getFileByPath(this.path);
    if (!currentFile) {
      throw new Error(`Chat file not found: ${this.path}`);
    }
    
    // Generate new path (similar to title generation logic)
    const basePath = this.path.replace(/\.chat$/, '');
    let newPath = `${basePath}.chat.md`;
    let counter = 1;
    
    // Ensure unique filename
    while (plugin.app.vault.getAbstractFileByPath(newPath)) {
      newPath = `${basePath} ${counter}.chat.md`;
      counter++;
    }
    
    try {
      // Pre-emptively update path (similar to title generation workaround)
      const oldPath = this.path;
      this.path = normalizePath(newPath);
      
      // Create new file with markdown format
      const content = ChatSerializer.stringify(this); // Will use markdown format due to .chat.md extension
      await plugin.app.vault.create(newPath, content);
      
      // TODO: Delete old file after testing
      // await plugin.app.vault.delete(currentFile);
      
      new Notice('Chat converted to markdown format');
    } catch (error) {
      // Rollback path on error
      this.path = currentFile.path;
      console.error('Failed to migrate chat to markdown:', error);
      new Notice('Failed to convert chat to markdown format');
      throw error;
    }
  }

  async generateTitle(): Promise<void> {
    const plugin = usePlugin();

    const { title } = plugin.settings;

    if (!hasVariable(title.prompt, "conversation")) {
      new Notice(
        "Chat title generation failed. Prompt must contain {{ conversation }} variable to insert conversation context.",
        5000,
      );
      return;
    }

    const account = plugin.settings.accounts.find(
      (a) => a.id === title.accountId,
    );
    if (!account) {
      new Notice(
        `Chat title generation failed. Account ${title.accountId} not found.`,
        5000,
      );
      return;
    }

    const model = plugin.settings.models.find((m) => m.id === title.modelId);
    if (!model) {
      new Notice(
        `Chat title generation failed. Model ${title.modelId} not found.`,
        5000,
      );
      return;
    }

    // Prepare the conversation content to insert into the prompt
    const conversationText = this.messages
      .map((msg) => `${msg.role}: ${getTextFromParts(msg.parts)}`)
      .join("\n\n");

    // Insert the conversation into the prompt template
    const promptWithConversation = await renderStringAsync(
      title.prompt,
      {
        conversation: conversationText,
      },
      { autoescape: false, throwOnUndefined: true },
    );

    try {
      // Create a message with the title generation prompt
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: promptWithConversation,
        },
        {
          role: "assistant",
          content: "<title>",
        },
      ];

      const provider = createAIProvider(account);

      const textResult = await generateText({
        model: provider.languageModel(model.id),
        messages,
        maxRetries: 0,
      });

      const titleMatch = textResult.text.match(/(?:<title>|^)(.*?)<\/title>/);

      if (!titleMatch || !titleMatch[1]) {
        new Notice(
          "Chat title generation failed. No title found in response. The prompt must require that the title is generated within <title></title> tags.",
          5000,
        );
      }

      let extractedTitle = titleMatch[1].trim();

      // Sanitize the title for use as a filename
      // Remove characters that are not allowed in filenames
      extractedTitle = extractedTitle
        .replace(/[\/\\:\*\?"<>\|]/g, "") // Remove OS-forbidden chars
        .replace(/[\[\]#^{}]/g, "") // Remove Markdown special chars
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();

      if (extractedTitle.length === 0) {
        new Notice(
          "Chat title generation failed. Title empty after sanitization.",
          5000,
        );
        return;
      }

      // Limit the length of the title
      if (extractedTitle.length > 100) {
        extractedTitle = extractedTitle.substring(0, 100);
      }

      const file = plugin.app.vault.getFileByPath(this.path);
      let subExt = this.path.endsWith(".chat.md") ? ".chat" : "";
      let newBasename = extractedTitle + subExt;
      let counter = 1;

      let newPath = file.path.replace(file.basename, newBasename);

      // Ensure the new path is unique by checking if a file with the same path already exists
      // Skip the check if the new path is the same as the current file path
      while (
        plugin.app.vault.getAbstractFileByPath(newPath) &&
        newPath !== file.path
      ) {
        newBasename = `${extractedTitle} ${counter}` + subExt;
        newPath = file.path.replace(file.basename, newBasename);
        counter++;
      }

      // Bug: In rare cases, that chat is not renamed correctly by registerChatRenameHandler
      // unsure of the cause. Possibly a race condition between the rename event and save call.
      // Workaround: Pre-emptively update the path reference before renaming the file
      this.path = normalizePath(newPath);

      await plugin.app.fileManager.renameFile(file, newPath);
    } catch (error) {
      new Notice(`Chat title generation failed. Error: ${error}.`, 5000);
    }
  }

  getAccount() {
    const plugin = usePlugin();
    const account = plugin.settings.accounts.find(
      (a) => a.id === this.options.accountId,
    );
    if (!account) {
      throw Error(`AI account ${this.options.accountId} not found`);
    }
    return account;
  }

  /**
   * Add a system reminder message to the conversation
   * Returns number of messages inserted
   */
  private async addSystemMeta(
    content: string,
    insertIndex?: number,
  ): Promise<number> {
    if (content.trim()) {
      const reminderMessage: UIMessage<{ createdAt: Date }> & WithUserMetadata =
        {
          id: nanoid(),
          role: "user" as const,
          parts: [{ type: "text", text: content }],
          metadata: {
            createdAt: new Date(),
            isSystemMeta: true,
          },
        };

      if (insertIndex !== undefined) {
        // Check if there's already a system reminder at this index
        const existingMessage = this.messages[insertIndex - 1];
        if (
          existingMessage?.metadata &&
          "isSystemMeta" in existingMessage.metadata &&
          existingMessage.metadata.isSystemMeta
        ) {
          // Replace existing system reminder
          this.messages[insertIndex - 1] = reminderMessage;
          return 0; // replaced
        } else {
          // Insert new system reminder
          this.messages.splice(insertIndex, 0, reminderMessage);
          return 1;
        }
      } else {
        this.messages.push(reminderMessage);
        return 1;
      }
    }
  }

  /**
   * Revert vault changes to the checkpoint stored in the message metadata
   */
  private async revert(
    message: UIMessage<{
      createdAt: Date;
    }> &
      WithUserMetadata,
  ): Promise<void> {
    const checkpoint = message.metadata?.checkpoint;
    if (checkpoint) {
      this.vault.revert(checkpoint);
      // Close merge view since changes are now invalid
      MergeView.close();
      // Reload session store after vault revert
      await this.sessionStore.reload();
    }
  }

  /**
   * Sync vault and handle external changes
   * Returns the new index after potentially adding system reminder messages
   */
  private async syncVault(index: number): Promise<number> {
    // Find the last assistant message before this user message to determine the conversation boundary
    const lastAssistantMessage = this.messages.findLast(
      (msg, i) => i < index && msg.role === "assistant",
    );
    const syncResult = await this.vault.syncAll(
      lastAssistantMessage?.metadata.createdAt,
    );

    // Add system reminder for external changes if any
    if (syncResult.length > 0) {
      const changesSummary = syncChangesReminder(syncResult);
      // Increment index if a system reminder was added
      index += await this.addSystemMeta(changesSummary, index);
    }

    // Store sync result on the message
    const message = this.messages[index] as UIMessage<{ createdAt: Date }> &
      WithUserMetadata;
    message.metadata.modified = syncResult.map((r) => r.path);

    return index;
  }
}
