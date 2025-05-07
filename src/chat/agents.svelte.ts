import { usePlugin } from "$lib/utils";
import { normalizePath, TFile, TFolder } from "obsidian";
import { getBaseName, getLastDirName } from "$lib/utils/path.ts";

export class Agents {
  public entries: { name: string; file: TFile }[] = [];

  async refresh() {
    const plugin = usePlugin();
    const chatbotsPath = normalizePath(plugin.settings.vault.chatbotsPath);
    const chatbotsDir = plugin.app.vault.getAbstractFileByPath(chatbotsPath);
    if (!(chatbotsDir instanceof TFolder))
      throw new Error(`${plugin.settings.vault.chatbotsPath} is not a folder`);

    this.entries = [];
    chatbotsDir.children.forEach((handle) => {
      if (handle instanceof TFile) {
        // Top-level file is prompt, name is file basename
        this.entries.push({ name: getBaseName(handle.path), file: handle });
      }
      if (!(handle instanceof TFolder)) {
        return;
      }
      // check for prompt.md in sub-dir
      const promptPath = normalizePath(`${handle.path}/Prompt.md`);
      const promptFile = plugin.app.vault.getFileByPath(promptPath);
      if (!promptFile) {
        console.warn(
          `No prompt.md found in chatbot folder ${handle.path}. Skipping...,`,
        );
        return;
      }
      this.entries.push({
        name: getLastDirName(promptFile.path),
        file: promptFile,
      });
    });
  }
}
