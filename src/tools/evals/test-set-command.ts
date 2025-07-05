import { MarkdownView, Notice, Plugin, normalizePath } from "obsidian";
import { createDebug } from "$lib/debug.ts";
import { createModal } from "$lib/modals/create-modal.ts";
import {
  evaluateTestSet,
  resolveJudgeConfig,
  validateTestSetTable,
} from "./evaluation-engine.ts";
import TestSetEvaluationModal from "./TestSetEvaluationModal.svelte";
import type { AIAccount, ChatModel } from "../../settings/settings.ts";

const debug = createDebug();

export class TestSetCommand {
  static register(plugin: Plugin) {
    plugin.addCommand({
      id: "run-test-set",
      name: "Run Test Set Evaluation",
      editorCallback: async () => {
        const activeView =
          plugin.app.workspace.getActiveViewOfType(MarkdownView);
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
          new Notice(
            "This file is not a test set. Test set files must have 'judge' in frontmatter.",
          );
          return;
        }

        // Execute the command
        await TestSetCommand.showEvaluationModal(plugin, file);
      },
    });
  }

  private static async showEvaluationModal(plugin: Plugin, testSetFile: any) {
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

      // Get judge model ID for pre-filling the modal
      let judgeModelId: string | null = null;
      try {
        const judgeConfig = await resolveJudgeConfig(judgePath, vault);
        if ("error" in judgeConfig) {
          // Judge config failed, continue without pre-filling
        } else {
          judgeModelId = judgeConfig.model.id;
        }
      } catch (error) {
        // Continue without pre-filling if judge config fails
        debug("Could not resolve judge config for modal pre-fill:", error);
      }

      // Show the modal
      const modal = createModal(TestSetEvaluationModal, {
        judgeModelId,
        onSave: async ({
          account,
          model,
        }: {
          account: AIAccount;
          model: ChatModel;
        }) => {
          modal.close();
          await TestSetCommand.runTestSet(plugin, testSetFile, account, model);
        },
        onClose: () => {
          modal.close();
        },
      });

      modal.open();
    } catch (error) {
      debug("Error showing evaluation modal:", error);
      new Notice(
        `Failed to show evaluation modal: ${error instanceof Error ? error.message : String(error)}`,
        5000,
      );
    }
  }

  private static async runTestSet(
    plugin: Plugin,
    testSetFile: any,
    account: AIAccount,
    model: ChatModel,
  ) {
    try {
      const vault = plugin.app.vault;
      const metaDataCache = plugin.app.metadataCache;

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
        // Resolve judge file for version info
        const judgeConfig = await resolveJudgeConfig(judgePath, vault);
        if ("error" in judgeConfig) {
          new Notice(`Judge configuration error: ${judgeConfig.message}`);
          return;
        }

        // Create custom judge config with user-selected account and model
        const customJudgeConfig = {
          account,
          model,
          judgeFile: judgeConfig.judgeFile,
          judgeVersion: judgeConfig.judgeVersion,
        };

        // Run the evaluation
        const result = await evaluateTestSet(
          testSetFile,
          vault,
          metaDataCache,
          customJudgeConfig,
          new AbortController().signal,
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
          8000,
        );

        debug("Test set evaluation completed:", result);
      } finally {
        progressNotice.hide();
      }
    } catch (error) {
      debug("Error running test set:", error);
      new Notice(
        `Failed to run test set: ${error instanceof Error ? error.message : String(error)}`,
        5000,
      );
    }
  }
}
