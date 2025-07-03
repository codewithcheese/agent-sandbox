// mocks
import { helpers, plugin, vault } from "../../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { useRecording } from "../../use-recording.ts";
import { evaluateOutputTool } from "../../../src/tools/evals/evaluate-output.ts";
import type { AIAccount } from "../../../src/settings/settings.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types.ts";
import { TFile } from "obsidian";

describe.skipIf(process.env.CI)("EvaluateOutput Tool", () => {
  useRecording();

  let judgeFile: TFile;
  let account: AIAccount;
  let toolContext: ToolCallOptionsWithContext;

  beforeEach(async () => {
    await helpers.reset();
    // Create a test judge agent file
    judgeFile = await vault.create(
      "judges/clarity-judge.md",
      `---
version: 2
model_id: claude-4-sonnet-20250514
---

Evaluate whether the provided text demonstrates clear, concise communication.

Criteria:
- Direct and to the point
- No unnecessary jargon
- Clear meaning

Analyze the text against these criteria. Respond with valid JSON containing:
- "reasoning": your detailed analysis of the text
- "result": either "PASS" or "FAIL"`,
    );

    // Set up test account and model
    const modelId = "claude-4-sonnet-20250514";
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
    // const vaultOverlay = new VaultOverlay(vault);
    // const sessionStore = new SessionStore(vaultOverlay);

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

  it("should evaluate clear text as PASS", async () => {
    const result = await (evaluateOutputTool as any).execute(
      {
        text: "The meeting is at 3 PM.",
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("result");
    expect(result.result).toBe("PASS");
    expect(result.reasoning).toBeTruthy();
    expect(result.judge_version).toBe(2);
    expect(result.judge_model).toBe("claude-4-sonnet-20250514");
    expect(result.judge_account).toBe("Anthropic");
  });

  it("should evaluate complex text as FAIL", async () => {
    const complexText =
      "The aforementioned temporal designation for the convening of the aforementioned assemblage has been established as the fifteenth hour of the post-meridian period.";

    const result = await (evaluateOutputTool as any).execute(
      {
        text: complexText,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("result");
    expect(result.result).toBe("FAIL");
    expect(result.reasoning).toBeTruthy();
  });

  it("should return error for non-existent judge file", async () => {
    const result = await (evaluateOutputTool as any).execute(
      {
        text: "Test text",
        judge_agent_path: "/non-existent/judge.md",
      },
      toolContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Judge agent file not found");
  });

  it("should handle judge with invalid model", async () => {
    const invalidJudgeFile = await vault.create(
      "judges/invalid-model-judge.md",
      `---
model_id: non-existent-model-id
---

Judge with invalid model.`,
    );

    const result = await (evaluateOutputTool as any).execute(
      {
        text: "Test text",
        judge_agent_path: invalidJudgeFile.path,
      },
      toolContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Invalid judge model");
  });

  it("should use default model when judge doesn't specify one", async () => {
    const defaultJudgeFile = await vault.create(
      "judges/default-model-judge.md",
      `---
version: 1
---

Evaluate the text for clarity.

Respond with JSON: {"reasoning": "your analysis", "result": "PASS" or "FAIL"}`,
    );

    const result = await (evaluateOutputTool as any).execute(
      {
        text: "Clear and simple text.",
        judge_agent_path: defaultJudgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("result");
    expect(result.judge_model).toBe(plugin.settings.defaults.modelId);
    expect(result.judge_account).toBe("Anthropic");
  });

  it("should handle abort signal", async () => {
    const abortController = new AbortController();
    const abortedContext = {
      ...toolContext,
      abortSignal: abortController.signal,
    };

    // Abort immediately
    abortController.abort();

    const result = await (evaluateOutputTool as any).execute(
      {
        text: "Test text",
        judge_agent_path: judgeFile.path,
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

    const result = await (evaluateOutputTool as any).execute(
      {
        text: "Test text",
        judge_agent_path: judgeFile.path,
      },
      noVaultContext as any,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Vault not available in execution context.");
  });
});
