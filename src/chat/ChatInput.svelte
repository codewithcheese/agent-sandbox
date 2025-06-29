<script lang="ts">
  import { normalizePath, Notice, TFile } from "obsidian";
  import {
    CornerDownLeftIcon,
    FileTextIcon,
    Loader2Icon,
    SendIcon,
    SettingsIcon,
    StopCircleIcon,
    XIcon,
  } from "lucide-svelte";
  import Textarea from "./Textarea.svelte";
  import { Realtime } from "./realtime.svelte.ts";
  import { cn, usePlugin } from "$lib/utils";
  import { onDestroy, tick, untrack } from "svelte";
  import { createModal } from "$lib/modals/create-modal.ts";
  import ChatSettingsModal from "./ChatSettingsModal.svelte";
  import type { Chat } from "./chat.svelte.ts";
  import type { ChatInputState } from "./chat-input-state.svelte.ts";
  import { openPath } from "$lib/utils/obsidian.ts";
  import ChangesList from "./ChangesList.svelte";
  import type { ProposedChange } from "./vault-overlay.svelte.ts";
  import TodoList from "./TodoList.svelte";
  import ModelSelector from "./ModelSelector.svelte";
  import {
    detectBacklinkTrigger,
    insertBacklink,
    expandBacklinks,
  } from "$lib/utils/backlinks";
  import { BacklinkFileSelectModal } from "$lib/modals/backlink-file-select-modal";
  import { FileSelectModal } from "$lib/modals/file-select-modal.ts";
  import {
    detectSlashTrigger,
    removeSlashTrigger,
  } from "$lib/utils/slash-commands";
  import { PromptFileSelectModal } from "$lib/modals/prompt-file-select-modal";
  import { loadPromptMessage } from "../editor/prompt-command.ts";
  import { getTextFromParts } from "$lib/utils/ai.ts";

  type Props = {
    chat: Chat;
    openMergeView: (change: ProposedChange) => Promise<void>;
    view: any;
    submitBtn?: HTMLButtonElement;
    inputState: ChatInputState;
  };
  let {
    chat,
    openMergeView,
    view,
    submitBtn = $bindable(),
    inputState = $bindable(),
  }: Props = $props();

  let realtime = new Realtime();

  realtime.emitter.onAny((event, data) => {
    console.log("realtime event", event, data);
    if (event === "delta") {
      inputState.text += data;
    } else if (event === "final") {
      inputState.text += " ";
    } else if (event === "error") {
      new Notice("Transcription error: " + String(data));
      realtime.stopSession();
    }
  });

  let textareaRef: HTMLTextAreaElement | null = $state(null);

  // Extract chat title from path (remove .chat extension)
  const title = $derived.by(() => {
    if (!chat.path) return "Chat";
    const fileName = chat.path.split("/").pop() || chat.path;
    return fileName.endsWith(".chat") ? fileName.slice(0, -5) : fileName;
  });

  $effect(() => {
    if (inputState.state.type === "editing") {
      untrack(async () => {
        await tick();
        textareaRef?.focus();
        textareaRef?.setSelectionRange(
          textareaRef.value.length,
          textareaRef.value.length,
        );
      });
    }
  });

  onDestroy(() => {
    if (realtime.state === "open") {
      realtime.stopSession();
    }
  });

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

    const transformedText = expandBacklinks(inputState.text);

    chat.submit(transformedText, $state.snapshot(inputState.attachments));
    inputState.reset();
  }

  function selectDocument() {
    const { app } = usePlugin();
    const modal = new FileSelectModal(app, (file) => {
      addAttachment(file);
    });
    modal.open();
  }

  function addAttachment(file: TFile) {
    inputState.attachments.push(normalizePath(file.path));
  }

  function handleTranscribeClick() {
    // https://platform.openai.com/docs/guides/realtime-transcription
    if (realtime.state === "closed") {
      const plugin = usePlugin();
      const account = plugin.settings.accounts.find(
        (account) => account.provider === "openai",
      );
      if (!account) {
        new Notification("OpenAI API key not found. Update your settings.");
        return;
      }
      realtime.startSession(account.config.apiKey);
    } else {
      realtime.stopSession();
    }
  }

  function handleEditSubmit(event) {
    event.preventDefault();
    if (inputState.state.type !== "editing") {
      return new Notice("Invalid edit submit. Not in edit mode.");
    }
    if (inputState.text.trim() || inputState.attachments.length > 0) {
      const transformedText = expandBacklinks(inputState.text.trim());

      chat.edit(
        inputState.state.index,
        transformedText,
        $state.snapshot(inputState.attachments),
      );
      inputState.reset();
    } else {
      new Notice("Cannot submit empty message");
    }
  }

  function handleEditCancel() {
    inputState.reset();
  }

  function handleSettingsClick() {
    const modal = createModal(ChatSettingsModal, {
      settings: chat.options,
      onClose: () => modal.close(),
      onSave: (newSettings: any) => {
        chat.updateOptions(newSettings);
        modal.close();
      },
    });
    modal.open();
  }

  function removeAttachment(path: string) {
    const index = inputState.attachments.findIndex((a) => a === path);
    if (index !== -1) {
      inputState.attachments.splice(index, 1);
    }
  }

  function handleModelChange(modelId: string, accountId: string) {
    chat.options.modelId = modelId;
    chat.options.accountId = accountId;
    chat.save();
  }

  function handleTextareaInput(event: Event) {
    const inputEvent = event as InputEvent;
    const textarea = event.target as HTMLTextAreaElement;
    const { value, selectionStart } = textarea;

    // Only trigger modals on manual typing, not deletion or paste
    if (
      inputEvent.inputType === "insertText" ||
      inputEvent.inputType === "insertCompositionText"
    ) {
      // Check for backlink trigger
      if (detectBacklinkTrigger(value, selectionStart)) {
        openBacklinkModal(selectionStart);
      }

      // Check for slash command trigger
      if (detectSlashTrigger(value, selectionStart)) {
        openSlashCommandModal(selectionStart);
      }
    }
  }

  function openBacklinkModal(cursorPos: number) {
    const plugin = usePlugin();
    const modal = new BacklinkFileSelectModal(plugin.app, (fileName) => {
      completeBacklink(cursorPos, fileName);
    });
    modal.open();
  }

  function completeBacklink(cursorPos: number, fileName: string) {
    const { newText, newCursorPos } = insertBacklink(
      inputState.text,
      cursorPos,
      fileName,
    );

    inputState.text = newText;

    // Set cursor position after the completed backlink
    setTimeout(() => {
      if (textareaRef) {
        textareaRef.focus();
        textareaRef.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }

  function openSlashCommandModal(cursorPos: number) {
    const plugin = usePlugin();
    const modal = new PromptFileSelectModal(plugin.app, (file) => {
      insertPrompt(cursorPos, file);
    });
    modal.open();
  }

  async function insertPrompt(cursorPos: number, file: TFile) {
    // Remove the slash trigger
    const { newText } = removeSlashTrigger(inputState.text, cursorPos);
    inputState.text = newText;

    // Load the prompt message to get the content and metadata
    const promptMessage = await loadPromptMessage(file);

    // Extract the prompt metadata
    const promptMetadata = promptMessage.metadata;

    // If we're editing a message, update it and submit
    if (inputState.state.type === "editing") {
      await chat.edit(
        inputState.state.index,
        getTextFromParts(promptMessage.parts),
        inputState.attachments,
        promptMetadata,
      );
      inputState.reset();
    } else {
      // For new messages, submit the prompt directly
      await chat.submit(
        getTextFromParts(promptMessage.parts),
        inputState.attachments,
        promptMetadata,
      );
      inputState.reset();
    }
  }
</script>

<div class={cn("chat-margin py-1 px-2")}>
  {#if chat.state.type === "loading"}
    <div class="flex items-center gap-2 mb-3 text-sm text-(--text-accent)">
      <Loader2Icon class="size-4 animate-spin" />
      <span>Assistant is thinking...</span>
    </div>
  {/if}

  <!--session widgets-->
  <TodoList {chat} />

  <form
    name="input"
    style="background-color: var(--background-primary)"
    onsubmit={inputState.state.type === "editing"
      ? handleEditSubmit
      : handleSubmit}
  >
    {#if inputState.attachments.length > 0}
      <div class="flex flex-wrap gap-2 mb-2">
        {#each inputState.attachments as attachment}
          <button
            type="button"
            onclick={() => openPath(attachment)}
            class="clickable-icon items-center gap-1"
          >
            <FileTextIcon class="size-3.5" />
            <span class="max-w-[200px] truncate">
              {attachment.split("/").pop()}
            </span>
            <span
              role="button"
              tabindex="0"
              aria-label="Remove attachment"
              onkeydown={(event) => {
                if (event.key === "Enter") {
                  removeAttachment(attachment);
                }
              }}
              class="flex items-center"
              onclick={(event) => {
                event.stopPropagation();
                removeAttachment(attachment);
              }}
            >
              <XIcon class="size-3.5" />
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <ChangesList {chat} {openMergeView} />

    <Textarea
      bind:value={inputState.text}
      name="content"
      placeholder="Whats on your mind? [[ to link notes, / to insert prompt."
      aria-label="Chat message input"
      onkeypress={submitOnEnter}
      oninput={handleTextareaInput}
      maxRows={10}
      required
      bind:ref={textareaRef}
      {title}
    />
    <div class="flex flex-wrap items-center justify-between gap-2 mt-2">
      <div class="flex flex-row align-middle gap-1">
        <!--        <Button size="sm" type="button" onclick={handleTranscribeClick}>-->
        <!--          {#if realtime.state === "closed"}-->
        <!--            <MicIcon class="size-4" />-->
        <!--          {:else if realtime.state === "open"}-->
        <!--            <MicOffIcon class="size-4" />-->
        <!--          {:else if realtime.state === "connecting"}-->
        <!--            <Loader2Icon class="size-4 animate-spin" />-->
        <!--          {/if}-->
        <!--        </Button>-->
        <button
          type="button"
          class="gap-1.5 rounded"
          aria-label="Select document"
          onclick={selectDocument}
        >
          <FileTextIcon class="size-3.5" />
        </button>
        <button
          type="button"
          class="gap-1.5 rounded"
          aria-label="Open settings"
          onclick={handleSettingsClick}
        >
          <SettingsIcon class="size-3.5" />
        </button>

        <!-- model select -->
        <ModelSelector
          selectedModelId={chat.options.modelId}
          selectedAccountId={chat.options.accountId}
          onModelChange={handleModelChange}
        />
      </div>
      {#if inputState.state.type === "editing"}
        <div class="flex gap-2">
          <button
            type="button"
            class="gap-1.5 rounded"
            aria-label="Cancel editing"
            onclick={handleEditCancel}
          >
            <StopCircleIcon class="size-3.5" />
            Cancel
          </button>
          <button
            type="submit"
            class="gap-1.5 rounded"
            aria-label="Save edited message"
            bind:this={submitBtn}
          >
            Save
            <SendIcon class="size-3.5" />
          </button>
        </div>
      {:else if chat.state.type === "idle"}
        <button
          type="submit"
          class="gap-1.5 rounded"
          aria-label="Send message"
          bind:this={submitBtn}
        >
          Send
          <SendIcon class="size-3.5" />
        </button>
      {:else}
        <button
          type="button"
          class="gap-1.5 rounded"
          aria-label="Cancel"
          onclick={() => chat.cancel()}
        >
          <StopCircleIcon class="size-3.5" />
          Cancel
        </button>
      {/if}
    </div>

    <!-- Key Settings Display -->
    <div
      class={cn(
        "flex items-center justify-between mt-2 text-xs text-(--text-muted)",
        view.position === "right" && "h-6",
      )}
    >
      <div class="flex items-center gap-2">
        <span>Temperature: {chat.options.temperature}</span>
        <span>Max Tokens: {chat.options.maxTokens}</span>
        {#if chat.options.thinkingEnabled}
          <span>Thinking: {chat.options.thinkingTokensBudget} tokens</span>
        {/if}
      </div>
    </div>
  </form>
</div>

<style>
  .chat-margin {
    width: 100%;
    max-width: var(--file-line-width);
    margin-left: auto;
    margin-right: auto;
  }
</style>
