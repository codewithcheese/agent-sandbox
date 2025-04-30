import {
  type Attachment,
  convertToCoreMessages,
  type CoreMessage,
  streamText,
  type Tool,
  type UIMessage,
} from "ai";
import { type AIAccount, createAIProvider } from "../settings/providers.ts";
import { nanoid } from "nanoid";
import type { CachedMetadata, TFile } from "obsidian";
import { processTemplate } from "$lib/utils/templates.ts";
import {
  processEmbeds,
  processLinks,
  stripFrontMatter,
} from "$lib/utils/embeds.ts";
import { wrapTextAttachments } from "$lib/utils/messages.ts";
import { fileTree } from "$lib/utils/file-tree.ts";
import { loadToolsFromFrontmatter } from "../tools";
import { applyStreamPartToMessages } from "$lib/utils/stream.ts";
import { arrayBufferToBase64 } from "$lib/utils/base64.ts";
import { extensionToMimeType } from "$lib/utils/mime.ts";
import type { ChatModel } from "../settings/models.ts";
import { usePlugin } from "$lib/utils";
import { ChatSerializer, type CurrentChatFile } from "./chat-serializer.ts";
import type { ToolRequest } from "../tools/request.ts";

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

const registry = new FinalizationRegistry((path: string) => {
  console.log("Finalizing chat", path);
  chatCache.delete(path);
});

export class Chat {
  path: string;
  messages = $state<UIMessage[]>([]);
  selectedChatbot = $state<string | undefined>();
  chatbots = $state<TFile[]>([]);
  attachments = $state<DocumentAttachment[]>([]);
  state = $state<LoadingState>({ type: "idle" });
  toolRequests = $state<ToolRequest[]>([]);
  createdAt: Date;
  updatedAt: Date;
  options = $state<{ maxSteps: number }>({ maxSteps: 10 });

  #abortController?: AbortController;

  constructor(path: string, data: CurrentChatFile) {
    Object.assign(this, data.payload);
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
        console.log("Loading chat from cache", path);
        return cachedValue;
      } else {
        // Reference was garbage collected
        console.log("Chat was garbage collected, reloading", path);
        chatCache.delete(path);
      }
    }
    console.log("Loading chat from file", path);
    // synchronously cache the promise to prevent multiple loads
    const chatPromise = Chat.create(path);
    chatCache.set(path, new WeakRef(chatPromise));

    // await chat and register for finalization
    const chat = await chatPromise;
    chatCache.set(path, new WeakRef(chat));
    registry.register(chat, path);

    return chat;
  }

  addAttachment(file: TFile) {
    this.attachments.push({
      id: nanoid(),
      file,
    });
    this.save();
  }

  removeAttachment(attachmentId: string) {
    const index = this.attachments.findIndex((a) => a.id === attachmentId);
    if (index !== -1) {
      this.attachments.splice(index, 1);
      this.save();
    }
  }

  clearAttachments() {
    this.attachments = [];
    this.save();
  }

  async loadChatbots() {
    const plugin = usePlugin();
    const directoryPath = plugin.settings.vault.chatbotsPath;
    const files = plugin.app.vault.getFiles();
    const normalizedPath = directoryPath.startsWith("/")
      ? directoryPath.slice(1)
      : directoryPath;

    this.chatbots = files.filter((file) =>
      file.path.startsWith(normalizedPath),
    );
  }

  async submit(event: Event, modelId: string, accountId: string) {
    event.preventDefault();

    const formData = new FormData(event.target as HTMLFormElement);
    const content = formData.get("content")?.toString() ?? "";
    if (!content && this.attachments.length === 0) return;

    const plugin = usePlugin();

    // Find the selected model
    const model = plugin.settings.models.find(
      (m): m is ChatModel => m.type === "chat" && m.id === modelId,
    );
    if (!model) {
      throw Error(`Chat model ${modelId} not found`);
    }
    const account = plugin.settings.accounts.find((a) => a.id === accountId);
    if (!account) {
      throw Error(`AI account ${accountId} not found`);
    }

    // Prepare any attachments as data URIs
    const attachments: Attachment[] = [];
    if (this.attachments.length > 0) {
      for (const attachment of this.attachments) {
        try {
          const data = await plugin.app.vault.readBinary(attachment.file);
          const base64 = arrayBufferToBase64(data);
          attachments.push({
            name: attachment.file.path,
            contentType: extensionToMimeType(attachment.file.extension),
            url: `data:${extensionToMimeType(attachment.file.extension)};base64,${base64}`,
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
        attachments.length > 0 ? attachments : undefined,
      createdAt: new Date(),
    });

    // Clear the form and attachments
    (event.target as HTMLFormElement)?.reset();
    this.clearAttachments();

    // Now run the conversation to completion
    await this.runConversation(model, account);
  }

  private async runConversation(model: ChatModel, account: AIAccount) {
    try {
      this.state = { type: "loading" };

      const plugin = usePlugin();
      await plugin.loadSettings();

      let system: string | null = null;
      let metadata: CachedMetadata | null = null;
      let activeTools: Record<string, Tool> = {};
      const context = {};

      if (this.selectedChatbot) {
        const chatbotFile = plugin.app.vault.getFileByPath(
          this.selectedChatbot,
        );

        if (!chatbotFile) {
          throw Error(`Chatbot at ${this.selectedChatbot} not found`);
        }

        metadata = plugin.app.metadataCache.getFileCache(chatbotFile);
        system = await this.createSystemPrompt(chatbotFile);
        activeTools = await loadToolsFromFrontmatter(metadata!, this);
        console.log("SYSTEM MESSAGE\n-----\n", system);
        console.log("Active tools", activeTools);
      }

      // We'll allow multiple steps. If the model calls a tool, we handle it, then call the model again.
      let stepCount = 0;

      this.state = { type: "loading" };
      this.#abortController = new AbortController();

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

      await this.callModel(
        messages,
        model.id,
        account,
        activeTools,
        this.#abortController?.signal,
      );
    } catch (error: any) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
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
      this.save();
    }
  }

  /**
   * Makes a single call to the model, returning any new tool calls & the finish reason.
   */
  private async callModel(
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
          abortSignal,
        });

        // As we receive partial tokens, we apply them to `this.messages`
        for await (const chunk of stream.fullStream) {
          applyStreamPartToMessages(this.messages, chunk);
        }

        // If we get here, the call was successful
        return;
      } catch (error: any) {
        // Handle user abort
        if (error instanceof DOMException && error.name === "AbortError") {
          console.log("Request aborted by user");
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

  /**
   * Cancel the current call (if any), set state to idle.
   */
  cancel() {
    if (this.#abortController) {
      this.#abortController.abort("cancelled");
    }
    this.state = { type: "idle" };
  }

  /**
   * Persist the conversation state by serializing the data
   */
  public async save() {
    const plugin = usePlugin();
    const file = plugin.app.vault.getAbstractFileByPath(this.path);
    if (!file) {
      throw Error(`Chat file not found: ${this.path}`);
    }
    await plugin.app.vault.modify(file, ChatSerializer.stringify(this));
  }

  /**
   * Handle 429 rate limit errors by waiting for the specified time or a default delay.
   */
  private async handleRateLimit(
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

    console.log(
      `Rate limited (429). Retrying in ${retryDelay / 1000} seconds... (Attempt ${attempt} of ${maxAttempts})`,
    );

    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  async createSystemPrompt(file: TFile) {
    const plugin = usePlugin();
    let system = await plugin.app.vault.read(file)!;

    // Clean the file contents
    system = stripFrontMatter(system);
    system = await processEmbeds(file, system);
    system = await processLinks(file, system);
    system = await processTemplate(system, { fileTree });
    console.log("SYSTEM MESSAGE\n-----\n", system);
    return system;
  }
}
