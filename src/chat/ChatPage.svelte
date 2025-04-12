<script lang="ts">
  // @ts-expect-error css import type issue
  import chatCss from "./chat.css?inline";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Button } from "$lib/components/ui/button";
  import {
    CheckCircle2Icon,
    CornerDownLeftIcon,
    FileTextIcon,
    Loader2Icon,
    PlusIcon,
    RefreshCwIcon,
    StopCircleIcon,
    TerminalIcon,
    XIcon,
  } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import { cn, formatDate, usePlugin } from "$lib/utils";
  import { insertCss } from "$lib/utils/insert-css.ts";
  import { onDestroy, onMount } from "svelte";
  import Markdown from "$lib/components/Markdown.svelte";
  import RetryAlert from "$lib/components/RetryAlert.svelte";
  import type { AIAccount, AIProviderId } from "../settings/providers.ts";
  import { normalizePath, Notice } from "obsidian";
  import TextEditorToolView from "./TextEditorToolView.svelte";

  const plugin = usePlugin();

  let { chat }: { chat: Chat } = $props();

  let submitBtn: HTMLButtonElement | null = $state(null);
  let selectedModelId: string | undefined = $state(
    plugin.settings.defaults.modelId,
  );
  let selectedAccountId: string | undefined = $state(
    plugin.settings.defaults.accountId,
  );

  $inspect("selectedModelId", selectedModelId);
  $inspect("selectedAccountId", selectedAccountId);

  onMount(() => {
    chat.loadChatbots();
  });

  onDestroy(() => {
    chat.cancel();
  });

  function submitOnEnter(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitBtn!.click();
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!selectedModelId || !selectedAccountId) {
      return;
    }
    chat.submit(e, selectedModelId, selectedAccountId);
  }

  function handleModelChange(
    e: Event & {
      currentTarget: EventTarget & HTMLSelectElement;
    },
  ) {
    const [modelId, accountId] = e.currentTarget.value.split(":");
    selectedModelId = modelId;
    selectedAccountId = accountId;
    const plugin = usePlugin();
    plugin.settings.defaults.modelId = modelId;
    plugin.settings.defaults.accountId = accountId;
    plugin.saveSettings();
  }

  function selectDocument() {
    const plugin = usePlugin();
    plugin.openFileSelect((file) => {
      chat.addAttachment(file);
    });
  }

  function startNewChat() {
    chat.reset();
  }

  function getBaseName(path: string): string {
    if (!path) return "Attachment";
    return path.split("/").pop() || path;
  }

  function openFile(path: string) {
    const plugin = usePlugin();
    const normalizedPath = normalizePath(path);
    const file = plugin.app.vault.getFileByPath(normalizedPath);
    if (!file) {
      new Notice(`File not found: ${normalizedPath}`, 3000);
      return;
    }
    const centerLeaf = plugin.app.workspace.getLeaf("tab");
    centerLeaf.openFile(file, { active: true });
  }

  function getModelAccountOptions() {
    const accountsByProvider = {} as Record<AIProviderId, AIAccount[]>;
    plugin.settings.accounts.forEach((account) => {
      if (!accountsByProvider[account.provider]) {
        accountsByProvider[account.provider] = [];
      }
      accountsByProvider[account.provider].push(account);
    });

    return plugin.settings.models
      .filter((model) => model.type === "chat")
      .flatMap((model) => {
        const accounts = accountsByProvider[model.provider] || [];
        if (accounts.length === 0) return [];

        const showAccountName = accounts.length > 1;

        return accounts.map((account) => ({
          value: `${model.id}:${account.id}`,
          label: showAccountName ? `${model.id} (${account.name})` : model.id,
          modelId: model.id,
          accountId: account.id,
        }));
      });
  }

  async function reviewTextEditorChanges(toolCallId: string, args: any) {
    try {
      const plugin = usePlugin();

      // Get the file path
      const normalizedPath = args.path.startsWith("/")
        ? args.path.substring(1)
        : args.path;

      // Get the file
      const file = plugin.app.vault.getFileByPath(normalizedPath);
      if (!file) {
        new Notice(`File not found: ${args.path}`, 3000);
        return;
      }

      // Read the original content
      const originalContent = await plugin.app.vault.read(file);

      // Generate the proposed content based on the command
      let proposedContent = originalContent;

      if (args.command === "str_replace") {
        proposedContent = originalContent.replace(args.old_str, args.new_str);
      } else if (args.command === "insert") {
        const lines = originalContent.split("\n");
        lines.splice(args.insert_line, 0, args.new_str);
        proposedContent = lines.join("\n");
      }

      // Open a new leaf for the merge view
      const leaf = plugin.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: "merge-view",
        state: {
          originalContent,
          proposedContent,
          originalFilePath: normalizedPath,
          toolCallId,
          args,
        },
      });

      // Focus the new leaf
      plugin.app.workspace.setActiveLeaf(leaf, { focus: true });

      // Get the view
      // const view = leaf.view as any;

      // // Set up event handler for when changes are saved
      // if (view && view.on) {
      //   view.on("changes-saved", async (savedContent: string) => {
      //     // Add the result to the chat
      //     chat.addToolResult({
      //       toolCallId,
      //       result: { content: `Changes to ${args.path} were applied successfully.` },
      //     });

      //     // Resume the chat
      //     await chat.resume(selectedModelId, selectedAccountId);
      //   });

      //   view.on("changes-rejected", async () => {
      //     // Add a result indicating rejection
      //     chat.addToolResult({
      //       toolCallId,
      //       result: { content: "Changes were rejected by the user." },
      //     });
      //   });
      // }
    } catch (error) {
      console.error("Error opening merge view:", error);
      new Notice(`Error: ${error.message}`, 3000);
    }
  }
</script>

<div use:insertCss={chatCss} class="flex h-full chat-margin">
  <div class="flex flex-col h-full p-2 w-full">
    <div class="mb-4 flex gap-2 justify-between">
      <div class="flex flex-row items-center gap-1">
        <select
          class="w-[250px] h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          bind:value={chat.selectedChatbot}
        >
          <option value={undefined}>Select a chatbot...</option>
          {#each chat.chatbots as chatbot}
            <option value={chatbot.path}>{chatbot.basename}</option>
          {/each}
        </select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="gap-1.5 rounded"
          onclick={() => chat.loadChatbots()}
        >
          <RefreshCwIcon class="size-3.5" />
        </Button>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        class="gap-1.5 rounded"
        onclick={startNewChat}
      >
        New Chat
        <PlusIcon class="size-3.5" />
      </Button>
    </div>
    <div class="flex flex-col flex-1 overflow-y-auto gap-1">
      {#each chat.messages as message}
        <div
          class={message.role === "user"
            ? "bg-gray-50 rounded"
            : "text text-gray-800"}
        >
          {#if message.content}
            <div
              class="whitespace-pre-wrap prose leading-none select-text
                          prose-h1:my-2
                          prose-h2:mt-2 prose-h2:mb-1
                          prose-h3:mt-2 prose-h3:mb-1
                          prose-h4:mt-2 prose-h4:mb-1
                          prose-h5:mt-2 prose-h5:mb-1
                          prose-h6:my-1
                          prose-p:my-1
                          prose-blockquote:my-1
                          prose-figure:my-1
                          prose-figcaption:mt-1
                          prose-ul:my-0
                          prose-ol:my-0
                          prose-li:my-0
                          prose-table:my-1
                          prose-thead:my-1
                          prose-tbody:my-1
                          prose-dl:my-1
                          prose-dt:my-1
                          prose-dd:my-1
                          prose-hr:my-2
                          prose-pre:my-1
                          prose-code:px-1
                          prose-lead:my-1
                          prose-strong:font-semibold
                          prose-img:my-1
                          prose-video:my-1
                          prose-a:decoration-1 text-foreground max-w-full {message.role ===
              'user'
                ? 'p-2'
                : 'py-2'}"
            >
              <Markdown md={message.content} />
            </div>
          {/if}

          {#if message.experimental_attachments && message.experimental_attachments.length > 0}
            <div class="mt-2">
              <div class="flex flex-wrap gap-2">
                {#each message.experimental_attachments as attachment}
                  <button
                    class={message.role === "user"
                      ? "flex items-center gap-1.5 py-1 px-2 bg-purple-400/20 rounded text-sm hover:bg-purple-400/30 transition-colors"
                      : "flex items-center gap-1.5 py-1 px-2 bg-gray-100 rounded text-sm hover:bg-gray-200 transition-colors"}
                    onclick={() => openFile(attachment.name)}
                  >
                    <FileTextIcon class="size-3.5" />
                    <span class="max-w-[200px] truncate"
                      >{getBaseName(attachment.name)}</span
                    >
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        {#if message.parts?.some((part) => part.type === "tool-invocation")}
          {#each message.parts as part}
            {#if part.type === "tool-invocation"}
              <div class="rounded border border-gray-200">
                <!-- Handle tool invocations -->
                {#if part.toolInvocation.toolName === "str_replace_editor"}
                  <TextEditorToolView
                    toolInvocation={part.toolInvocation}
                    {reviewTextEditorChanges}
                  />
                {:else}
                  <div
                    class="text-xs bg-gray-100 p-2 rounded font-mono whitespace-pre-wrap"
                  >
                    {JSON.stringify(part.toolInvocation.args, null, 2)}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      {/each}

      {#if chat.state.type === "retrying"}
        <RetryAlert retryState={chat.state} />
      {/if}
    </div>

    <form name="input" class="mt-4" onsubmit={handleSubmit}>
      {#if chat.state.type === "loading"}
        <div class="flex items-center gap-2 mb-3 text-sm text-blue-600">
          <Loader2Icon class="size-4 animate-spin" />
          <span>Assistant is thinking...</span>
        </div>
      {/if}
      {#if chat.attachments.length > 0}
        <div class="flex flex-wrap gap-2 mb-2">
          {#each chat.attachments as attachment}
            <div
              class="flex items-center gap-1.5 py-1 px-2 bg-gray-100 rounded text-sm"
            >
              <FileTextIcon class="size-3.5 text-gray-600" />
              <span class="max-w-[200px] truncate"
                >{getBaseName(attachment.file.path)}</span
              >
              <button
                type="button"
                class="text-gray-500 hover:text-gray-700"
                onclick={() => chat.removeAttachment(attachment.id)}
              >
                <XIcon class="size-3.5" />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <Textarea
        required
        name="content"
        placeholder="How can I assist you today?"
        onkeypress={submitOnEnter}
        class="min-h-[80px] rounded"
      />
      <div class="flex items-center justify-between mt-2">
        <div class="flex flex-row align-middle gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="gap-1.5 rounded"
            onclick={selectDocument}
          >
            <FileTextIcon class="size-3.5" />
          </Button>

          <!-- model select -->
          <select
            onchange={handleModelChange}
            name="model-account"
            class="w-[250px] h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            required
          >
            <option value=""> Select model </option>
            {#each getModelAccountOptions() as option}
              <option
                value={option.value}
                selected={option.value ===
                  `${selectedModelId}:${selectedAccountId}`}
              >
                {option.label}
              </option>
            {/each}
          </select>
        </div>
        {#if chat.state.type === "idle"}
          <Button
            type="submit"
            size="sm"
            class="gap-1.5 rounded"
            bind:ref={submitBtn}
          >
            Send
            <CornerDownLeftIcon class="size-3.5" />
          </Button>
        {:else}
          <Button
            type="button"
            size="sm"
            class="gap-1.5 rounded bg-background border text-black"
            onclick={() => chat.cancel()}
          >
            <StopCircleIcon class="size-3.5" />
            Cancel
          </Button>
        {/if}
      </div>
    </form>
  </div>
</div>

<style>
  .chat-margin {
    max-width: var(--file-line-width);
    margin-left: auto;
    margin-right: auto;
  }
</style>
