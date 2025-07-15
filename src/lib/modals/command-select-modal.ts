import { App, FuzzySuggestModal, TFile } from "obsidian";
import { Commands } from "../../chat/commands.svelte.ts";

/**
 * A modal for selecting markdown files to insert as commands, using fuzzy search
 */
export class CommandSelectModal extends FuzzySuggestModal<TFile> {
  onSelect: (file: TFile) => void;
  private showCommandsOnly = true;
  private commands: Commands | null = null;

  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.onSelect = onSelect;
    this.commands = Commands.getInstance();
    // Default to showing commands only if user has commands, otherwise show all files
    this.showCommandsOnly = this.commands && this.commands.entries.length > 0;
    this.setPlaceholder("Select a file to insert as command");
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
    settingName.textContent = "Show commands only";
    const settingDesc = settingInfo.createDiv("setting-item-description");
    settingDesc.textContent = "Only show files with command: true frontmatter";

    // Add setting control with toggle
    const settingControl = settingItem.createDiv("setting-item-control");

    const checkboxContainer = settingControl.createDiv("checkbox-container");
    if (this.showCommandsOnly) {
      checkboxContainer.addClass("is-enabled");
    }

    checkboxContainer.setAttribute("role", "checkbox");
    checkboxContainer.setAttribute("tabindex", "0");
    checkboxContainer.setAttribute("aria-label", "Toggle commands only filter");
    checkboxContainer.setAttribute(
      "aria-checked",
      this.showCommandsOnly.toString(),
    );

    const toggleHandler = () => {
      this.showCommandsOnly = !this.showCommandsOnly;
      checkboxContainer.setAttribute(
        "aria-checked",
        this.showCommandsOnly.toString(),
      );
      if (this.showCommandsOnly) {
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
    checkbox.checked = this.showCommandsOnly;

    // Insert after the prompt input container
    promptInputContainer.insertAdjacentElement("afterend", settingItem);
  }

  getItems(): TFile[] {
    if (this.showCommandsOnly && this.commands) {
      // Only show files with command: true frontmatter
      return this.commands.entries.map((entry) => entry.file);
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
