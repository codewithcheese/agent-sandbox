<script lang="ts">
  import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    CheckIcon,
    XIcon,
    GitMergeIcon,
  } from "lucide-svelte";

  type Props = {
    // File navigation
    currentFileIndex?: number;
    totalFiles?: number;
    fileName?: string;
    onNavigateFile?: (direction: "prev" | "next") => void;
    canGoPrevFile?: boolean;
    canGoNextFile?: boolean;

    // Chunk navigation
    currentChunkIndex?: number;
    totalChunks?: number;
    onNavigateChunk?: (direction: "prev" | "next") => void;
    canGoPrevChunk?: boolean;
    canGoNextChunk?: boolean;

    // Bulk operations
    onAcceptAll?: () => void;
    onRejectAll?: () => void;
  };

  let {
    currentFileIndex,
    totalFiles,
    fileName,
    onNavigateFile,
    canGoPrevFile = false,
    canGoNextFile = false,
    currentChunkIndex,
    totalChunks,
    onNavigateChunk,
    canGoPrevChunk = false,
    canGoNextChunk = false,
    onAcceptAll,
    onRejectAll,
  }: Props = $props();

  // Determine if we're in multi-file mode
  const isMultiFile = $derived(totalFiles && totalFiles > 1);
  const hasChunks = $derived(totalChunks && totalChunks > 0);
</script>

<div
  data-banner-metadata=""
  data-banner-fold=""
  data-banner="merge"
  class="banner merge-control-bar"
>
  <!-- Banner Icon -->
  <div class="banner-icon">
    <GitMergeIcon />
  </div>

  <!-- File Navigation (Multi-file mode) -->
  {#if isMultiFile}
    <div class="banner-title">Merge</div>
    <div class="flex items-center gap-2 ml-2">
      <button
        class="clickable-icon"
        disabled={!canGoPrevFile}
        onclick={() => onNavigateFile?.("prev")}
        aria-label="Previous file"
      >
        <ChevronLeftIcon class="size-4" />
      </button>

      <div class="text-sm">
        <div class="font-medium">{fileName}</div>
        <div class="text-(--text-muted) text-xs">
          File {currentFileIndex} of {totalFiles}
        </div>
      </div>

      <button
        class="clickable-icon"
        disabled={!canGoNextFile}
        onclick={() => onNavigateFile?.("next")}
        aria-label="Next file"
      >
        <ChevronRightIcon class="size-4" />
      </button>
    </div>
  {:else}
    <!-- Single file mode -->
    <div class="banner-title">{fileName}</div>
  {/if}

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Controls Section -->
  <div class="flex items-center gap-2">
    <!-- Bulk Operations -->
    {#if hasChunks}
      <button
        class="clickable-icon gap-1 text-(--color-green)"
        onclick={() => onAcceptAll?.()}
        aria-label="Accept all changes"
      >
        <CheckIcon class="size-4" />
        Accept All
      </button>

      <button
        class="clickable-icon gap-1 text-(--color-red)"
        onclick={() => onRejectAll?.()}
        aria-label="Reject all changes"
      >
        <XIcon class="size-4" />
        Reject All
      </button>

      <!-- Separator -->
      <div class="w-px h-4 bg-(--background-modifier-border) mx-1"></div>
    {/if}

    <!-- Chunk Navigation -->
    {#if hasChunks}
      <button
        class="clickable-icon"
        disabled={!canGoPrevChunk}
        onclick={() => onNavigateChunk?.("prev")}
        aria-label="Previous change"
      >
        <ChevronUpIcon class="size-4" />
      </button>

      <div class="text-sm text-(--text-muted) min-w-20 text-center">
        {currentChunkIndex} of {totalChunks}
      </div>

      <button
        class="clickable-icon"
        disabled={!canGoNextChunk}
        onclick={() => onNavigateChunk?.("next")}
        aria-label="Next change"
      >
        <ChevronDownIcon class="size-4" />
      </button>
    {/if}
  </div>
</div>

<style>
  .banner {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    border-style: solid;
    border-color: rgba(var(--callout-color), var(--callout-border-opacity));
    border-width: var(--callout-border-width);
    mix-blend-mode: var(--callout-blend-mode);
    background-color: rgba(var(--callout-color), 0.1);
    gap: var(--size-4-1);
    padding: var(--size-4-2);
    z-index: 1000;
  }

  .banner[data-banner="merge"] {
    --callout-color: var(--callout-example);
    --callout-icon: lucide-git-merge;
  }

  .banner-icon {
    color: rgb(var(--callout-color));
  }

  .banner-title {
    font-weight: var(--callout-title-weight);
    font-size: var(--callout-title-size);
    color: rgb(var(--callout-color));
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clickable-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
