<script lang="ts">
  import type { UIMessage } from "ai";
  import {
    FileSymlinkIcon,
    FileTextIcon,
    InfoIcon,
    PencilIcon,
    RefreshCwIcon,
  } from "lucide-svelte";
  import Markdown from "./Markdown.svelte";
  import { Notice } from "obsidian";
  import { loadPromptMessage } from "../markdown/prompt-command.ts";
  import { cn, usePlugin } from "$lib/utils";
  import type { Chat } from "./chat.svelte.ts";
  import { openToolInvocationInfoModal } from "$lib/modals/tool-invocation-info-modal.ts";
  import { openPath } from "$lib/utils/obsidian.ts";
  import { setContext } from "svelte";
  import { getBaseName } from "$lib/utils/path.ts";
  import { dirname } from "path-browserify";

  type Props = {
    chat: Chat;
    message: UIMessage & {
      metadata?: { prompt: { path: string }; modified: string[] };
    };
    index: number;
    editState: {
      index: number;
      content: string;
      originalContent: string;
    } | null;
    startEdit: (index: number) => void;
    regenerateFromMessage: (index: number) => void;
  };
  let {
    chat,
    message,
    index,
    editState,
    startEdit,
    regenerateFromMessage,
  }: Props = $props();
  let plugin = usePlugin();

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

{#if message?.metadata?.modified?.length}
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
            {getBaseName(path)}
          </div>
          <div class="text-(--text-muted) text-xs" style="">
            {dirname(path) === "." ? "" : dirname(path) + "/"}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if editState && index > editState.index}
  <!-- Hide messages below the one being edited -->
{:else if editState && editState.index === index}
  <!-- Show greyed out message being edited -->
  <div class="group relative opacity-50">
    <div
      class={cn(
        `prose select-text leading-8
                prose-pre:bg-(--background-primary-alt) prose-pre:text-(--text-normal)
                          prose-h1:m-2
                          prose-h2:m-1
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
      <div class="flex items-center gap-2 mb-2 text-sm text-(--text-accent)">
        <PencilIcon class="size-4" />
        <span>Editing...</span>
      </div>
      <Markdown md={message.content} renderObsidian={message.role === "user"} />
    </div>
  </div>
{:else}
  <!-- Normal message display -->
  <div class="group relative">
    <!-- prompt badge -->
    {#if message?.metadata?.prompt?.path}
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
            aria-label={message.role === "user"
              ? "Regenerate assistant response"
              : "Regenerate this response"}
            onclick={() => regenerateFromMessage(index)}
          >
            <RefreshCwIcon class="size-4" />
          </button>
        {:else}
          <!-- user message buttons -->
          <button
            class="clickable-icon"
            aria-label="Edit message"
            onclick={() => startEdit(index)}
          >
            <PencilIcon class="size-4" />
          </button>
          <button
            class="clickable-icon"
            aria-label={message.role === "user"
              ? "Regenerate assistant response"
              : "Regenerate this response"}
            onclick={() => regenerateFromMessage(index)}
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
                            prose-h1:m-2
                            prose-h2:m-1
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
        <Markdown
          md={message.content}
          renderObsidian={message.role === "user"}
        />
      </div>
    {/if}
    {#if message.experimental_attachments && message.experimental_attachments.length > 0}
      <div class="mt-2">
        <div class="flex flex-wrap gap-2">
          {#each message.experimental_attachments as attachment}
            <button
              class="clickable-icon gap-1"
              aria-label="Open attachment"
              onclick={() => openPath(attachment.name)}
            >
              <FileTextIcon class="size-3.5" />
              <span class="max-w-[200px] truncate">
                {attachment.name.split("/").pop()}
              </span>
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
            <span>
              {#if part.toolInvocation.state === "result"}🟢{:else}🟡{/if}
            </span>
            <div class="flex-1">{part.toolInvocation.toolName}</div>
            <button
              type="button"
              class="clickable-icon"
              aria-label="Open tool invocation info"
              onclick={() =>
                openToolInvocationInfoModal(chat, part.toolInvocation)}
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
