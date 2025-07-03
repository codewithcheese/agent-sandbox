// mocks
import { helpers, plugin, vault } from "../../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { useRecording } from "../../use-recording.ts";
import { promptTool } from "../../../src/tools/evals/prompt.ts";
import type { AIAccount } from "../../../src/settings/settings.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types.ts";
import { TFile } from "obsidian";

describe.skipIf(process.env.CI)("Prompt Tool", () => {
  useRecording();

  let promptFile: TFile;
  let account: AIAccount;
  let toolContext: ToolCallOptionsWithContext;

  beforeEach(async () => {
    await helpers.reset();
    // Create a test prompt file
    promptFile = await vault.create(
      "prompts/summarize.md",
      `---
model_id: claude-3-5-sonnet-20241022
---

You are a helpful assistant that creates concise summaries.

Summarize the following text in 1-2 sentences, focusing on the main points:`,
    );

    // Set up test account and model
    const modelId = "claude-3-5-sonnet-20241022";
    account = {
      id: modelId,
      name: "Anthropic",
      provider: "anthropic",
      config: {
        apiKey: process.env.VITE_ANTHROPIC_API_KEY || "dummy-key-for-testing",
      },
    };
    plugin.settings.accounts.push(account);

    // Add the model to settings
    plugin.settings.models.push({
      id: modelId,
      provider: "anthropic",
      type: "chat",
      inputTokenLimit: 200000,
      outputTokenLimit: 8192,
    });

    // Set default account/model
    plugin.settings.defaults.accountId = account.id;
    plugin.settings.defaults.modelId = modelId;

    // Set up tool execution context
    toolContext = {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: new AbortController().signal,
      getContext: () => ({
        vault,
        config: {},
        sessionStore: {} as any,
      }),
    };
  });

  it("should generate output from prompt and input", async () => {
    const result = await (promptTool as any).execute(
      {
        prompt_path: promptFile.path,
        input:
          "Artificial intelligence is transforming many industries by automating tasks, improving efficiency, and enabling new capabilities. Companies are adopting AI for customer service, data analysis, and decision-making processes.",
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("output");
    expect(typeof result.output).toBe("string");
    expect(result.output.length).toBeGreaterThan(0);
  });

  it("should return error for invalid model", async () => {
    const result = await (promptTool as any).execute(
      {
        prompt_path: promptFile.path,
        input: "Test input",
        model_id: "non-existent-model",
      },
      toolContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Invalid model");
  });

  it("should handle abort signal", async () => {
    const abortController = new AbortController();
    const abortedContext = {
      ...toolContext,
      abortSignal: abortController.signal,
    };

    // Abort immediately
    abortController.abort();

    const result = await (promptTool as any).execute(
      {
        prompt_path: promptFile.path,
        input: "Test input",
      },
      abortedContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Operation aborted");
  });

  it("should return error when vault is not available", async () => {
    const noVaultContext = {
      ...toolContext,
      getContext: () => ({
        vault: null,
        config: {},
        sessionStore: toolContext.getContext().sessionStore,
      }),
    };

    const result = await (promptTool as any).execute(
      {
        prompt_path: promptFile.path,
        input: "Test input",
      },
      noVaultContext as any,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Vault not available in execution context.");
  });
});
