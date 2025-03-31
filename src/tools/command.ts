import { Notice, Modal, Setting } from "obsidian";
import { usePlugin } from "$lib/utils";

// Import all tool markdown files using Vite's glob import
// Note: For this to work, you need to add the following to your vite.config.js:
// assetsInclude: ['**/*.md']

// Use Vite's glob import to get all markdown files
// @ts-expect-error - Vite-specific feature
const toolModules: Record<string, string> = import.meta.glob("./*.md", { as: "raw", eager: true });

/**
 * Modal for confirming file overwrite
 */
class ConfirmOverwriteModal extends Modal {
  constructor(
    app: any,
    private fileName: string,
    private onConfirm: () => void,
    private onCancel: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Confirm Overwrite" });
    contentEl.createEl("p", {
      text: `The file "${this.fileName}" already exists. Do you want to overwrite it?`,
    });

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
          this.onCancel();
        });
      })
      .addButton((btn) => {
        btn
          .setButtonText("Overwrite")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          });
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Installs built-in tools to the user's vault
 */
export async function installTools() {
  const plugin = usePlugin();
  // Path where tools should be installed in the Obsidian vault
  const toolsFolderPath = "tools";

  // Create tools folder if it doesn't exist
  if (!plugin.app.vault.getAbstractFileByPath(toolsFolderPath)) {
    try {
      await plugin.app.vault.createFolder(toolsFolderPath);
      new Notice(`Created tools folder at "${toolsFolderPath}"`);
    } catch (error) {
      // Only show a notice, but don't exit the function
      // This handles cases where the folder creation fails but the folder actually exists
      new Notice(`Note: ${error.message}`);
    }
  }

  let installed = 0;
  let skipped = 0;

  // Install each tool
  for (const [path, content] of Object.entries(toolModules)) {
    // Extract the tool name from the path
    const baseName = path.split('/').pop() || '';
    const toolId = baseName.replace(/\.md$/, '');
    const targetPath = `${toolsFolderPath}/${toolId}.md`;
    
    // Check if file exists
    const existingFile = plugin.app.vault.getAbstractFileByPath(targetPath);

    if (existingFile) {
      // If file exists, confirm overwrite
      const confirmOverwrite = () => {
        return new Promise<boolean>((resolve) => {
          new ConfirmOverwriteModal(
            plugin.app,
            targetPath,
            () => resolve(true),
            () => resolve(false),
          ).open();
        });
      };

      try {
        const shouldOverwrite = await confirmOverwrite();
        if (!shouldOverwrite) {
          skipped++;
          continue;
        }

        // Delete existing file
        await plugin.app.vault.delete(existingFile);
      } catch (error) {
        new Notice(`Error handling file overwrite: ${error.message}`);
        skipped++;
        continue;
      }
    }

    // Create the tool file
    try {
      await plugin.app.vault.create(targetPath, content as string);
      installed++;
      new Notice(`Installed tool "${toolId}"`);
    } catch (error) {
      new Notice(`Failed to install tool "${toolId}": ${error.message}`);
    }
  }

  // Show summary notice
  new Notice(
    `Installed ${installed} tools${skipped > 0 ? `, skipped ${skipped} tools` : ""}`,
  );
}
