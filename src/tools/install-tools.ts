import { Notice, Modal, Setting } from "obsidian";
import { usePlugin } from "$lib/utils";

// Import the tool markdown files
// Note: For this to work, you need to add the following to your vite.config.js:
// assetsInclude: ['**/*.md']
// @ts-expect-error
import readFileTool from "./Read file.md?raw";
// @ts-expect-error
import listFilesTool from "./List files.md?raw";

// Map of tool names to their markdown content
const BUILT_IN_TOOLS = {
  "Read file": readFileTool,
  "List files": listFilesTool,
};

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
  for (const [toolId, content] of Object.entries(BUILT_IN_TOOLS)) {
    const fileName = `${toolsFolderPath}/${toolId}.md`;
    console.log(`Installing tool ${toolId} to ${fileName}`);
    
    // Check if file exists
    const existingFile = plugin.app.vault.getAbstractFileByPath(fileName);
    console.log(`Checking if file exists: ${fileName}`, existingFile ? 'exists' : 'does not exist');

    if (existingFile) {
      console.log(`File ${fileName} exists, prompting for overwrite`);
      // If file exists, confirm overwrite
      const confirmOverwrite = () => {
        return new Promise<boolean>((resolve) => {
          new ConfirmOverwriteModal(
            plugin.app,
            fileName,
            () => {
              console.log(`User confirmed overwrite for ${fileName}`);
              resolve(true);
            },
            () => {
              console.log(`User cancelled overwrite for ${fileName}`);
              resolve(false);
            },
          ).open();
        });
      };

      try {
        const shouldOverwrite = await confirmOverwrite();
        if (!shouldOverwrite) {
          console.log(`Skipping ${fileName} as user declined overwrite`);
          skipped++;
          continue;
        }

        // Delete existing file
        console.log(`Deleting existing file ${fileName}`);
        await plugin.app.vault.delete(existingFile);
      } catch (error) {
        console.error(`Error during overwrite confirmation for ${fileName}:`, error);
        new Notice(`Error handling file overwrite: ${error.message}`);
        skipped++;
        continue;
      }
    }

    // Create the tool file
    try {
      console.log(`Creating file ${fileName}`);
      await plugin.app.vault.create(fileName, content);
      console.log(`Successfully created ${fileName}`);
      installed++;
      new Notice(`Installed tool "${toolId}"`);
    } catch (error) {
      console.error(`Failed to install tool "${toolId}":`, error);
      new Notice(`Failed to install tool "${toolId}": ${error.message}`);
    }
  }

  // Show summary notice
  new Notice(
    `Installed ${installed} tools${skipped > 0 ? `, skipped ${skipped} tools` : ""}`,
  );
}
