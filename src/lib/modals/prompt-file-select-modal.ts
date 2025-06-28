import { App, FuzzySuggestModal, TFile } from "obsidian";
import { Prompts } from "../../chat/prompts.svelte.ts";

/**
 * A modal for selecting markdown files to insert as prompts, using fuzzy search
 */
export class PromptFileSelectModal extends FuzzySuggestModal<TFile> {
  onSelect: (file: TFile) => void;
  private showPromptsOnly = true;
  private prompts: Prompts | null = null;

  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.onSelect = onSelect;
    this.prompts = Prompts.getInstance();
    // Default to showing prompts only if user has prompts, otherwise show all files
    this.showPromptsOnly = this.prompts && this.prompts.entries.length > 0;
    this.setPlaceholder("Select a file to insert as prompt");
  }

  open() {
    super.open();
    this.addToggleButton();
  }

  private addToggleButton() {
    // Find the modal content container
    const modalContent = this.containerEl.querySelector(".prompt");
    if (!modalContent) return;

    // Find the prompt input container to insert after
    const promptInputContainer = modalContent.querySelector(
      ".prompt-input-container",
    );
    if (!promptInputContainer) return;

    // Create setting item container following Obsidian patterns
    const settingItem = modalContent.createDiv("setting-item");
    settingItem.style.cssText = "padding: var(--size-4-3)";

    // Add setting info
    const settingInfo = settingItem.createDiv("setting-item-info");
    const settingName = settingInfo.createDiv("setting-item-name");
    settingName.textContent = "Show prompts only";
    const settingDesc = settingInfo.createDiv("setting-item-description");
    settingDesc.textContent = "Only show files with prompt: true frontmatter";

    // Add setting control with toggle
    const settingControl = settingItem.createDiv("setting-item-control");

    const checkboxContainer = settingControl.createDiv("checkbox-container");
    if (this.showPromptsOnly) {
      checkboxContainer.addClass("is-enabled");
    }

    checkboxContainer.setAttribute("role", "checkbox");
    checkboxContainer.setAttribute("tabindex", "0");
    checkboxContainer.setAttribute("aria-label", "Toggle prompts only filter");
    checkboxContainer.setAttribute(
      "aria-checked",
      this.showPromptsOnly.toString(),
    );

    const toggleHandler = () => {
      this.showPromptsOnly = !this.showPromptsOnly;
      checkboxContainer.setAttribute(
        "aria-checked",
        this.showPromptsOnly.toString(),
      );
      if (this.showPromptsOnly) {
        checkboxContainer.addClass("is-enabled");
      } else {
        checkboxContainer.removeClass("is-enabled");
      }
      // @ts-expect-error
      this.updateSuggestions();
    };

    checkboxContainer.addEventListener("click", toggleHandler);
    checkboxContainer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleHandler();
      }
    });

    // Add the checkbox input
    const checkbox = checkboxContainer.createEl("input");
    checkbox.type = "checkbox";
    checkbox.tabIndex = 0;
    checkbox.checked = this.showPromptsOnly;

    // Insert after the prompt input container
    promptInputContainer.insertAdjacentElement("afterend", settingItem);
  }

  getItems(): TFile[] {
    if (this.showPromptsOnly && this.prompts) {
      // Only show files with prompt: true frontmatter
      return this.prompts.entries.map((entry) => entry.file);
    } else {
      // Show all markdown files
      return this.app.vault
        .getFiles()
        .filter((file) => file.extension === "md");
    }
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    this.onSelect(file);
  }
}
