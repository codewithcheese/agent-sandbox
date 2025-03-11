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
    TerminalIcon,
    XIcon,
  } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import { formatDate, usePlugin } from "$lib/utils";
  import { insertCss } from "$lib/utils/insert-css.ts";
  import { onDestroy, onMount } from "svelte";
  import Markdown from "$lib/components/Markdown.svelte";
  import RetryAlert from "$lib/components/RetryAlert.svelte";
  import type { AIAccount, AIProviderId } from "../settings/providers.ts";

  const plugin = usePlugin();

  let { chat }: { chat: Chat } = $props();

  let submitBtn: HTMLButtonElement | null = $state(null);
  let selectedModelId: string | undefined = $state(undefined);
  let selectedAccountId: string | undefined = $state(undefined);

  $inspect("chat", selectedModelId, selectedAccountId);

  onMount(() => {
    chat.loadChatbots();
  });

  onDestroy(() => {
    chat.cancel();
  });

  function submitOnEnter(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitBtn!.click();
    }
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

  function openAttachment(path: string) {
    const plugin = usePlugin();
    const file = plugin.app.vault.getFileByPath(path);
    if (file) {
      plugin.app.workspace.openLinkText(file.path, "", true);
    }
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
</script>

<div use:insertCss={chatCss} class="flex h-full w-full">
  <div class="flex flex-col h-full p-2 w-full">
    <div class="mb-4 flex items-center gap-2">
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
        onclick={startNewChat}
      >
        New Chat
        <PlusIcon class="size-3.5" />
      </Button>
    </div>
    <div class="flex-1 overflow-y-auto">
      {#each chat.messages as message}
        <div
          class={message.role === "user"
            ? "border border-gray-rgb rounded p-2 my-2"
            : "text text-gray-800 my-4"}
        >
          {#if message.role === "user"}
            <div class="flex justify-between items-center mb-0.5 text-xs">
              <span class="font-medium">You</span>
              {#if message.createdAt}
                <span class="opacity-80">{formatDate(message.createdAt)}</span>
              {/if}
            </div>
          {/if}

          <div
            class="whitespace-pre-wrap prose leading-none
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
                          prose-a:decoration-1 text-foreground"
          >
            <Markdown md={message.content} />
          </div>

          {#if message.parts?.some((part) => part.type === "tool-invocation")}
            {#each message.parts as part}
              {#if part.type === "tool-invocation"}
                <div class="bg-gray-50 rounded border border-gray-200 p-2 my-2">
                  <div class="flex items-center gap-2 mb-1.5">
                    <TerminalIcon size={14} class="text-gray-600" />
                    <span class="font-medium text-gray-700"
                      >{part.toolInvocation.toolName}</span
                    >
                    {#if part.toolInvocation.state === "result"}
                      <CheckCircle2Icon
                        size={14}
                        class="text-green-500 ml-auto"
                      />
                    {:else if part.toolInvocation.state === "partial-call"}
                      <Loader2Icon
                        size={14}
                        class="text-blue-500 ml-auto animate-spin"
                      />
                    {/if}
                  </div>
                  <div
                    class="text-xs font-mono bg-gray-100 rounded p-1.5 overflow-x-auto"
                  >
                    {JSON.stringify(part.toolInvocation.args, null, 2)}
                  </div>
                </div>
              {/if}
            {/each}
          {/if}

          {#if message.experimental_attachments && message.experimental_attachments.length > 0}
            <div class="mt-2">
              <div class="flex flex-wrap gap-2">
                {#each message.experimental_attachments as attachment}
                  <button
                    class={message.role === "user"
                      ? "flex items-center gap-1.5 py-1 px-2 bg-purple-400/20 rounded text-sm hover:bg-purple-400/30 transition-colors"
                      : "flex items-center gap-1.5 py-1 px-2 bg-gray-100 rounded text-sm hover:bg-gray-200 transition-colors"}
                    onclick={() => openAttachment(attachment.name || "")}
                  >
                    <FileTextIcon class="size-3.5" />
                    <span class="max-w-[200px] truncate"
                      >{getBaseName(attachment.name || "")}</span
                    >
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}

      {#if chat.state.type === "retrying"}
        <RetryAlert retryState={chat.state} />
      {/if}
    </div>

    <form
      name="input"
      class="mt-4"
      onsubmit={(e) => {
        e.preventDefault();
        if (!selectedModelId || !selectedAccountId) {
          return;
        }
        chat.submit(e, selectedModelId, selectedAccountId);
      }}
    >
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
            bind:value={
              null,
              (v) => {
                const [modelId, accountId] = v.split(":");
                selectedModelId = modelId;
                selectedAccountId = accountId;
              }
            }
            name="model-account"
            class="w-[250px] h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            required
          >
            <option value=""> Select model </option>
            {#each getModelAccountOptions() as option}
              <option value={option.value}>
                {option.label}
              </option>
            {/each}
          </select>
        </div>

        <Button
          type="submit"
          size="sm"
          class="gap-1.5 rounded"
          bind:ref={submitBtn}
          disabled={chat.state.type !== "idle"}
        >
          {#if chat.state.type !== "idle"}
            <Loader2Icon class="size-3.5 animate-spin mr-1" />
            {#if chat.state.type === "retrying"}
              Retrying...
            {:else}
              Processing...
            {/if}
          {:else}
            Send Message
            <CornerDownLeftIcon class="size-3.5" />
          {/if}
        </Button>
      </div>
    </form>
  </div>
</div>
