import { MarkdownView, Notice, Plugin, normalizePath } from "obsidian";
import { createDebug } from "$lib/debug.ts";
import { evaluateTestSet, resolveJudgeConfig, validateTestSetTable } from "./evaluation-engine.ts";

const debug = createDebug();

export class TestSetCommand {
  static register(plugin: Plugin) {
    plugin.addCommand({
      id: "run-test-set",
      name: "Run Test Set Evaluation",
      editorCallback: async () => {
        const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
          new Notice("No active markdown view");
          return;
        }

        const file = activeView.file;
        if (!file) {
          new Notice("No active file");
          return;
        }

        // Check if this is a test set file by looking for frontmatter with judge
        const metadata = plugin.app.metadataCache.getFileCache(file);
        const frontmatter = metadata?.frontmatter;
        
        if (!frontmatter?.judge) {
          new Notice("This file is not a test set. Test set files must have 'judge' in frontmatter.");
          return;
        }

        // Execute the command
        await TestSetCommand.runTestSet(plugin, file);
      },
    });
  }

  private static async runTestSet(plugin: Plugin, testSetFile: any) {
    try {
      const vault = plugin.app.vault;
      
      // Get judge path from frontmatter
      const metadata = plugin.app.metadataCache.getFileCache(testSetFile);
      const judgePath = metadata?.frontmatter?.judge;
      
      if (!judgePath) {
        new Notice("Test set file must have 'judge' in frontmatter");
        return;
      }

      // Validate test set file format
      const testSetContent = await vault.read(testSetFile);
      const validationResult = validateTestSetTable(testSetContent);

      if (validationResult !== true) {
        new Notice(`Invalid test set format: ${validationResult.message}`);
        return;
      }

      // Show progress notice
      const progressNotice = new Notice("Running test set evaluation...", 0);

      try {
        // Resolve judge configuration
        const judgeConfig = await resolveJudgeConfig(judgePath, vault);
        if ("error" in judgeConfig) {
          new Notice(`Judge configuration error: ${judgeConfig.message}`);
          return;
        }

        // Run the evaluation
        const result = await evaluateTestSet(
          testSetFile,
          vault,
          judgeConfig,
          new AbortController().signal
        );

        if ("error" in result) {
          new Notice(`Evaluation failed: ${result.message}`);
          return;
        }

        // Show success message with results
        new Notice(
          `Test set evaluation completed!\n` +
          `Tests run: ${result.tests_run}\n` +
          `Accuracy: ${result.accuracy_percentage}% (${result.successes}/${result.tests_run})\n` +
          `Judge version: ${result.judge_version}`,
          8000
        );

        debug("Test set evaluation completed:", result);

      } finally {
        progressNotice.hide();
      }

    } catch (error) {
      debug("Error running test set:", error);
      new Notice(
        `Failed to run test set: ${error instanceof Error ? error.message : String(error)}`,
        5000
      );
    }
  }
}
