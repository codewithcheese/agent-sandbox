<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    FileTextIcon,
    InfoIcon,
    PlusIcon,
    RefreshCwIcon,
    PencilIcon,
    EyeIcon,
    FileUpIcon,
    FileSymlinkIcon,
  } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import { cn, usePlugin } from "$lib/utils";
  import { onDestroy, onMount } from "svelte";
  import Markdown from "./Markdown.svelte";
  import RetryAlert from "./RetryAlert.svelte";
  import type { AIAccount, AIProviderId } from "../settings/providers.ts";
  import { normalizePath, Notice, TFile } from "obsidian";
  import { type ViewContext } from "$lib/obsidian/view.ts";
  import { MERGE_VIEW_TYPE } from "$lib/merge/merge-view.svelte.ts";
  import { openToolInvocationInfoModal } from "$lib/modals/tool-invocation-info-modal.ts";
  import ChatInput from "./ChatInput.svelte";
  import type { Agents } from "./agents.svelte.ts";
  import Autoscroll from "./Autoscroll.svelte";
  import type { ProposedChange } from "./vault-overlay.svelte.ts";
  import AgentMessage from "./AgentMessage.svelte";
  import { createDebug } from "$lib/debug.ts";
  import TodoList from "./TodoList.svelte";
  import { ChatView } from "./chat-view.svelte.ts";
  import type { ChatInputState } from "./chat-input-state.svelte.ts";
  import { loadPromptMessage } from "../markdown/prompt-command.ts";
  import is from "@sindresorhus/is";

  const debug = createDebug();

  const plugin = usePlugin();

  type Props = {
    chat: Chat;
    view: ViewContext;
    agents: Agents;
    inputState: ChatInputState;
  };
  let { chat, view, agents, inputState }: Props = $props();

  $inspect("ChatPage", chat.path, chat.messages);

  let scrollContainer = $state<HTMLElement | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let attachments = $state<{ id: string; path: string }[]>([]);
  let editState = $state<{
    index: number;
    content: string;
    originalContent: string;
  } | null>(null);
  let submitBtn = $state<HTMLButtonElement | null>(null);
  let selectedAgent = $derived(
    agents.entries.find((c) => c.file.path === chat.options.agentPath),
  );

  onDestroy(() => {
    chat.cancel();
  });

  // todo: move to chat
  async function regenerateFromMessage(index: number) {
    const message = chat.messages[index];
    const isUserMessage = message.role === "user";
    if (!isUserMessage) {
      new Notice("Regenerate response is only available from user messages");
      return;
    }

    // Truncate the conversation to the point where we want to regenerate
    chat.messages = chat.messages.slice(0, index + 1);

    revertVault(index);

    // Generate new response
    await chat.runConversation();

    // Save the updated chat
    await chat.save();
  }

  async function updatePrompt(i: number) {
    const message = chat.messages[i];
    if (!("metadata" in message && (message.metadata as any).prompt.path)) {
      return new Notice("Message not associated with a prompt");
    }
    const file = plugin.app.vault.getAbstractFileByPath(
      (message.metadata as any).prompt.path,
    );
    chat.messages[i] = await loadPromptMessage(file);
  }

  function submitOnEnter(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitBtn!.click();
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!chat.options.modelId || !chat.options.accountId) {
      new Notice("Please select a model before submitting", 3000);
      return;
    }
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const content = formData.get("content")?.toString() ?? "";
    form.reset();
    chat.submit(content, $state.snapshot(attachments));
    attachments = [];
  }

  function handleModelChange(
    e: Event & {
      currentTarget: EventTarget & HTMLSelectElement;
    },
  ) {
    const [modelId, accountId] = e.currentTarget.value.split(":");
    chat.options.modelId = modelId;
    chat.options.accountId = accountId;
    chat.save();
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

  async function openMergeView(change: ProposedChange) {
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
          path: change.path,
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

  async function openFirstChange() {
    const firstChange = chat.vault.changes[0];
    if (!firstChange) {
      new Notice("No pending changes found", 3000);
      return;
    }
    await openMergeView(firstChange);
  }

  function startEdit(index: number) {
    const message = chat.messages[index];
    editState = {
      index,
      content: message.content,
      originalContent: message.content,
    };
  }

  function cancelEdit() {
    editState = null;
  }

  function submitEdit(content: string) {
    if (!editState) return;

    const { index } = editState;

    // Update the message content
    updateMessageText({ index, content });

    // Remove all messages after the edited one
    chat.messages = chat.messages.slice(0, index + 1);

    revertVault(index);

    // Clear edit state
    editState = null;

    // Regenerate the assistant response from this point
    regenerateFromMessage(index);
  }

  function revertVault(from: number) {
    // Revert vault changes
    const userMessage = chat.messages[from];
    console.log("userMessage", userMessage);
    // @ts-expect-error metadata not typed
    const checkpoint = userMessage.metadata?.checkpoint;
    console.log("checkpoint", checkpoint);
    if (checkpoint) {
      chat.vault.revert(checkpoint);
    }
  }

  function updateMessageText({
    index,
    content,
  }: {
    index: number;
    content: string;
  }) {
    chat.messages[index].content = content;
    chat.messages[index].parts = chat.messages[index].parts.filter(
      (p) => p.type !== "text",
    );
    chat.messages[index].parts.push({
      type: "text",
      text: content,
    });
  }
</script>

<svelte:boundary onerror={(e) => console.error("ChatPage error:", e)}>
  {#snippet failed(error, reset)}
    <div class="flex flex-col gap-2 p-4">
      <div>An error occurred: {error}</div>
      <button onclick={reset}>Try again</button>
    </div>
  {/snippet}
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
            bind:value={chat.options.agentPath}
          >
            <option value={undefined}>Select an agent...</option>
            {#each agents.entries as agent}
              <option value={agent.file.path}>{agent.name}</option>
            {/each}
          </select>
          {#if selectedAgent}
            <button
              class="clickable-icon"
              aria-label="Open agent note"
              onclick={() => openFile(selectedAgent.file.path)}
            >
              <EyeIcon class="size-4" />
            </button>
          {/if}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="gap-1.5 rounded"
          onclick={() => ChatView.newChat(undefined, chat.options)}
        >
          New Chat
          <PlusIcon class="size-3.5" />
        </Button>
      </div>
    </div>

    <!-- body -->
    <div bind:this={scrollContainer} class="min-h-0 overflow-y-auto py-2">
      <div class="chat-margin px-2">
        <!-- system message -->
        {#if selectedAgent}
          <AgentMessage agent={selectedAgent} />
        {/if}
        <!-- messages -->
        <div class="flex flex-col w-full flex-1 gap-1">
          {#each chat.messages as message, i}
            {#if editState && i > editState.index}
              <!-- Hide messages below the one being edited -->
            {:else if editState && editState.index === i}
              <!-- Show greyed out message being edited -->
              <div class="group relative opacity-50">
                <div
                  class={cn(
                    `prose select-text leading-8
                prose-pre:bg-(--background-primary-alt) prose-pre:text-(--text-normal)
                          prose-h1:m-0
                          prose-h2:m-0
                          prose-h3:m-0
                          prose-h4:m-0
                          prose-h5:m-0
                          prose-h6:m-0
                          prose-p:m-1
                          prose-blockquote:m-0
                          prose-figure:m-0
                          prose-figcaption:m-0
                          prose-ul:m-0
                          prose-ol:m-1
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
                      : "py-3",
                  )}
                >
                  <div
                    class="flex items-center gap-2 mb-2 text-sm text-(--text-accent)"
                  >
                    <PencilIcon class="size-4" />
                    <span>Editing...</span>
                  </div>
                  <Markdown md={message.content} />
                </div>
              </div>
            {:else}
              <!-- Normal message display -->
              <div class="group relative">
                <!-- prompt badge -->
                {#if message.role === "user" && "metadata" in message && is.object(message.metadata) && "prompt" in message.metadata}
                  <div
                    class="absolute top-0 left-0 text-xs text-(--text-accent)"
                  >
                    <button
                      class="clickable-icon"
                      onclick={() => {
                        //@ts-expect-error metadata.prompt not typed
                        openFile(message.metadata.prompt.path);
                      }}>Prompt</button
                    >
                  </div>
                {/if}
                <!-- message buttons -->
                <div
                  class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-(--background-primary) rounded"
                >
                  {#if message.role === "user"}
                    {#if "metadata" in message && typeof message.metadata === "object" && "prompt" in message.metadata}
                      <!-- prompt buttons -->
                      <button
                        class="clickable-icon"
                        aria-label="Sync from note"
                        onclick={() => updatePrompt(i)}
                      >
                        <FileSymlinkIcon class="size-4" />
                      </button>
                      <button
                        class="clickable-icon"
                        aria-label={message.role === "user"
                          ? "Regenerate assistant response"
                          : "Regenerate this response"}
                        onclick={() => regenerateFromMessage(i)}
                      >
                        <RefreshCwIcon class="size-4" />
                      </button>
                    {:else}
                      <!-- user message buttons -->
                      <button
                        class="clickable-icon"
                        aria-label="Edit message"
                        onclick={() => startEdit(i)}
                      >
                        <PencilIcon class="size-4" />
                      </button>
                      <button
                        class="clickable-icon"
                        aria-label={message.role === "user"
                          ? "Regenerate assistant response"
                          : "Regenerate this response"}
                        onclick={() => regenerateFromMessage(i)}
                      >
                        <RefreshCwIcon class="size-4" />
                      </button>
                    {/if}
                    <!--              <button class="clickable-icon" onclick={() => deleteMessage(i)}>-->
                    <!--                <Trash2Icon class="size-4" />-->
                    <!--              </button>-->
                  {/if}
                </div>
                {#if message.parts.some((p) => p.type === "text" || p.type === "reasoning")}
                  <div
                    class={cn(
                      `prose select-text leading-8
                  prose-pre:bg-(--background-primary-alt) prose-pre:text-(--text-normal)
                            prose-h1:m-0
                            prose-h2:m-0
                            prose-h3:m-0
                            prose-h4:m-0
                            prose-h5:m-0
                            prose-h6:m-0
                            prose-p:m-1
                            prose-blockquote:m-0
                            prose-figure:m-0
                            prose-figcaption:m-0
                            prose-ul:m-0
                            prose-ol:m-1
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
                        : "py-3",
                    )}
                  >
                    <!-- thinking content -->
                    {#if message.role === "assistant" && message.parts?.some((part) => part.type === "reasoning")}
                      <div class="py-1 text-sm text-(--text-muted)">
                        {message.parts
                          .filter((part) => part.type === "reasoning")
                          .flatMap((part) => part.reasoning)
                          .join("\n")}
                      </div>
                    {/if}
                    <Markdown md={message.content} />
                  </div>
                {/if}
                {#if message.experimental_attachments && message.experimental_attachments.length > 0}
                  <div class="mt-2">
                    <div class="flex flex-wrap gap-2">
                      {#each message.experimental_attachments as attachment}
                        <button
                          class="clickable-icon gap-1"
                          aria-label="Open attachment"
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
                        <span>
                          {#if part.toolInvocation.state === "result"}🟢{:else}🟡{/if}
                        </span>
                        <div class="flex-1">{part.toolInvocation.toolName}</div>
                        <button
                          type="button"
                          class="clickable-icon"
                          aria-label="Open tool invocation info"
                          onclick={() =>
                            openToolInvocationInfoModal(
                              chat,
                              part.toolInvocation,
                            )}
                        >
                          <InfoIcon class="size-3" />
                        </button>
                      </div>
                      <!-- fixme: new method for displaying changes made-->
                    </div>
                  {/if}
                {/each}
              {/if}
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
        enabled={chat.state.type === "loading"}
        bind:sentinel
      />
    </div>
    <!--session widgets-->
    <TodoList {chat} />

    <!--footer-->
    <ChatInput
      {attachments}
      bind:submitBtn
      {cancelEdit}
      {chat}
      {editState}
      {getBaseName}
      {getModelAccountOptions}
      {handleModelChange}
      {handleSubmit}
      {inputState}
      {openFile}
      {openFirstChange}
      {submitEdit}
      {submitOnEnter}
      {view}
    />
  </div>
</svelte:boundary>

<style>
  .chat-margin {
    width: 100%;
    max-width: var(--file-line-width);
    margin-left: auto;
    margin-right: auto;
  }
</style>
