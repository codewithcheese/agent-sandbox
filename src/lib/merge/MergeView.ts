import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
} from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const config = {
  name: "obsidian",
  dark: false,
  background: "var(--background-primary)",
  foreground: "var(--text-normal)",
  selection: "var(--text-selection)",
  cursor: "var(--text-normal)",
  activeLine: "var(--background-primary)",
  string: "var(--text-accent)",
  constant: "var(--text-accent-hover)",
  comment: "var(--text-faint)",
  invalid: "var(--text-error)",
};

const obsidianHighlightStyle = HighlightStyle.define([
  {
    tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)],
    color: config.string,
  },
  {
    tag: [t.color, t.constant(t.name), t.standard(t.name)],
    color: config.constant,
  },
  { tag: t.comment, color: config.comment },
  { tag: t.invalid, color: config.invalid },
]);

const obsidianTheme = EditorView.theme({
  "&": {
    color: config.foreground,
    backgroundColor: config.background,
  },
  ".cm-content": { caretColor: config.cursor },
  "&.cm-focused .cm-cursor": { borderLeftColor: config.cursor },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, & ::selection":
    { backgroundColor: config.selection },
  ".cm-activeLine": { backgroundColor: config.activeLine },
  ".cm-activeLineGutter": { backgroundColor: config.background },
  ".cm-selectionMatch": { backgroundColor: config.selection },
  ".cm-gutters": {
    backgroundColor: config.background,
    color: config.comment,
    borderRight: "1px solid var(--background-modifier-border)",
  },
  ".cm-lineNumbers, .cm-gutterElement": { color: "inherit" },
});

export const MERGE_VIEW_TYPE = "merge-view";

export class MergeView extends ItemView {
  private editorView: EditorView | null = null;
  private originalContent: string = "";
  private proposedContent: string = "";
  private initialized: boolean = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return MERGE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Merge View";
  }

  getIcon(): string {
    return "git-pull-request";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("merge-view-container");

    // Create the editor container
    const editorContainer = container.createDiv("merge-editor-container");
    editorContainer.style.height = "100%";

    console.log(defaultKeymap);

    // Create the editor
    this.editorView = new EditorView({
      state: EditorState.create({
        doc: this.proposedContent,
        extensions: [
          syntaxHighlighting(obsidianHighlightStyle),
          drawSelection(),
          obsidianTheme,
          keymap.of([...defaultKeymap, indentWithTab]),
          history(),
          EditorView.updateListener.of(async (v) => {
            if (v.docChanged) {
              console.log("Doc changed");
            }
          }),
          // markdown(),
          unifiedMergeView({
            original: this.originalContent,
          }),
        ],
      }),
      parent: editorContainer,
    });
  }

  async onClose(): Promise<void> {
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }
  }

  /**
   * Sets or updates the content for the merge view
   * @param originalContent The content of the current file
   * @param proposedContent The content of the file to merge with
   */
  setContent(originalContent: string, proposedContent: string): void {
    this.originalContent = originalContent;
    this.proposedContent = proposedContent;

    // If the editor is already initialized, update it
    if (this.initialized && this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
      this.onOpen();
    } else if (!this.initialized && this.containerEl) {
      // If not initialized but the container exists, initialize it
      this.onOpen();
    }

    this.initialized = true;
  }
}
