<script lang="ts">
  import { normalizePath, Notice } from "obsidian";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    ArrowLeft,
    CornerDownLeftIcon,
    FileTextIcon,
    Loader2Icon,
    MicIcon,
    MicOffIcon,
    StopCircleIcon,
    XIcon,
  } from "lucide-svelte";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Realtime } from "./realtime.svelte.ts";
  import { cn, usePlugin } from "$lib/utils";
  import { onDestroy } from "svelte";

  let realtime = new Realtime();

  realtime.emitter.onAny((event, data) => {
    console.log("realtime event", event, data);
    if (event === "delta") {
      text += data;
    } else if (event === "final") {
      text += " ";
    } else if (event === "error") {
      new Notice("Transcription error: " + String(data));
      realtime.stopSession();
    }
  });

  let text = $state<string>("");

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

  let {
    chat,
    handleSubmit,
    openFirstChange,
    view,
    openFile,
    getBaseName,
    submitOnEnter,
    selectDocument,
    handleModelChange,
    getModelAccountOptions,
    submitBtn = $bindable(),
    options,
    changes,
  } = $props();

  const countChanges = $derived(
    changes.filter((c) => c.status !== "identical").length,
  );

  onDestroy(() => {
    if (realtime.state === "open") {
      realtime.stopSession();
    }
  });
</script>

<div class={cn("chat-margin py-2 px-2", view.position === "right" && "pb-8")}>
  <form
    name="input"
    style="background-color: var(--background-primary)"
    onsubmit={handleSubmit}
  >
    {#if countChanges}
      <div
        class="w-full flex items-center gap-2 px-3 py-2 rounded border border-(--background-modifier-border) bg-(--background-secondary-alt) mb-2"
      >
        <span class="text-xs font-medium flex-1 flex">
          <button
            type="button"
            class="clickable-icon gap-2 items-center"
            onclick={openFirstChange}
          >
            <ArrowLeft class="size-3.5" />
            {countChanges} file with changes
          </button>
        </span>
        <!--          <button-->
        <!--            type="button"-->
        <!--            class="ml-auto px-2 py-1 rounded text-xs font-semibold text-purple-700 bg-purple-100 hover:bg-purple-200 transition"-->
        <!--          >-->
        <!--            Accept all-->
        <!--          </button>-->
        <!--          <button-->
        <!--            type="button"-->
        <!--            class="px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"-->
        <!--          >-->
        <!--            Reject all-->
        <!--          </button>-->
      </div>
    {/if}
    {#if chat.state.type === "loading"}
      <div class="flex items-center gap-2 mb-3 text-sm text-(--text-accent)">
        <Loader2Icon class="size-4 animate-spin" />
        <span>Assistant is thinking...</span>
      </div>
    {/if}

    {#if chat.attachments.length > 0}
      <div class="flex flex-wrap gap-2 mb-2">
        {#each chat.attachments as attachment}
          <button
            type="button"
            onclick={() => openFile(normalizePath(attachment.file.path))}
            class="clickable-icon items-center gap-1"
          >
            <FileTextIcon class="size-3.5" />
            <span class="max-w-[200px] truncate"
              >{getBaseName(attachment.file.path)}</span
            >
            <span
              class="flex items-center"
              onclick={(e) => {
                e.stopPropagation();
                chat.removeAttachment(attachment.id);
              }}
            >
              <XIcon class="size-3.5" />
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <Textarea
      required
      bind:value={text}
      name="content"
      placeholder="How can I assist you today?"
      onkeypress={submitOnEnter}
      maxRows={10}
    />
    <div class="flex items-center justify-between mt-2">
      <div class="flex flex-row align-middle gap-2">
        <Button size="sm" type="button" onclick={handleTranscribeClick}>
          {#if realtime.state === "closed"}
            <MicIcon class="size-4" />
          {:else if realtime.state === "open"}
            <MicOffIcon class="size-4" />
          {:else if realtime.state === "connecting"}
            <Loader2Icon class="size-4 animate-spin" />
          {/if}
        </Button>
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
          class="w-[250px] h-9 rounded-md px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          required
        >
          <option value=""> Select model </option>
          {#each getModelAccountOptions() as option}
            <option
              value={option.value}
              selected={option.value ===
                `${options.modelId}:${options.accountId}`}
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
          class="gap-1.5 rounded"
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
