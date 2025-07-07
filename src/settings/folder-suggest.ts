import { AbstractInputSuggest, TFolder } from "obsidian";
import type { App } from "obsidian";
import type { Attachment } from "svelte/attachments";

export function folderSuggest(app: App): Attachment {
  return (element: HTMLInputElement) => {
    const suggest = new (class extends AbstractInputSuggest<TFolder> {
      getSuggestions(query: string): TFolder[] {
        const q = query.toLowerCase();
        return this.app.vault
          .getAllLoadedFiles()
          .filter(
            (f) => f instanceof TFolder && f.path.toLowerCase().includes(q),
          ) as TFolder[];
      }

      renderSuggestion(folder: TFolder, el: HTMLElement) {
        el.setText(folder.path);
      }

      selectSuggestion(folder: TFolder) {
        // @ts-expect-error not typed
        this.textInputEl.value = folder.path;
        // @ts-expect-error not typed
        this.textInputEl.trigger("input");
        this.close();
      }
    })(app, element);

    return () => {
      suggest.close();
    };
  };
}
