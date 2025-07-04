<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState, type Extension, Transaction } from "@codemirror/state";
  import { drawSelection, EditorView, keymap } from "@codemirror/view";
  import {
    getChunks,
    getOriginalDoc,
    unifiedMergeView,
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
    name: string;
    currentContent: string;
    newContent: string;
    // NEW: Navigation props
    allChangedFiles: string[];
    currentFileIndex: number;
    onNavigateFile: (direction: 'prev' | 'next') => Promise<void>;
    // Existing callback props
    onAccept: (
      resolvedContent: string,
      pendingContent: string,
      chunksLeft: number,
    ) => Promise<void>;
    onReject: (
      resolvedContent: string,
      pendingContent: string,
      chunksLeft: number,
    ) => Promise<void>;
  };
  let { 
    name, 
    currentContent, 
    newContent, 
    allChangedFiles,
    currentFileIndex,
    onNavigateFile,
    onAccept, 
    onReject 
  }: Props = $props();

  // State
  let editorView: EditorView | null = $state(null);
  let editorContainer: HTMLElement;

  onMount(() => {
    createEditor();
  });

  onDestroy(() => {
    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
  });

  /**
   * Create or update the editor instance
   */
  function createEditor(): void {
    // Destroy existing editor if it exists
    if (editorView) {
      editorView.destroy();
      editorView = null;
    }

    // Create the editor
    editorView = new EditorView({
      state: EditorState.create({
        doc: newContent,
        extensions: [
          drawSelection(),
          keymap.of([...defaultKeymap, indentWithTab]),
          history(),
          EditorView.lineWrapping,
          EditorView.updateListener.of(async (v) => {
            // if (v.docChanged) {
            //   console.log("Doc changed", v.state.doc.toString());
            //   proposedContent = v.state.doc.toString();
            // }

            debug("Merge view update", v);

            // How many chunks are left?
            const chunks = getChunks(v.state);
            debug("Chunks left", chunks);

            // Check for accept/reject actions
            if (
              v.transactions.some(
                (tr) => tr.annotation(Transaction.userEvent) === "accept",
              )
            ) {
              await acceptChange(v.state);
            }

            if (
              v.transactions.some(
                (tr) => tr.annotation(Transaction.userEvent) === "revert",
              )
            ) {
              await rejectChange(v.state);
            }
          }),
          unifiedMergeView({
            original: currentContent,
            gutter: false,
          }),
          (gnosis() as Extension[]).toSpliced(1, 1), // splice out the gnosis theme
          obsidianTheme,
        ],
      }),
      parent: editorContainer,
    });
  }

  async function acceptChange(state: EditorState): Promise<void> {
    if (!editorView) return;
    try {
      const chunkInfo = getChunks(state);
      const resolvedContent = getOriginalDoc(state).toString();
      const pendingContent = state.doc.toString();
      await onAccept(resolvedContent, pendingContent, chunkInfo.chunks.length);
    } catch (error) {
      console.error("Error saving changes:", error);
      new Notice(`Error saving changes: ${(error as Error).message}`);
    }
  }

  async function rejectChange(state: EditorState): Promise<void> {
    if (!editorView) return;

    try {
      const chunkInfo = getChunks(state);
      const resolvedContent = getOriginalDoc(state).toString();
      const pendingContent = state.doc.toString();
      await onReject(resolvedContent, pendingContent, chunkInfo.chunks.length);
    } catch (error) {
      console.error("Error saving changes:", error);
      new Notice(`Error saving changes: ${(error as Error).message}`);
    }
  }
</script>

<div
  class="markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-readable-line-width is-live-preview is-folding show-properties merge-view-container"
  class:with-control-bar={allChangedFiles.length > 1}
>
  <!-- NEW: Control bar at top -->
  {#if allChangedFiles.length > 1}
    <MergeControlBar 
      {allChangedFiles}
      {currentFileIndex}
      {onNavigateFile}
    />
  {/if}
  
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
  
  .merge-view-container.with-control-bar {
    /* Add top padding to account for absolute positioned control bar */
    padding-top: 50px; /* Approximate height of control bar */
  }
  
  .cm-editor {
    flex: 1;
    height: 100%;
  }
</style>
