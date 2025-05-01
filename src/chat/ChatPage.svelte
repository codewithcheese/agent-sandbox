<script lang="ts">
  // @ts-expect-error CSS import type issue
  import chatCss from "./chat.css?inline";

  import { Textarea } from "$lib/components/ui/textarea";
  import { Button } from "$lib/components/ui/button";
  import {
    ArrowLeft,
    CornerDownLeftIcon,
    FileTextIcon,
    InfoIcon,
    Loader2Icon,
    PlusIcon,
    RefreshCwIcon,
    StopCircleIcon,
    WrenchIcon,
    XIcon,
  } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import { usePlugin } from "$lib/utils";
  import { insertCss } from "$lib/utils/insert-css.ts";
  import { onDestroy, onMount } from "svelte";
  import Markdown from "$lib/components/Markdown.svelte";
  import RetryAlert from "$lib/components/RetryAlert.svelte";
  import type { AIAccount, AIProviderId } from "../settings/providers.ts";
  import { normalizePath, Notice } from "obsidian";
  import ToolRequestRow from "./ToolRequestRow.svelte";
  import { type ViewContext } from "$lib/obsidian/view.ts";
  import { MERGE_VIEW_TYPE } from "$lib/merge/merge-view.ts";
  import { findCenterLeaf } from "$lib/utils/obsidian.ts";
  import { openToolInvocationInfoModal } from "$lib/modals/tool-invocation-info-modal.ts";
  import type { ToolRequest } from "../tools/tool-request.ts";
  import ChatInput from "./ChatInput.svelte";

  const plugin = usePlugin();

  let { chat, view }: { chat: Chat; view: ViewContext } = $props();

  $inspect("toolRequests", chat.toolRequests);

  console.log(findCenterLeaf());

  let submitBtn: HTMLButtonElement | null = $state(null);
  let selectedModelId: string | undefined = $state(
    plugin.settings.defaults.modelId,
  );
  let selectedAccountId: string | undefined = $state(
    plugin.settings.defaults.accountId,
  );

  let countFilesWithRequests = $derived(
    new Set(
      chat.toolRequests
        .filter((r) => r.status === "pending")
        .map((r) => r.path),
    ).size,
  );

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
    const plugin = usePlugin();
    plugin.openChatView();
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

  async function openToolRequest(toolRequest: ToolRequest) {
    try {
      const plugin = usePlugin();
      const leaf = plugin.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: MERGE_VIEW_TYPE,
        state: {
          chatPath: chat.path,
          toolRequestId: toolRequest.id,
        },
      });
      leaf.setEphemeralState();
      plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
      plugin.app.workspace.requestSaveLayout();
    } catch (error) {
      console.error("Error opening merge view:", error);
      new Notice(`Error: ${error.message}`, 3000);
    }
  }

  async function openFirstPendingToolRequest() {
    const pendingToolRequest = chat.toolRequests.find(
      (tr) => tr.status === "pending",
    );
    if (!pendingToolRequest) {
      new Notice("No pending tool requests found", 3000);
      return;
    }
    await openToolRequest(pendingToolRequest);
  }
</script>

<div
  use:insertCss={chatCss}
  class="min-h-full h-full flex flex-col"
  style="padding: 0 var(--size-4-3) 0;"
>
  <div
    class="sticky top-0 w-full z-10 pb-4 pt-3"
    style="background-color: var(--background-primary)"
  >
    <div class="w-full flex flex-row justify-between items-center">
      <div class="flex flex-row items-center gap-1">
        <select
          class="w-[150px] h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
  </div>

  <div class="flex chat-margin flex-1">
    <div class="flex flex-col w-full flex-1 gap-1 pb-[40px]">
      {#each chat.messages as message}
        <div class={message.role === "user" ? "" : "text text-gray-800"}>
          {#if message.content}
            <div
              class="whitespace-pre-wrap prose leading-none select-text
                          prose-h1:m-0
                          prose-h2:m-0
                          prose-h3:m-0
                          prose-h4:m-0
                          prose-h5:m-0
                          prose-h6:m-0
                          prose-p:m-0
                          prose-blockquote:m-0
                          prose-figure:m-0
                          prose-figcaption:m-0
                          prose-ul:m-0
                          prose-ol:m-0
                          prose-li:m-0
                          prose-table:m-0
                          prose-thead:m-0
                          prose-tbody:m-0
                          prose-dl:m-0
                          prose-dt:m-0
                          prose-dd:m-0
                          prose-hr:my-2
                          prose-pre:m-0
                          prose-code:px-1
                          prose-lead:m-0
                          prose-strong:font-semibold
                          prose-img:m-0
                          prose-video:m-0

                          prose-a:decoration-1 text-foreground max-w-full {message.role ===
              'user'
                ? 'bg-violet-50 rounded p-4'
                : 'py-4'}"
            >
              <Markdown md={message.content} />
            </div>
          {/if}

          {#if message.experimental_attachments && message.experimental_attachments.length > 0}
            <div class="mt-2">
              <div class="flex flex-wrap gap-2">
                {#each message.experimental_attachments as attachment}
                  <button
                    class="clickable-icon gap-1"
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
        <!-- todo display partial tool calls before invocation -->
        {#if message.parts?.some((part) => part.type === "tool-invocation")}
          {#each message.parts as part}
            {#if part.type === "tool-invocation"}
              <div class="rounded border border-gray-200">
                <div
                  class="flex flex-row gap-1 text-xs p-1 text-gray-700 items-center"
                >
                  <WrenchIcon class="size-3" />
                  <div class="flex-1">{part.toolInvocation.toolName}</div>
                  <button
                    type="button"
                    class="clickable-icon"
                    onclick={() =>
                      openToolInvocationInfoModal(chat, part.toolInvocation)}
                    ><InfoIcon class="size-3" /></button
                  >
                </div>
                {#each chat.toolRequests.filter((tr) => tr.toolCallId === part.toolInvocation.toolCallId) as toolRequest}
                  <!-- Handle tool invocations -->
                  <div class="border-t border-gray-200">
                    <ToolRequestRow
                      toolCallId={part.toolInvocation.toolCallId}
                      {toolRequest}
                      onReviewClick={() => openToolRequest(toolRequest)}
                    />
                  </div>
                {/each}
              </div>
            {/if}
          {/each}
        {/if}
      {/each}

      {#if chat.state.type === "retrying"}
        <RetryAlert retryState={chat.state} />
      {/if}
    </div>
  </div>

  <ChatInput
    {chat}
    {handleSubmit}
    {countFilesWithRequests}
    {openFirstPendingToolRequest}
    {view}
    {openFile}
    {getBaseName}
    {submitOnEnter}
    {selectDocument}
    {handleModelChange}
    {getModelAccountOptions}
    bind:submitBtn
    {selectedModelId}
    {selectedAccountId}
  />
</div>

<style>
  .chat-margin {
    width: 100%;
    max-width: var(--file-line-width);
    margin-left: auto;
    margin-right: auto;
  }
</style>
