import {
  type Attachment,
  convertToCoreMessages,
  type CoreMessage,
  streamText,
  type UIMessage,
  type ToolInvocation,
} from "ai";
import { type AIAccount, createAIProvider } from "../settings/providers.ts";
import { nanoid } from "nanoid";
import type { TFile } from "obsidian";
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
import { ChatSerializer, type ChatFileData } from "./chat-serializer.ts";
import type { ToolInvocationUIPart } from "@ai-sdk/ui-utils";

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

export class Chat {
  messages = $state<UIMessage[]>([]);
  selectedChatbot = $state<string | undefined>();
  chatbots = $state<TFile[]>([]);
  attachments = $state<DocumentAttachment[]>([]);
  state = $state<LoadingState>({ type: "idle" });

  #abortController?: AbortController;

  constructor(
    initialData: string | null,
    private onSave: (data: string) => void,
  ) {
    // Initialize with data if provided
    if (initialData) {
      try {
        const parsedData = ChatSerializer.parse(initialData);
        const chatData = ChatSerializer.deserialize(parsedData);

        if (chatData.chat) {
          this.messages = chatData.chat.messages || [];
          this.attachments = chatData.chat.attachments || [];
        }
      } catch (error) {
        console.error("Error parsing initial chat data:", error);
      }
    }
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

  /**
   * The main conversation loop: calls the LLM in steps, manually executes tools,
   * and keeps going until there's no more steps or a max step count is reached.
   */
  private async runConversation(model: ChatModel, account: AIAccount) {
    try {
      this.state = { type: "loading" };

      const plugin = usePlugin();
      await plugin.loadSettings();

      // Prepare system prompt if selected
      let system: string | null = null;
      let metadata = null;

      if (this.selectedChatbot) {
        const file = plugin.app.vault.getFileByPath(this.selectedChatbot);
        if (!file) {
          throw Error(`Chatbot at ${this.selectedChatbot} not found`);
        }
        // Read file
        system = await plugin.app.vault.read(file);

        // Grab metadata to see if there's frontmatter (for tools, etc.)
        metadata = plugin.app.metadataCache.getFileCache(file);

        // Clean the file contents
        system = stripFrontMatter(system);
        system = await processEmbeds(file, system);
        system = await processLinks(file, system);
        system = await processTemplate(system, { fileTree });
        console.log("SYSTEM MESSAGE\n-----\n", system);
      }

      // Load frontmatter-specified tools and their executors
      const { tools: activeTools, executors: toolExecutors } = await loadToolsFromFrontmatter(metadata);
      console.log("Active tools", activeTools);

      // We'll allow multiple steps. If the model calls a tool, we handle it, then call the model again.
      const MAX_STEPS = 10;
      let stepCount = 0;

      this.state = { type: "loading" };
      this.#abortController = new AbortController();

      // We'll keep calling the model until no more steps
      while (stepCount < MAX_STEPS) {
        try {
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

          await this.callModel(messages, model.id, account, activeTools);

          stepCount++;

          const assistantMessage = this.messages[this.messages.length - 1];

          if (
            assistantMessage.parts.filter((p) => p.type === "tool-invocation")
              .length === 0
          ) {
            // exit if no tool invocations
            break;
          }

          // Manually execute each tool call, store results, add them to messages
          for (const part of assistantMessage.parts.filter(
            (p): p is ToolInvocationUIPart => p.type === "tool-invocation",
          )) {
            const result = await this.executeTool(part.toolInvocation, toolExecutors);
            part.toolInvocation.state = "result";
            // @ts-expect-error result prop not inferred from state change above
            part.toolInvocation.result = result;
          }

          // We'll continue the outer loop to let the model see the new tool results
        } catch (error: any) {
          // Handle user abort
          if (error instanceof DOMException && error.name === "AbortError") {
            console.log("Request aborted by user");
            return;
          }
          // Any other errors are passed up
          throw error;
        }
      }
    } catch (error: any) {
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
          maxRetries: 0, // We handle retries ourselves
          maxSteps: 1, // 1 step => if a tool is invoked, we'll handle manually
          abortSignal: this.#abortController.signal,
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
   * Manual execution of a tool.
   * You can customize it to store or return additional metadata as needed.
   */
  private async executeTool(
    invocation: ToolInvocation,
    toolExecutors: Record<string, (params: any) => Promise<any>>
  ) {
    console.log(
      "Manually executing tool:",
      invocation.toolName,
      invocation.args,
    );

    try {
      if (!toolExecutors[invocation.toolName]) {
        throw new Error(`Tool executor not found for: ${invocation.toolName}`);
      }
      
      // Execute the tool using the corresponding executor
      const result = await toolExecutors[invocation.toolName](invocation.args);
      return result;
    } catch (err: any) {
      console.error("Manual tool execution failed:", err);
      return { error: err.message || String(err) };
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
  private save() {
    const serializedData = ChatSerializer.serialize({
      messages: this.messages,
      attachments: this.attachments,
    });
    const data = ChatSerializer.stringify(serializedData);
    this.onSave(data);
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
}
