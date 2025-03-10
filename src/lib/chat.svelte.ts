import { Attachment, generateId, streamText, UIMessage } from "ai";
import { nanoid } from "nanoid";
import { TFile } from "obsidian";
import { usePlugin } from "$lib/utils";
import { processTemplate } from "$lib/utils/templates";
import { processEmbeds } from "$lib/utils/embeds";
import { createAnthropic } from "@ai-sdk/anthropic";
import { wrapTextAttachments } from "$lib/utils/messages";
import { getAllTools } from "$lib/tools";
import { fileTree } from "$lib/utils/fileTree";
import { applyStreamPartToMessages } from "$lib/utils/stream";
import { arrayBufferToBase64 } from "./utils/base64";
import { extensionToMimeType } from "$lib/utils/mime";
import { ChatModel } from "../../plugin/models";
import { createAIProvider } from "$lib/ai";
import { AIAccount } from "../../plugin/settings";

export interface DocumentAttachment {
  id: string;
  file: TFile;
}

export type LoadingState =
  | { type: "idle" }
  | {
      type: "loading";
    }
  | {
      type: "retrying";
      attempt: number;
      maxAttempts: number;
      delay: number;
    };

export class Chat {
  #messages = $state<UIMessage[]>([]);
  #selectedChatbot = $state<string | undefined>();
  #chatbots = $state<TFile[]>([]);
  #attachments = $state<DocumentAttachment[]>([]);
  #state = $state<LoadingState>({ type: "idle" });

  #abortController?: AbortController;

  get messages() {
    return this.#messages;
  }

  get chatbots() {
    return this.#chatbots;
  }

  get selectedChatbot() {
    return this.#selectedChatbot;
  }

  get attachments() {
    return this.#attachments;
  }

  get state() {
    return this.#state;
  }

  set selectedChatbot(value: string | undefined) {
    this.#selectedChatbot = value;
  }

  addAttachment(file: TFile) {
    this.#attachments.push({
      id: nanoid(),
      file,
    });
  }

  removeAttachment(attachmentId: string) {
    const index = this.#attachments.findIndex((a) => a.id === attachmentId);
    if (index !== -1) {
      this.#attachments.splice(index, 1);
    }
  }

  clearAttachments() {
    this.#attachments = [];
  }

  reset() {
    this.#messages = [];
    this.#abortController?.abort("reset");
    this.#abortController = undefined;
  }

  async loadChatbots() {
    const plugin = usePlugin();
    const directoryPath = plugin.settings.chatbotsPath;
    const files = plugin.app.vault.getFiles();
    const normalizedPath = directoryPath.startsWith("/")
      ? directoryPath.slice(1)
      : directoryPath;

    this.#chatbots = files.filter((file) =>
      file.path.startsWith(normalizedPath),
    );
  }

  async submit(event: Event, modelId: string, accountId: string) {
    event.preventDefault();

    const formData = new FormData(event.target as HTMLFormElement);
    const content = formData.get("content")?.toString() ?? "";
    if (!content && this.#attachments.length === 0) return;

    const plugin = usePlugin();
    
    // Find the selected model
    const model = plugin.settings.models.find(
      (model): model is ChatModel =>
        model.type === "chat" && model.id === modelId
    );
    if (!model) {
      throw Error(`Chat model ${modelId} not found`);
    }

    // Find the selected account
    const account = plugin.settings.accounts.find(
      (a) => a.id === accountId
    );
    if (!account) {
      throw Error(`AI account ${accountId} not found`);
    }

    // Create attachments array for files
    const attachments: Attachment[] = [];
    let messageContent = content;

    // Process attachments
    if (this.#attachments.length > 0) {
      for (const attachment of this.#attachments) {
        try {
          // Read the file data
          const data = await plugin.app.vault.readBinary(attachment.file);
          // Convert to base64
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

    this.#messages.push({
      id: nanoid(),
      role: "user",
      content: messageContent,
      parts: [{ type: "text", text: messageContent }],
      experimental_attachments:
        attachments.length > 0 ? attachments : undefined,
      createdAt: new Date(),
    });

    (event.target as HTMLFormElement)?.reset();
    this.clearAttachments();

    await this.callModel(model, account);
  }

  async callModel(model: ChatModel, account: AIAccount) {
    this.#state = {
      type: "loading",
    };

    const plugin = usePlugin();
    await plugin.loadSettings();

    let system: string | null = null;
    let requestedTools: string[] = [];

    if (this.#selectedChatbot) {
      const file = plugin.app.vault.getFileByPath(this.#selectedChatbot);
      if (!file) {
        throw Error(`Chatbot at ${this.#selectedChatbot} not found`);
      }
      system = await plugin.app.vault.read(file);

      // Get file metadata to check for frontmatter
      const metadata = plugin.app.metadataCache.getFileCache(file);
      // Check if there's a Tools property in the frontmatter
      if (metadata?.frontmatter && metadata.frontmatter.Tools) {
        // Tools can be specified as a string or an array
        if (typeof metadata.frontmatter.Tools === "string") {
          requestedTools = [metadata.frontmatter.Tools];
        } else if (Array.isArray(metadata.frontmatter.Tools)) {
          requestedTools = metadata.frontmatter.Tools;
        }
        console.log("Chatbot requested tools:", requestedTools);
      }

      system = await processEmbeds(file, system);
      system = await processTemplate(system, {
        fileTree,
      });
      console.log("Using system message", system);
    }

    let prepend: UIMessage[] = system
      ? [
          {
            id: generateId(),
            role: "system",
            content: system,
            parts: [{ type: "text", text: system }],
          },
        ]
      : [];

    const messages = wrapTextAttachments([
      ...prepend,
      ...$state.snapshot(this.#messages),
    ]);

    const tools = getAllTools();

    // Filter tools based on requested tools in frontmatter
    const activeTools =
      requestedTools.length > 0
        ? Object.fromEntries(
            Object.entries(tools).filter(([name]) =>
              requestedTools.includes(name),
            ),
          )
        : {}; // If no tools specified, don't use any tools

    this.#abortController = new AbortController();

    // Retry configuration
    const MAX_RETRY_ATTEMPTS = 3;
    const DEFAULT_RETRY_DELAY = 1000;
    let attempt = 0;

    const provider = createAIProvider(account);
    try {
      while (true) {
        try {
          // Reset retry state at the beginning of each attempt
          this.#state = { type: "loading" };

          // Make the API call
          const stream = streamText({
            model: provider.languageModel(model.id),
            messages,
            providerOptions: {
              // anthropic: {
              //   thinking: { type: "enabled", budgetTokens: 12000 },
              // },
            },
            ...(Object.keys(activeTools).length > 0
              ? { tools: activeTools }
              : {}),
            maxRetries: 0, // We're handling retries ourselves
            maxSteps: 10,
            abortSignal: this.#abortController?.signal,
            onStepFinish: ({ text, toolCalls, toolResults }) => {
              // Log tool usage for debugging
              if (toolCalls && toolCalls.length > 0) {
                console.log("Tool calls:", toolCalls);
                console.log("Tool results:", toolResults);
              }
            },
            onFinish: () => {},
          });

          for await (const chunk of stream.fullStream) {
            applyStreamPartToMessages(this.#messages, chunk);
          }

          // If we get here, the call was successful, so break out of the retry loop
          break;
        } catch (error) {
          // Handle abort errors (user cancellation)
          if (error instanceof DOMException && error.name === "AbortError") {
            console.log("Request aborted by user");
            return;
          }

          // Check if this is a rate limit error
          if (error.statusCode === 429) {
            attempt++;

            await this.handleRateLimit(
              attempt,
              MAX_RETRY_ATTEMPTS,
              DEFAULT_RETRY_DELAY,
              error,
            );
            // Continue to next iteration if retry is possible
            continue;
          }
          // Not a rate limit error, just throw it
          throw error;
        }
      }
    } catch (error) {
      console.error("Error calling model:", error);
      this.handleModelError(error);
    } finally {
      this.#state = { type: "idle" };
    }
  }

  /**
   * Cancels the current model call and cleans up state
   */
  cancel() {
    if (this.#abortController) {
      this.#abortController.abort("cancelled");
    }
    this.#state = { type: "idle" };
  }

  /**
   * Handles model errors by showing an Obsidian notice with appropriate error messages
   */
  private handleModelError(error: any): void {
    // Format a user-friendly error message based on the error type
    let errorMessage = "An error occurred while generating the response.";

    if (error.statusCode === 429) {
      errorMessage = "Rate limit exceeded. Please try again later.";
    } else if (error.statusCode === 401 || error.statusCode === 403) {
      errorMessage = "Authentication error. Please check your API key.";
    } else if (error.statusCode >= 500) {
      errorMessage = "Server error. The AI service may be experiencing issues.";
    } else if (error.message) {
      errorMessage = `Error: ${error.message}`;
    }

    // Show an Obsidian notice with the error message
    const plugin = usePlugin();
    plugin.showNotice(errorMessage);
  }

  /**
   * Handles rate limit errors by setting up retry state and waiting for the appropriate time
   * @returns true if retry is possible, false if max attempts exceeded
   */
  private async handleRateLimit(
    attempt: number,
    maxAttempts: number,
    defaultDelay: number,
    error: any,
  ): Promise<boolean> {
    // If we've exceeded max retries, we can't retry
    if (attempt > maxAttempts) {
      throw error;
    }

    // Get retry delay from header or use default
    let retryDelay = defaultDelay;
    if (error.responseHeaders?.["retry-after"]) {
      // Retry-After header value is in seconds, convert to milliseconds
      retryDelay = parseInt(error.responseHeaders["retry-after"]) * 1000;
    }

    // Set retry state for UI
    this.#state = {
      type: "retrying",
      attempt,
      maxAttempts,
      delay: retryDelay,
    };

    console.log(
      `Rate limited (429). Retrying in ${retryDelay / 1000} seconds... (Attempt ${attempt} of ${maxAttempts})`,
    );

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, retryDelay));

    return true;
  }
}
