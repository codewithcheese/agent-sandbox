import { usePlugin } from "$lib/utils";
import {
  type MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  type TFile,
} from "obsidian";
import SchemaEditor from "./SchemaEditor.svelte";
import { mount, unmount } from "svelte";

class JsonSchemaCodeBlock extends MarkdownRenderChild {
  component: any;
  lineStart: number;
  lineEnd: number;
  view: MarkdownView;

  constructor(
    private source: string,
    private el: HTMLElement,
    private ctx: MarkdownPostProcessorContext,
  ) {
    super(el);
    const sec = ctx.getSectionInfo(this.el);
    if (!sec) return; // block disappeared
    this.lineStart = sec.lineStart;
    this.lineEnd = sec.lineEnd;
    const plugin = usePlugin();
    this.view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    el.style.padding = "0px";
  }

  onload() {
    this.component = mount(SchemaEditor, {
      target: this.containerEl,
      props: {
        source: this.source,
        onSave: (newSource: string) => this.replaceCode(newSource),
      },
    });
  }

  replaceCode(newSource: string) {
    const fromPos = { line: this.lineStart + 1, ch: 0 }; // first content line
    const toPos = {
      line: this.lineEnd,
      ch: 0,
    }; // end of line before closing ```

    const oldText = this.view.editor.getRange(fromPos, toPos); // invariant: exactly what we cut
    console.info(
      `[Schema] Replacing fence contents, from: ${fromPos.line},${fromPos.ch} to ${toPos.line},${toPos.ch}:\nOld text:\n`,
      oldText,
      "\nNew source:\n",
      newSource,
    );

    this.view.editor.replaceRange(newSource + "\n", fromPos, toPos);

    // Track new lineEnd position when this render child is not re-created
    const lineDiff =
      newSource.split("\n").length + 1 - oldText.split("\n").length;
    this.lineEnd += lineDiff;
  }

  async onunload() {
    await unmount(this.component);
  }
}

export class JsonSchemaCodeBlockProcessor {
  constructor() {
    const plugin = usePlugin();
    plugin.registerMarkdownCodeBlockProcessor(
      "schema", // language tag
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        ctx.addChild(new JsonSchemaCodeBlock(source, el, ctx));
      },
    );
  }
}
