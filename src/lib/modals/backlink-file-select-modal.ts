import { App, FuzzySuggestModal, TFile } from "obsidian";
import { isFileNameUnique } from "$lib/utils/backlinks";

/**
 * A modal for selecting files to create backlinks, using fuzzy search
 */
export class BacklinkFileSelectModal extends FuzzySuggestModal<TFile> {
  onSelect: (fileName: string) => void;

  constructor(app: App, onSelect: (fileName: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Select a file to link");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    // Return basename if unique, otherwise return full path
    const fileName = isFileNameUnique(file.basename, this.app.vault) 
      ? file.basename 
      : file.path;
    this.onSelect(fileName);
  }
}