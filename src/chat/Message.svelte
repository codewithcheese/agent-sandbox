<script lang="ts">
  import {
    FileSymlinkIcon,
    FileTextIcon,
    InfoIcon,
    PencilIcon,
    RefreshCwIcon,
  } from "lucide-svelte";
  import Markdown from "./Markdown.svelte";
  import { Notice } from "obsidian";
  import { loadPromptMessage } from "../editor/prompt-command.ts";
  import { cn, usePlugin } from "$lib/utils";
  import type { Chat, UIMessageWithMetadata } from "./chat.svelte.ts";
  import { openToolPartModal } from "$lib/modals/open-tool-part-model.ts";
  import { openPath } from "$lib/utils/obsidian.ts";
  import { setContext } from "svelte";
  import { getBaseName } from "$lib/utils/path.ts";
  import { dirname } from "path-browserify";
  import type { ChatInputState } from "./chat-input-state.svelte.ts";
  import { getTextFromParts } from "$lib/utils/ai.ts";
  import { getToolName, isToolUIPart } from "ai";

  type Props = {
    chat: Chat;
    message: UIMessageWithMetadata;
    index: number;
    inputState: ChatInputState;
  };
  let { chat, message, index, inputState = $bindable() }: Props = $props();
  let plugin = usePlugin();

  // Shared prose classes for consistent styling
  const prose = `prose text-wrap select-text leading-8 prose-pre:bg-(--background-primary-alt) prose-pre:text-(--text-normal)
  prose-h1:m-2 prose-h2:m-1 prose-h3:m-0 prose-h4:m-0 prose-h5:m-0 prose-h6:m-0 prose-p:m-1 prose-p:my-2
  prose-blockquote:m-0 prose-figure:m-0 prose-figcaption:m-0 prose-ul:m-0 prose-ol:m-1 prose-li:m-0
  prose-table:m-0 prose-thead:m-0 prose-tbody:m-0 prose-dl:m-0 prose-dt:m-0 prose-dd:m-0 prose-hr:my-2
  prose-pre:m-0 prose-code:px-1 prose-lead:m-0 prose-strong:font-semibold prose-img:m-0 prose-video:m-0
  [body.theme-dark_&]:prose-invert prose-a:decoration-1 text-foreground max-w-full`;

  // $inspect("inputState", inputState);

  // Link `source` context for prompt messages Markdown links
  setContext("linkSource", (message as any)?.metadata?.prompt?.path ?? "");

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
</script>

{#if inputState.state.type === "editing" && index > inputState.state.index}
  <!-- Hide messages below the one being edited -->
{:else if inputState.state.type === "editing" && inputState.state.index === index}
  <!-- Show greyed out message being edited -->
  <div class="group relative opacity-50">
    {#if message.parts.some((p) => p.type === "text")}
      <div
        class={cn(
          prose,
          message.role === "user"
            ? "bg-(--background-primary-alt) border border-(--background-modifier-border)  rounded p-4"
            : "py-2",
        )}
      >
        <div class="flex items-center gap-2 mb-2 text-sm text-(--text-accent)">
          <PencilIcon class="size-4" />
          <span>Editing...</span>
        </div>
        <Markdown md={getTextFromParts(message.parts)} renderObsidian={true} />
      </div>
    {/if}
  </div>
{:else}
  {#if message.role === "user" && message.metadata?.modified?.length}
    <div>
      <div class="text-xs text-(--text-muted)">
        Your modified files:
        {#each message.metadata.modified as path}
          <div class="flex flex-row gap-2 items-center py-1">
            <div
              tabindex="0"
              role="button"
              onkeydown={() => openPath(path)}
              class="modified-btn"
              onclick={() => openPath(path)}
            >
              {#if path.split(".").pop() === "md"}
                {getBaseName(path)}
              {:else}
                {getBaseName(path)}.{path.split(".").pop()}
              {/if}
            </div>
            <div class="text-(--text-muted) text-xs" style="">
              {dirname(path) === "." ? "" : dirname(path) + "/"}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
  <!-- Normal message display -->
  <div class="group relative">
    <!-- prompt badge -->
    {#if message.role === "user" && message?.metadata?.prompt?.path}
      <div class="absolute top-0 left-0 text-xs text-(--text-accent)">
        <button
          class="clickable-icon"
          onclick={() => openPath(message.metadata.prompt.path)}>Prompt</button
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
            onclick={() => updatePrompt(index)}
          >
            <FileSymlinkIcon class="size-4" />
          </button>
          <button
            class="clickable-icon"
            aria-label="Edit message"
            onclick={() => {
              inputState.startEditing(
                index,
                getTextFromParts(message.parts).trim(),
                message.parts
                  .filter((p) => p.type === "file")
                  .map((p) => p.filename),
              );
            }}
          >
            <PencilIcon class="size-4" />
          </button>
          <button
            class="clickable-icon"
            aria-label={message.role === "user"
              ? "Regenerate assistant response"
              : "Regenerate this response"}
            onclick={() => chat.regenerate(index)}
          >
            <RefreshCwIcon class="size-4" />
          </button>
        {:else}
          <!-- user message buttons -->
          <button
            class="clickable-icon"
            aria-label="Edit message"
            onclick={() => {
              inputState.startEditing(
                index,
                getTextFromParts(message.parts).trim(),
                message.parts
                  .filter((p) => p.type === "file")
                  .map((p) => p.filename),
              );
            }}
          >
            <PencilIcon class="size-4" />
          </button>
          <button
            class="clickable-icon"
            aria-label={message.role === "user"
              ? "Regenerate assistant response"
              : "Regenerate this response"}
            onclick={() => chat.regenerate(index)}
          >
            <RefreshCwIcon class="size-4" />
          </button>
        {/if}
      {/if}
    </div>
    <!-- Render all parts in their original order -->
    <div class="space-y-2">
      {#each message.parts as part}
        {#if part.type === "text"}
          <div
            class={cn(
              prose,
              message.role === "user"
                ? "bg-(--background-primary-alt) border border-(--background-modifier-border) rounded p-4"
                : "py-2",
            )}
          >
            <Markdown md={part.text} renderObsidian={true} />
          </div>
        {:else if part.type === "reasoning"}
          <div
            class="py-1 text-sm text-(--text-muted) bg-(--background-secondary) rounded p-2 select-text"
          >
            {part.text}
          </div>
        {:else if part.type === "file"}
          <div class="mt-2">
            <button
              class="clickable-icon gap-1"
              aria-label="Open attachment"
              onclick={() => openPath(part.filename)}
            >
              <FileTextIcon class="size-3.5" />
              <span class="max-w-[200px] truncate">
                {part.filename.split("/").pop()}
              </span>
            </button>
          </div>
        {:else if isToolUIPart(part)}
          <div class="rounded border border-(--background-modifier-border)">
            <div class="flex flex-row gap-1 text-xs p-1 items-center">
              <span>
                {#if part.state === "output-available"}🟢{:else if part.state === "output-error"}🔴{:else}🟡{/if}
              </span>
              <div class="flex-1">{getToolName(part)}</div>
              <button
                type="button"
                class="clickable-icon"
                aria-label="Open tool invocation info"
                onclick={() => openToolPartModal(chat, part)}
              >
                <InfoIcon class="size-3" />
              </button>
              <!-- fixme: display tool call metadata-->
            </div>
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .modified-btn {
    color: var(--text-normal);
    font-size: var(--font-small);
    font: var(--font-text-theme);
  }
  .modified-btn:hover {
    color: var(--text-accent);
  }
</style>
