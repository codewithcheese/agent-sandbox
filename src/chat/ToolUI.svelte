<script lang="ts">
  import type { ToolUIPart } from "ai";
  import { getToolName } from "ai";
  import {
    InfoIcon,
    CheckCircleIcon,
    XCircleIcon,
    LoaderIcon,
    ArrowDownIcon,
  } from "lucide-svelte";
  import { openToolPartModal } from "$lib/modals/open-tool-part-model.ts";
  import { openPath } from "$lib/utils/obsidian.ts";
  import { basename, dirname } from "path-browserify";
  import type { Chat } from "./chat.svelte.ts";
  import { normalizePath } from "obsidian";

  type Props = {
    chat: Chat;
    toolPart: ToolUIPart;
    message: { parts: any[] };
  };

  let { chat, toolPart, message }: Props = $props();

  // Find associated data part
  const dataPart = $derived(
    message.parts.find(
      (p) => p.type === "data-tool-ui" && p.id === toolPart.toolCallId,
    ),
  );

  $inspect("ToolUI", toolPart, dataPart);

  // Helper function to format file path like Obsidian
  function formatPath(path: string) {
    const ext = path.split(".").pop();
    const fileName = ext === "md" ? basename(path, `.${ext}`) : basename(path);
    const dirPath = dirname(path) === "." ? "/" : dirname(path) + "/";
    return { fileName, dirPath };
  }
</script>

<div class="flex items-center gap-2 text-xs p-2 rounded">
  <!-- Status Icon -->
  {#if toolPart.state === "output-available"}
    <CheckCircleIcon class="size-3 text-(--color-green) flex-shrink-0" />
  {:else if toolPart.state === "output-error"}
    <XCircleIcon class="size-3 text-(--color-red) flex-shrink-0" />
  {:else if toolPart.state === "input-streaming"}
    <div class="flex items-center gap-1">
      <ArrowDownIcon
        class="size-3 text-(--color-blue) animate-pulse flex-shrink-0"
      />
      <!-- Token count for streaming - comes from data part -->
      {#if typeof toolPart.input === "string"}
        <span class="text-(--text-muted) text-xs">
          {Math.abs(Math.ceil(toolPart.input.length / 4))}
        </span>
      {/if}
    </div>
  {:else}
    <LoaderIcon
      class="size-3 text-(--color-yellow) animate-spin flex-shrink-0"
    />
  {/if}

  <!-- Tool Info (single line) -->
  <div class="flex flex-1 truncate items-center gap-2">
    <span class="font-medium text-(--text-normal)">
      {dataPart?.data.title || getToolName(toolPart)}
    </span>

    {#if dataPart?.data.path}
      {@const { fileName, dirPath } = formatPath(dataPart.data.path)}
      <a
        class="text-xs text-(--text-accent) hover:text-(--text-accent-hover) cursor-pointer"
        onclick={() => openPath(dataPart.data.path)}
        role="button"
        tabindex="0"
        aria-label="Open file: {fileName}"
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPath(dataPart.data.path);
          }
        }}
      >
        {fileName}
      </a>
      <span class="text-(--text-muted)">{normalizePath(dirPath)}</span>
      {#if dataPart?.data.context}
        <span
          class="text-(--text-muted)"
          class:font-mono={dataPart.data.contextStyle === "mono"}
          >{dataPart.data.context}</span
        >
      {/if}
    {:else if dataPart?.data.context}
      <span
        class="text-(--text-muted) ml-1"
        class:font-mono={dataPart.data.contextStyle === "mono"}
        >{dataPart.data.context}</span
      >
    {/if}
  </div>

  <!-- Right-side line information -->
  {#if dataPart?.data.lines}
    <div
      class="flex-shrink-0 text-xs bg-(--background-secondary-alt) border border-(--background-modifier-border) rounded px-2 py-1"
    >
      <span class="font-mono text-(--text-normal) font-medium">
        {dataPart.data.lines}
      </span>
    </div>
  {/if}

  <!-- Info Button -->
  <button
    type="button"
    class="clickable-icon flex-shrink-0"
    aria-label="Open tool details"
    onclick={() => openToolPartModal(chat, toolPart)}
  >
    <InfoIcon class="size-3" />
  </button>
</div>
