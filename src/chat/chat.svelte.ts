import {
  type Attachment,
  convertToCoreMessages,
  type CoreMessage,
  generateText,
  streamText,
  type Tool,
  type UIMessage,
} from "ai";
import { type AIAccount, createAIProvider } from "../settings/providers.ts";
import { nanoid } from "nanoid";
import { type CachedMetadata, Notice, TFile } from "obsidian";
import { wrapTextAttachments } from "$lib/utils/messages.ts";
import { loadToolsFromFrontmatter } from "../tools";
import { applyStreamPartToMessages } from "$lib/utils/stream.ts";
import { extensionToMimeType } from "$lib/utils/mime.ts";
import { usePlugin } from "$lib/utils";
import { ChatSerializer, type CurrentChatFile } from "./chat-serializer.ts";
import { createSystemContent } from "./system.ts";
import { hasVariable, renderStringAsync } from "$lib/utils/nunjucks.ts";
import { VaultOverlaySvelte } from "./vault-overlay.svelte.ts";
import { createDebug } from "$lib/debug.ts";
import type { ChatModel } from "../settings/models.ts";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { encodeBase64 } from "$lib/utils/base64.ts";
import type { SuperJSONObject } from "$lib/utils/superjson.ts";

const debug = createDebug();

export interface DocumentAttachment {
  id: string;
  file: TFile;
}

export type LoadingState =
  | { type: "idle" }
  | { type: "loading" }
  | {
      type: "retrying";
      attempt: number;
      maxAttempts: number;
      delay: number;
    };

const chatCache = new Map<string, WeakRef<Chat | Promise<Chat>>>();

const chatRegistry = new FinalizationRegistry((path: string) => {
  debug("Finalizing chat", path);
  chatCache.delete(path);
});

export function registerChatRenameHandler() {
  // Update cache and instance on rename
  const plugin = usePlugin();
  plugin.registerEvent(
    plugin.app.vault.on("rename", async (file, oldPath) => {
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
  messages = $state<UIMessage[]>([]);
  state = $state<LoadingState>({ type: "idle" });
  sessionStore = $state<SuperJSONObject>({});
  vault = $state<VaultOverlaySvelte>();
  createdAt: Date;
  updatedAt: Date;
  options = $state<ChatOptions>({
    maxSteps: 10,
    temperature: 0.7,
    thinkingEnabled: false,
    maxTokens: 4000,
    thinkingTokensBudget: 1024,
  });

  #abortController?: AbortController;

  constructor(path: string, data: CurrentChatFile) {
    Object.assign(this, data.payload);
    this.vault = new VaultOverlaySvelte(
      usePlugin().app.vault,
      data.payload.vault,
    );
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

  async submit(content: string, attachments: { id: string; path: string }[]) {
    if (!content && attachments.length === 0) {
      new Notice("Please enter a message or attach a file.", 5000);
      return;
    }

    const plugin = usePlugin();

    // Prepare any attachments as data URIs
    const experimental_attachments: Attachment[] = [];
    if (attachments.length > 0) {
      debug("Preparing attachments: ", $state.snapshot(attachments));
      for (const attachment of attachments) {
        try {
          const file = plugin.app.vault.getFileByPath(attachment.path);
          if (!file) {
            throw Error(`Attachment not found: ${attachment.path}`);
          }
          const data = await plugin.app.vault.readBinary(file);
          const base64 = encodeBase64(data);
          experimental_attachments.push({
            name: attachment.path,
            contentType: extensionToMimeType(file.extension),
            url: `data:${extensionToMimeType(file.extension)};base64,${base64}`,
          });
        } catch (error) {
          console.error("Failed to load attachment data:", error);
        }
      }
    }

    // Insert a user message
    this.messages.push({
      id: nanoid(),
      role: "user",
      content,
      parts: [{ type: "text", text: content }],
      experimental_attachments:
        experimental_attachments.length > 0
          ? experimental_attachments
          : undefined,
      createdAt: new Date(),
      // @ts-expect-error metadata not typed
      metadata: {
        checkpoint: this.vault.proposedDoc.frontiers(),
      },
    } satisfies UIMessage);

    // Now run the conversation to completion
    await this.runConversation();
  }

  async runConversation() {
    try {
      this.state = { type: "loading" };

      const plugin = usePlugin();
      await plugin.loadSettings();

      let system: string | null = null;
      let metadata: CachedMetadata | null = null;
      let activeTools: Record<string, Tool> = {};

      const agentFile = plugin.app.vault.getFileByPath(this.options.agentPath);
      if (!agentFile) {
        throw Error(`Agent at ${this.options.agentPath} not found`);
      }

      metadata = plugin.app.metadataCache.getFileCache(agentFile);
      system = await createSystemContent(agentFile);
      activeTools = await loadToolsFromFrontmatter(
        metadata!,
        this,
        this.getAccount().provider,
      );
      debug("SYSTEM MESSAGE\n-----\n", system);
      debug("Active tools", activeTools);

      this.state = { type: "loading" };
      this.#abortController = new AbortController();

      debug("Submitting messages", $state.snapshot(this.messages));

      const messages: CoreMessage[] = [];
      if (system) {
        messages.push({
          role: "system",
          content: system,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        });
      }
      messages.push(
        ...convertToCoreMessages(
          wrapTextAttachments($state.snapshot(this.messages)),
        ),
      );

      const lastUserMessage = messages.findLast((m) => m.role === "user");
      if (lastUserMessage) {
        lastUserMessage.providerOptions = {
          anthropic: {
            cacheControl: { type: "ephemeral" },
          },
        };
      }

      debug("Core messages", messages);

      await this.callModel(
        messages,
        this.options.modelId!,
        this.getAccount(),
        activeTools,
        this.#abortController?.signal,
      );
    } catch (error: any) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
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

      const plugin = usePlugin();
      plugin.showNotice(errorMessage);
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

  async callModel(
    messages: CoreMessage[],
    modelId: string,
    account: AIAccount,
    activeTools: Record<string, any>,
    abortSignal: AbortSignal,
  ) {
    const provider = createAIProvider(account);

    // Retry loop config
    const MAX_RETRY_ATTEMPTS = 3;
    const DEFAULT_RETRY_DELAY = 1000;
    let attempt = 0;

    while (true) {
      try {
        this.state = { type: "loading" };

        const stream = streamText({
          model: provider.languageModel(modelId),
          messages,
          tools: Object.keys(activeTools).length > 0 ? activeTools : undefined,
          maxRetries: 0,
          maxSteps: this.options.maxSteps,
          temperature: this.options.temperature,
          providerOptions: {
            anthropic: {
              ...(this.options.thinkingEnabled
                ? {
                    thinking: {
                      type: "enabled",
                      budgetTokens: this.options.thinkingTokensBudget,
                    },
                  }
                : {}),
            } satisfies AnthropicProviderOptions,
          },
          abortSignal,
          onStepFinish: async (step) => {
            this.vault.computeChanges();
            debug("Step finish", step);
            step.toolCalls.forEach((toolCall) => {
              debug("Tool call", toolCall.toolName, toolCall.args);
            });
            step.toolResults.forEach((toolResult) => {
              debug("Tool result", toolResult.toolName, toolResult.result);
            });
          },
          onFinish: async (result) => {
            debug("Finished", result, $state.snapshot(this.messages));
          },
        });

        // As we receive partial tokens, we apply them to `this.messages`
        for await (const chunk of stream.fullStream) {
          applyStreamPartToMessages(this.messages, chunk);
        }

        this.vault.computeChanges();

        // If we get here, the call was successful
        return;
      } catch (error: any) {
        // Handle user abort
        if (error instanceof DOMException && error.name === "AbortError") {
          debug("Request aborted by user");
          throw error;
        }
        // Check for rate limit
        if (error.statusCode === 429) {
          attempt++;
          await this.handleRateLimit(
            attempt,
            MAX_RETRY_ATTEMPTS,
            DEFAULT_RETRY_DELAY,
            error,
          );
          continue; // retry
        }
        // Not a rate limit => rethrow
        throw error;
      }
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
    await plugin.app.vault.modify(file, ChatSerializer.stringify(this));
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
    if (!file.basename.startsWith("New chat")) {
      return false;
    }

    return true;
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
      .map((msg) => `${msg.role}: ${msg.content}`)
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
      const messages: CoreMessage[] = [
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
      let newBasename = extractedTitle;
      let counter = 1;
      let newPath = file.path.replace(file.basename, newBasename);

      // Ensure the new path is unique by checking if a file with the same path already exists
      // Skip the check if the new path is the same as the current file path
      while (
        plugin.app.vault.getAbstractFileByPath(newPath) &&
        newPath !== file.path
      ) {
        newBasename = `${extractedTitle} ${counter}`;
        newPath = file.path.replace(file.basename, newBasename);
        counter++;
      }

      await plugin.app.fileManager.renameFile(file, newPath);
    } catch (error) {
      new Notice(`Chat title generation failed. Error: ${error}.`, 5000);
    }
  }

  async handleRateLimit(
    attempt: number,
    maxAttempts: number,
    defaultDelay: number,
    error: any,
  ): Promise<void> {
    if (attempt > maxAttempts) {
      throw error;
    }

    let retryDelay = defaultDelay;
    if (error.responseHeaders?.["retry-after"]) {
      // "retry-after" is in seconds, convert to ms
      retryDelay = parseInt(error.responseHeaders["retry-after"]) * 1000;
    }

    this.state = {
      type: "retrying",
      attempt,
      maxAttempts,
      delay: retryDelay,
    };

    debug(
      `Rate limited (429). Retrying in ${retryDelay / 1000} seconds... (Attempt ${attempt} of ${maxAttempts})`,
    );

    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  getModel() {
    const plugin = usePlugin();
    const model = plugin.settings.models.find(
      (m): m is ChatModel => m.type === "chat" && m.id === this.options.modelId,
    );
    if (!model) {
      throw Error(`Chat model ${this.options.modelId} not found`);
    }
    return model;
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
}
