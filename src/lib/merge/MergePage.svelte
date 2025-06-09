<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState, Transaction } from "@codemirror/state";
  import { drawSelection, EditorView, keymap } from "@codemirror/view";
  import {
    getChunks,
    getOriginalDoc,
    unifiedMergeView,
  } from "@codemirror/merge";
  import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
  import { Notice } from "obsidian";
  import { createDebug } from "$lib/debug.ts";

  const debug = createDebug();

  type Props = {
    name: string;
    currentContent: string;
    newContent: string;
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
  let { name, currentContent, newContent, onAccept, onReject }: Props =
    $props();

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
        ],
      }),
      parent: editorContainer,
    });
  }

  async function updateContent(): Promise<void> {
    if (!editorView) return;
    createEditor();
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

<div class="markdown-source-view mod-cm6 is-readable-line-width">
  <div class="cm-editor">
    <div class="cm-scroller">
      <div class="cm-sizer">
        <div class="inline-title">Review: {name}</div>
        <div bind:this={editorContainer}></div>
      </div>
    </div>
  </div>
</div>
