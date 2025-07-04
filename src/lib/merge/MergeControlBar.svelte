<script lang="ts">
  import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    ChevronDownIcon,
  } from "lucide-svelte";

  type Props = {
    allChangedFiles: string[];
    currentFileIndex: number;
    onNavigateFile: (direction: "prev" | "next") => Promise<void>;
    // Chunk navigation props
    totalChunks?: number;
    currentChunkIndex?: number;
    onNavigateChunk?: (direction: "prev" | "next") => void;
    // Bulk operation props
    onAcceptAll?: () => Promise<void>;
    onRejectAll?: () => Promise<void>;
  };

  let {
    allChangedFiles,
    currentFileIndex,
    onNavigateFile,
    totalChunks = 0,
    currentChunkIndex = 0,
    onNavigateChunk,
    onAcceptAll,
    onRejectAll,
  }: Props = $props();

  // Reactive calculations
  const currentFileName = $derived(
    allChangedFiles[currentFileIndex]?.split("/").pop() || "",
  );
  const hasMultipleFiles = $derived(allChangedFiles.length > 1);

  // Chunk navigation calculations
  const hasChunks = $derived(totalChunks > 0);
  const hasMultipleChunks = $derived(totalChunks > 1);
  const canGoPrevChunk = $derived(hasMultipleChunks && currentChunkIndex > 0);
  const canGoNextChunk = $derived(
    hasMultipleChunks && currentChunkIndex < totalChunks - 1,
  );
</script>

<div class="merge-control-bar" class:single-file={!hasMultipleFiles}>
  <!-- File Navigation (only show if multiple files) -->
  {#if hasMultipleFiles}
    <div class="file-navigation">
      <button
        class="clickable-icon"
        onclick={() => onNavigateFile("prev")}
        aria-label="Previous file with changes (cycles to end)"
      >
        <ChevronLeftIcon class="size-4" />
      </button>

      <div class="file-counter">
        <span class="counter-text"
          >{currentFileIndex + 1} of {allChangedFiles.length}</span
        >
        <span class="file-name">{currentFileName}</span>
      </div>

      <button
        class="clickable-icon"
        onclick={() => onNavigateFile("next")}
        aria-label="Next file with changes (cycles to beginning)"
      >
        <ChevronRightIcon class="size-4" />
      </button>
    </div>
  {:else}
    <!-- Single file - just show filename -->
    <div class="file-info">
      <span class="file-name">{currentFileName}</span>
    </div>
  {/if}

  <!-- Bulk Operations -->
  {#if hasChunks && onAcceptAll && onRejectAll}
    <div class="bulk-operations">
      <button
        class="bulk-button accept"
        onclick={() => onAcceptAll?.()}
        aria-label="Accept all changes in this file"
      >
        Accept All
      </button>
      <button
        class="bulk-button reject"
        onclick={() => onRejectAll?.()}
        aria-label="Reject all changes in this file"
      >
        Reject All
      </button>
    </div>
  {/if}

  <!-- Chunk Navigation -->
  {#if hasChunks && onNavigateChunk}
    <div class="chunk-navigation">
      <button
        class="clickable-icon"
        disabled={!canGoPrevChunk}
        onclick={() => onNavigateChunk?.("prev")}
        aria-label="Previous change"
      >
        <ChevronUpIcon class="size-4" />
      </button>

      <div class="chunk-counter">
        <span class="counter-text">
          {hasMultipleChunks
            ? `Change ${currentChunkIndex + 1} of ${totalChunks}`
            : `${totalChunks} change${totalChunks === 1 ? "" : "s"}`}
        </span>
      </div>

      <button
        class="clickable-icon"
        disabled={!canGoNextChunk}
        onclick={() => onNavigateChunk?.("next")}
        aria-label="Next change"
      >
        <ChevronDownIcon class="size-4" />
      </button>
    </div>
  {/if}
</div>

<style>
  .merge-control-bar {
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
    background-color: var(--background-secondary);
    font-size: var(--font-ui-smaller);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    gap: 24px;
    height: 50px;
    min-height: 50px;
    flex-shrink: 0;
  }

  /* Single file layout - center chunk navigation */
  .merge-control-bar.single-file {
    justify-content: center;
  }

  .file-navigation {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .file-info {
    display: flex;
    align-items: center;
    position: absolute;
    left: 16px;
  }

  .file-counter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 120px;
  }

  .counter-text {
    color: var(--text-muted);
    font-weight: 500;
  }

  .file-name {
    color: var(--text-normal);
    font-weight: 600;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chunk-navigation {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .chunk-counter {
    display: flex;
    align-items: center;
    min-width: 100px;
    text-align: center;
    justify-content: center;
  }

  .bulk-operations {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bulk-button {
    padding: 4px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background-color: var(--background-primary);
    color: var(--text-normal);
    font-size: var(--font-ui-smaller);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .bulk-button:hover {
    background-color: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover);
  }

  .bulk-button.accept {
    color: var(--text-success);
    border-color: var(--text-success);
  }

  .bulk-button.accept:hover {
    background-color: var(--background-modifier-success);
  }

  .bulk-button.reject {
    color: var(--text-error);
    border-color: var(--text-error);
  }

  .bulk-button.reject:hover {
    background-color: var(--background-modifier-error);
  }

  .clickable-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
