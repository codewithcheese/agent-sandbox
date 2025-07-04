<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState, type Extension, Transaction } from "@codemirror/state";
  import { drawSelection, EditorView, keymap } from "@codemirror/view";
  import {
    getChunks,
    getOriginalDoc,
    unifiedMergeView,
    goToNextChunk,
    goToPreviousChunk,
  } from "@codemirror/merge";
  import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
  import { Notice } from "obsidian";
  import { createDebug } from "$lib/debug.ts";
  import { gnosis } from "@glifox/gnosis";

  import { Compartment } from "@codemirror/state";
  import { obsidianTheme } from "$lib/merge/theme.ts";
  import MergeControlBar from "./MergeControlBar.svelte";
  export const themeVariant = new Compartment();

  const debug = createDebug();

  type Props = {
    editorView: EditorView;
    name: string;
    // Chunk navigation state
    currentChunkIndex: number;
    totalChunks: number;
    // Navigation props
    allChangedFiles: string[];
    currentFileIndex: number;
    onNavigateFile: (direction: "prev" | "next") => Promise<void>;
    // Bulk operation callbacks
    onAcceptAll: () => Promise<void>;
    onRejectAll: () => Promise<void>;
  };
  let {
    editorView,
    name,
    currentChunkIndex,
    totalChunks,
    allChangedFiles,
    currentFileIndex,
    onNavigateFile,
    onAcceptAll,
    onRejectAll,
  }: Props = $props();

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
  currentFileIndex={currentFileIndex + 1}
  totalFiles={allChangedFiles.length}
  fileName={allChangedFiles[currentFileIndex]?.split("/").pop() || ""}
  {onNavigateFile}
  canGoPrevFile={allChangedFiles.length > 1}
  canGoNextFile={allChangedFiles.length > 1}
  currentChunkIndex={currentChunkIndex + 1}
  {totalChunks}
  onNavigateChunk={navigateToChunk}
  canGoPrevChunk={totalChunks > 1 && currentChunkIndex > 0}
  canGoNextChunk={totalChunks > 1 && currentChunkIndex < totalChunks - 1}
  onAcceptAll={onAcceptAll}
  onRejectAll={onRejectAll}
/>

<div
  class="markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-readable-line-width is-live-preview is-folding show-properties merge-view-container"
  class:with-control-bar={allChangedFiles.length > 1}
>
  <!-- Existing editor -->
  <div class="cm-editor">
    <div class="cm-scroller">
      <div class="cm-sizer">
        <div class="inline-title">Review: {name}</div>
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

  .cm-editor {
    flex: 1;
    height: 100%;
  }
</style>
