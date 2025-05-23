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
  import { cn, usePlugin } from "$lib/utils";
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
  import AgentMessage from "./AgentMessage.svelte";
  import type { Agents } from "./agents.svelte.ts";
  import Autoscroll from "./Autoscroll.svelte";

  const plugin = usePlugin();

  type Props = {
    chat: Chat;
    view: ViewContext;
    agents: Agents;
    options: ChatOptions;
  };
  let { chat, view, agents, options }: Props = $props();

  $inspect("Chat path", chat.path);

  let scrollContainer: HTMLElement | null = $state(null);
  let sentinel: HTMLElement | null = $state(null);
  let editIndex: number | null = $state(null);
  let submitBtn: HTMLButtonElement | null = $state(null);
  let selectedAgent = $derived(
    agents.entries.find((c) => c.file.path === options.agentPath),
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

  async function regenerateFromMessage(index: number) {
    const message = chat.messages[index];
    const isUserMessage = message.role === "user";

    // If regenerating a user message, find the next user message (if any)
    let nextUserMessageIndex = -1;
    if (isUserMessage) {
      for (let i = index + 1; i < chat.messages.length; i++) {
        if (chat.messages[i].role === "user") {
          nextUserMessageIndex = i;
          break;
        }
      }
    }

    // Determine where to cut the conversation for regeneration
    const cutIndex = isUserMessage ? index + 1 : index;

    // Keep messages after the next user message (if any)
    const messagesToKeep = nextUserMessageIndex !== -1 
      ? chat.messages.slice(nextUserMessageIndex)
      : [];

    // Truncate the conversation to the point where we want to regenerate
    chat.messages = chat.messages.slice(0, cutIndex);

    // Generate new response
    await chat.runConversation(options);

    // Restore the saved messages (messages after the next user message)
    if (messagesToKeep.length > 0) {
      chat.messages = [...chat.messages, ...messagesToKeep];
    }

    // Save the updated chat
    await chat.save();
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
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const content = formData.get("content")?.toString() ?? "";
    form.reset();
    chat.submit(content, options);
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

<div class="h-full max-h-full grid grid-rows-[auto_minmax(0,1fr)_auto]">
  <!-- header -->
  <div
    class="chat-margin z-10 py-1 px-2"
    style="background-color: var(--background-primary)"
  >
    <div class="w-full flex flex-row justify-between items-center">
      <div class="flex flex-row items-center gap-1">
        <select
          class="w-[150px] h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          bind:value={options.agentPath}
        >
          <option value={undefined}>Select an agent...</option>
          {#each agents.entries as agent}
            <option value={agent.file.path}>{agent.name}</option>
          {/each}
        </select>
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

  <!-- body -->
  <div bind:this={scrollContainer} class="min-h-0 overflow-y-scroll py-2">
    <div class="chat-margin px-2">
      <!-- system message -->
      {#if selectedAgent}
        <AgentMessage agent={selectedAgent} />
      {/if}
      <!-- messages -->
      <div class="flex flex-col w-full flex-1 gap-1">
        {#each chat.messages as message, i}
          <div class="group relative">
            {#if message.content}
              <div
                class={cn(
                  `whitespace-pre-wrap prose leading-none select-text
                prose-pre:bg-(--background-primary-alt) prose-pre:text-(--text-normal)
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
                          prose-a:decoration-1 text-foreground max-w-full`,
                  message.role === "user"
                    ? "bg-(--background-primary-alt) border border-(--background-modifier-border)  rounded p-4"
                    : "py-4",
                )}
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
                      aria-label={message.role === "user"
                        ? "Regenerate assistant response"
                        : "Regenerate this response"}
                      onclick={() => regenerateFromMessage(i)}
                    >
                      <RefreshCwIcon class="size-4" />
                    </button>
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
                <div
                  class="rounded border border-(--background-modifier-border)"
                >
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

    <Autoscroll
      messages={chat.messages}
      container={scrollContainer}
      bind:sentinel
    />
  </div>
  <!--footer-->
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
