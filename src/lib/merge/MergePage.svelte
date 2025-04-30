<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState, Transaction } from "@codemirror/state";
  import { drawSelection, EditorView, keymap } from "@codemirror/view";
  import { getOriginalDoc, unifiedMergeView } from "@codemirror/merge";
  import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
  import { Notice } from "obsidian";
  import { usePlugin } from "$lib/utils";

  type Props = {
    name: string;
    ogContent: string;
    newContent: string;
    onSave: (resolvedContent: string, pendingContent: string) => Promise<void>;
  };
  let { name, ogContent, newContent, onSave }: Props = $props();

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

            // Check for accept/reject actions
            if (
              v.transactions.some(
                (tr) =>
                  tr.annotation(Transaction.userEvent) === "accept" ||
                  tr.annotation(Transaction.userEvent) === "revert",
              )
            ) {
              await saveChanges();
            }
          }),
          unifiedMergeView({
            original: ogContent,
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

  async function saveChanges(): Promise<void> {
    if (!editorView) return;

    try {
      const state = editorView.state;
      const resolvedContent = getOriginalDoc(state).toString();
      const pendingContent = state.doc.toString();
      console.log(
        // `Saving changes to ${originalFilePath}`,
        resolvedContent,
        "Proposed content",
        pendingContent,
      );
      await onSave(resolvedContent, pendingContent);
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
