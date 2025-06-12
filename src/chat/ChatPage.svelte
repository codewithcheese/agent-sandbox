<script lang="ts">
  import { EyeIcon, SquarePenIcon } from "lucide-svelte";
  import type { Chat } from "./chat.svelte.ts";
  import { usePlugin } from "$lib/utils";
  import { onDestroy } from "svelte";
  import RetryAlert from "./RetryAlert.svelte";
  import { Notice } from "obsidian";
  import { type ViewContext } from "$lib/obsidian/view.ts";
  import { MERGE_VIEW_TYPE } from "$lib/merge/merge-view.svelte.ts";
  import ChatInput from "./ChatInput.svelte";
  import type { Agents } from "./agents.svelte.ts";
  import Autoscroll from "./Autoscroll.svelte";
  import type { ProposedChange } from "./vault-overlay.svelte.ts";
  import AgentMessage from "./AgentMessage.svelte";
  import { createDebug } from "$lib/debug.ts";
  import { ChatView } from "./chat-view.svelte.ts";
  import type { ChatInputState } from "./chat-input-state.svelte.ts";
  import Message from "./Message.svelte";
  import { openPath } from "$lib/utils/obsidian.ts";

  const debug = createDebug();

  const plugin = usePlugin();

  type Props = {
    chat: Chat;
    view: ViewContext;
    agents: Agents;
    inputState: ChatInputState;
  };
  let { chat, view, agents, inputState }: Props = $props();

  $inspect("ChatPage", chat.path);

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
    <div class="select-text flex flex-col gap-2 p-4">
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
              onclick={() => openPath(selectedAgent.file.path)}
            >
              <EyeIcon class="size-4" />
            </button>
          {/if}
        </div>

        <button
          type="button"
          class="gap-1.5 rounded"
          onclick={() => ChatView.newChat(undefined, chat.options)}
        >
          <SquarePenIcon class="size-3.5" />
          New Chat
        </button>
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
          {#each chat.messages as message, index}
            <Message
              {chat}
              {message}
              {index}
              {editState}
              {regenerateFromMessage}
              {startEdit}
            />
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
    <!--footer-->
    <ChatInput
      {attachments}
      bind:submitBtn
      {cancelEdit}
      {chat}
      {editState}
      {handleSubmit}
      {inputState}
      {openMergeView}
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
