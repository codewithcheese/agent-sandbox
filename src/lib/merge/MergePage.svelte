<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorView } from "@codemirror/view";
  import { goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
  import MergeControlBar from "./MergeControlBar.svelte";
  import type { NavigationState } from "$lib/merge/merge-view.svelte.ts";

  type Props = {
    editorView: EditorView;
    name: string;
    // Chunk navigation state
    navigationState: NavigationState;
    onNavigateFile: (direction: "prev" | "next") => Promise<void>;
    // Bulk operation callbacks
    onAcceptAll: () => Promise<void>;
    onRejectAll: () => Promise<void>;
  };
  let {
    editorView,
    name,
    navigationState,
    onNavigateFile,
    onAcceptAll,
    onRejectAll,
  }: Props = $props();
  let currentChunkIndex = $derived(navigationState.currentChunkIndex);
  let totalChunks = $derived(navigationState.totalChunks);
  let changedFilePaths = $derived(navigationState.changedFilePaths);
  let currentFilePathIndex = $derived(navigationState.currentFilePathIndex);

  $inspect("Merge page", navigationState);

  // State
  let editorContainer: HTMLElement;

  onMount(() => {
    // Attach the existing editor to the DOM
    if (editorView && editorContainer) {
      editorContainer.appendChild(editorView.dom);

      // Navigate to first chunk
      navigateToFirstChunk();
    }
  });

  onDestroy(() => {
    // Don't destroy the editor - it's owned by MergeView
    // Just detach from DOM if needed
    if (editorView && editorView.dom.parentNode) {
      editorView.dom.parentNode.removeChild(editorView.dom);
    }
  });

  /**
   * Navigate to the first chunk when the merge view opens
   */
  function navigateToFirstChunk(): void {
    if (!editorView || totalChunks === 0) return;

    // Reset to first chunk
    currentChunkIndex = 0;
    // Use CodeMirror's built-in navigation to go to first chunk
    goToNextChunk(editorView);
  }

  /**
   * Navigate to next or previous chunk
   */
  function navigateToChunk(direction: "next" | "prev"): void {
    if (!editorView || totalChunks <= 1) return;

    if (direction === "next") {
      if (currentChunkIndex < totalChunks - 1) {
        goToNextChunk(editorView);
        currentChunkIndex++;
      }
    } else {
      if (currentChunkIndex > 0) {
        goToPreviousChunk(editorView);
        currentChunkIndex--;
      }
    }
  }
</script>

<MergeControlBar
  currentFileIndex={currentFilePathIndex + 1}
  totalFiles={changedFilePaths.length}
  fileName={changedFilePaths[currentFilePathIndex]?.split("/").pop() || ""}
  {onNavigateFile}
  canGoPrevFile={changedFilePaths.length > 1}
  canGoNextFile={changedFilePaths.length > 1}
  currentChunkIndex={currentChunkIndex + 1}
  {totalChunks}
  onNavigateChunk={navigateToChunk}
  canGoPrevChunk={totalChunks > 1 && currentChunkIndex > 0}
  canGoNextChunk={totalChunks > 1 && currentChunkIndex < totalChunks - 1}
  {onAcceptAll}
  {onRejectAll}
/>

<div
  class="markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-readable-line-width is-live-preview is-folding show-properties merge-view-container"
  class:with-control-bar={changedFilePaths.length > 1}
>
  <!-- Existing editor -->
  <div class="cm-editor">
    <div class="cm-scroller">
      <div class="cm-sizer">
        <div class="inline-title">{name}</div>
        <div bind:this={editorContainer}></div>
      </div>
    </div>
  </div>
</div>

<style>
  .merge-view-container {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /*:global(.cm-changedText > .cb-content) {*/
  /*  display: inline !important;*/
  /*}*/

  .cm-editor {
    flex: 1;
    height: 100%;
  }
</style>
