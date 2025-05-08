<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    FileTextIcon,
    InfoIcon,
    PlusIcon,
    RefreshCwIcon,
    WrenchIcon,
    Trash2Icon,
    PencilIcon,
  } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import { usePlugin } from "$lib/utils";
  import { onDestroy } from "svelte";
  import Markdown from "$lib/components/Markdown.svelte";
  import RetryAlert from "$lib/components/RetryAlert.svelte";
  import type { AIAccount, AIProviderId } from "../settings/providers.ts";
  import { normalizePath, Notice } from "obsidian";
  import ToolRequestRow from "./ToolRequestRow.svelte";
  import { type ViewContext } from "$lib/obsidian/view.ts";
  import { MERGE_VIEW_TYPE } from "$lib/merge/merge-view.ts";
  import { openToolInvocationInfoModal } from "$lib/modals/tool-invocation-info-modal.ts";
  import type { ToolRequest } from "../tools/tool-request.ts";
  import ChatInput from "./ChatInput.svelte";
  import { ChatOptions } from "./options.svelte.ts";
  import SystemMessage from "./SystemMessage.svelte";
  import type { Agents } from "./agents.svelte.ts";

  const plugin = usePlugin();

  let {
    chat,
    view,
    agents,
  }: { chat: Chat; view: ViewContext; agents: Agents } = $props();

  let options = new ChatOptions();
  let editIndex: number | null = $state(null);
  let submitBtn: HTMLButtonElement | null = $state(null);
  let selectedAgent = $derived(
    agents.entries.find((c) => c.file.path === options.chatbotPath),
  );

  let countFilesWithRequests = $derived(
    new Set(
      chat.toolRequests
        .filter((r) => r.status === "pending")
        .map((r) => r.path),
    ).size,
  );

  onDestroy(() => {
    chat.cancel();
    options.cleanup();
  });

  function deleteMessage(index: number) {
    chat.messages = chat.messages.filter((_, i) => i !== index);
  }

  function submitOnEnter(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitBtn!.click();
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!options.modelId || !options.accountId) {
      return;
    }
    chat.submit(e, options);
  }

  function handleModelChange(
    e: Event & {
      currentTarget: EventTarget & HTMLSelectElement;
    },
  ) {
    const [modelId, accountId] = e.currentTarget.value.split(":");
    options.modelId = modelId;
    options.accountId = accountId;
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
      let leaf = plugin.app.workspace.getLeavesOfType(MERGE_VIEW_TYPE)[0];
      if (!leaf) {
        leaf = plugin.app.workspace.getLeaf(true);
      }
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
          bind:value={options.chatbotPath}
        >
          <option value={undefined}>Select an agent...</option>
          {#each agents.entries as agent}
            <option value={agent.file.path}>{agent.name}</option>
          {/each}
        </select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="gap-1.5 rounded"
          onclick={() => agents.refresh()}
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

  {#if selectedAgent}
    <SystemMessage agent={selectedAgent} />
  {/if}

  <div class="flex chat-margin flex-1">
    <div class="flex flex-col w-full flex-1 gap-1 pb-[40px]">
      {#each chat.messages as message, i}
        <div class="group relative">
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
                          [body.theme-dark_&]:prose-invert
                          prose-a:decoration-1 text-foreground max-w-full {message.role ===
              'user'
                ? 'bg-(--background-primary-alt) border border-(--background-modifier-border)  rounded p-4'
                : 'py-4'}"
            >
              {#if editIndex === i}
                <div class="mt-2 flex gap-2">
                  <textarea
                    class="flex-1 rounded border p-2 text-md"
                    bind:value={message.content}
                  ></textarea>
                  <button
                    class="clickable-icon"
                    onclick={() => (editIndex = null)}
                  >
                    Save
                  </button>
                </div>
              {:else}
                <Markdown md={message.content} />
                <div
                  class="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1"
                >
                  {#if message.role === "user"}
                    <button
                      class="clickable-icon"
                      onclick={() => (editIndex = i)}
                    >
                      <PencilIcon class="size-4" />
                    </button>
                  {/if}
                  <button
                    class="clickable-icon"
                    onclick={() => deleteMessage(i)}
                  >
                    <Trash2Icon class="size-4" />
                  </button>
                </div>
              {/if}
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
              <div class="rounded border border-(--background-modifier-border)">
                <div class="flex flex-row gap-1 text-xs p-1 items-center">
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
                  <div class="border-t border-(--background-modifier-border)">
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
    {options}
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
