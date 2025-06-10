<script lang="ts">
  import { normalizePath, Notice, TFile } from "obsidian";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    ArrowLeft,
    CornerDownLeftIcon,
    FileTextIcon,
    Loader2Icon,
    MicIcon,
    MicOffIcon,
    SettingsIcon,
    StopCircleIcon,
    XIcon,
  } from "lucide-svelte";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Realtime } from "./realtime.svelte.ts";
  import { cn, usePlugin } from "$lib/utils";
  import { onDestroy, tick } from "svelte";
  import { createModal } from "$lib/modals/create-modal.ts";
  import ChatSettingsModal from "./ChatSettingsModal.svelte";
  import type { Chat } from "./chat.svelte.ts";
  import { nanoid } from "nanoid";
  import type { ChatInputState } from "./chat-input-state.svelte.ts";
  import { openPath } from "$lib/utils/obsidian.ts";
  import ChangesList from "./ChangesList.svelte";
  import type { ProposedChange } from "./vault-overlay.svelte.ts";

  type Props = {
    chat: Chat;
    attachments: {
      id: string;
      path: string;
    }[];
    handleSubmit: (e) => void;
    openMergeView: (change: ProposedChange) => Promise<void>;
    view: any;
    submitOnEnter: (event: KeyboardEvent) => void;
    handleModelChange: (event: Event) => void;
    getModelAccountOptions: () => any[];
    editState: {
      index: number;
      content: string;
      originalContent: string;
    } | null;
    cancelEdit: () => void;
    submitEdit: (content: string) => void;
    submitBtn?: HTMLButtonElement;
    inputState: ChatInputState;
  };
  let {
    chat,
    attachments = $bindable(),
    handleSubmit,
    openMergeView,
    view,
    submitOnEnter,
    handleModelChange,
    getModelAccountOptions,
    editState = null,
    cancelEdit = () => {},
    submitEdit = () => {},
    submitBtn = $bindable(),
    inputState,
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

  let textareaRef: HTMLTextAreaElement | null = null;

  // Set text to edit content when edit mode starts
  $effect(() => {
    if (editState) {
      console.log("editState", editState);
      inputState.text = editState.content;
      // Focus the textarea and set cursor to end after setting the text
      setTimeout(() => {
        if (textareaRef) {
          textareaRef.focus();
          // Set cursor to end of text
          const length = textareaRef.value.length;
          textareaRef.setSelectionRange(length, length);
        }
      }, 0);
    }
  });

  onDestroy(() => {
    if (realtime.state === "open") {
      realtime.stopSession();
    }
  });

  function selectDocument() {
    const plugin = usePlugin();
    plugin.openFileSelect((file) => {
      addAttachment(file);
    });
  }

  function addAttachment(file: TFile) {
    attachments.push({
      id: nanoid(),
      path: file.path,
    });
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
    if (!editState) return;

    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const content = formData.get("content")?.toString() ?? "";

    if (content.trim()) {
      submitEdit(content);
      form.reset();
      inputState.reset();
    }
  }

  function handleEditCancel() {
    cancelEdit();
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

  function removeAttachment(attachmentId: string) {
    const index = attachments.findIndex((a) => a.id === attachmentId);
    if (index !== -1) {
      attachments.splice(index, 1);
    }
  }
</script>

<div class={cn("chat-margin py-2 px-2", view.position === "right" && "pb-8")}>
  <form
    name="input"
    style="background-color: var(--background-primary)"
    onsubmit={editState ? handleEditSubmit : handleSubmit}
  >
    {#if chat.state.type === "loading"}
      <div class="flex items-center gap-2 mb-3 text-sm text-(--text-accent)">
        <Loader2Icon class="size-4 animate-spin" />
        <span>Assistant is thinking...</span>
      </div>
    {/if}

    {#if attachments.length > 0}
      <div class="flex flex-wrap gap-2 mb-2">
        {#each attachments as attachment}
          <button
            type="button"
            onclick={() => openPath(normalizePath(attachment.path))}
            class="clickable-icon items-center gap-1"
          >
            <FileTextIcon class="size-3.5" />
            <span class="max-w-[200px] truncate">
              {attachment.path.split("/").pop()}
            </span>
            <span
              role="button"
              tabindex="0"
              aria-label="Remove attachment"
              onkeydown={(event) => {
                if (event.key === "Enter") {
                  removeAttachment(attachment.id);
                }
              }}
              class="flex items-center"
              onclick={(event) => {
                event.stopPropagation();
                removeAttachment(attachment.id);
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
      placeholder="How can I assist you today?"
      aria-label="Chat message input"
      onkeypress={submitOnEnter}
      maxRows={10}
      bind:ref={textareaRef}
    />
    <div class="flex items-center justify-between mt-2">
      <div class="flex flex-row align-middle gap-2">
        <!--        <Button size="sm" type="button" onclick={handleTranscribeClick}>-->
        <!--          {#if realtime.state === "closed"}-->
        <!--            <MicIcon class="size-4" />-->
        <!--          {:else if realtime.state === "open"}-->
        <!--            <MicOffIcon class="size-4" />-->
        <!--          {:else if realtime.state === "connecting"}-->
        <!--            <Loader2Icon class="size-4 animate-spin" />-->
        <!--          {/if}-->
        <!--        </Button>-->
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="gap-1.5 rounded"
          aria-label="Select document"
          onclick={selectDocument}
        >
          <FileTextIcon class="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="gap-1.5 rounded"
          aria-label="Open settings"
          onclick={handleSettingsClick}
        >
          <SettingsIcon class="size-3.5" />
        </Button>

        <!-- model select -->
        <select
          onchange={handleModelChange}
          name="model-account"
          aria-label="Select AI model"
          class="w-[250px] h-9 rounded-md px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          required
        >
          <option value=""> Select model </option>
          {#each getModelAccountOptions() as option}
            <option
              value={option.value}
              selected={option.value ===
                `${chat.options.modelId}:${chat.options.accountId}`}
            >
              {option.label}
            </option>
          {/each}
        </select>
      </div>
      {#if editState}
        <div class="flex gap-2">
          <Button
            type="button"
            size="sm"
            class="gap-1.5 rounded"
            aria-label="Cancel editing"
            onclick={handleEditCancel}
          >
            <StopCircleIcon class="size-3.5" />
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            class="gap-1.5 rounded"
            aria-label="Save edited message"
            bind:ref={submitBtn}
          >
            Save
            <CornerDownLeftIcon class="size-3.5" />
          </Button>
        </div>
      {:else if chat.state.type === "idle"}
        <Button
          type="submit"
          size="sm"
          class="gap-1.5 rounded"
          aria-label="Send message"
          bind:ref={submitBtn}
        >
          Send
          <CornerDownLeftIcon class="size-3.5" />
        </Button>
      {:else}
        <Button
          type="button"
          size="sm"
          class="gap-1.5 rounded"
          aria-label="Cancel"
          onclick={() => chat.cancel()}
        >
          <StopCircleIcon class="size-3.5" />
          Cancel
        </Button>
      {/if}
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
