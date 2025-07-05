// mocks
import { helpers, plugin, vault } from "../../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { useRecording } from "../../use-recording.ts";
import { evaluateTestSetTool } from "../../../src/tools/evals/evaluate-test-set.ts";
import type { AIAccount } from "../../../src/settings/settings.ts";
import type { ToolCallOptionsWithContext } from "../../../src/tools/types.ts";
import { TFile } from "obsidian";

describe.skipIf(process.env.CI)("EvaluateTestSet Tool", () => {
  useRecording();

  let judgeFile: TFile;
  let testSetFile: TFile;
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

    // Create a test set file
    testSetFile = await vault.create(
      "test-sets/communication-test-set.md",
      `---
test_set: "communication-style"
---

# Communication Style Test Set

This test set evaluates clear communication style.

### Clear Meeting Announcement

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Announce meeting time |
| Output | The meeting is at 3 PM. |

### Verbose Meeting Announcement

| Field | Value |
|-------|-------|
| Expected | FAIL |
| Input | Announce meeting time |
| Output | The aforementioned temporal designation for the convening of the assemblage has been established as the fifteenth hour of the post-meridian period. |

### Clear Document Request

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Request document review |
| Output | Please review the document. |

### Verbose Document Request

| Field | Value |
|-------|-------|
| Expected | FAIL |
| Input | Request document review |
| Output | It would be greatly appreciated if you could undertake a comprehensive examination of the aforementioned documentation. |

Additional notes about this test set...`,
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
    toolContext = {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: new AbortController().signal,
      getContext: () => ({
        vault,
        config: {},
        sessionStore: {} as any,
        metadataCache: plugin.app.metadataCache,
      }),
    };
  });

  it.skip("should evaluate complete test set successfully", async () => {
    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: testSetFile.path,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("tests_run");
    expect(result).toHaveProperty("successes");
    expect(result).toHaveProperty("failures");
    expect(result).toHaveProperty("accuracy_percentage");
    expect(result).toHaveProperty("judge_version");

    expect(result.tests_run).toBe(4);
    expect(result.successes + result.failures).toBe(4);
    expect(result.accuracy_percentage).toBeGreaterThanOrEqual(0);
    expect(result.accuracy_percentage).toBeLessThanOrEqual(100);
    expect(result.judge_version).toBe(2);

    // Verify the test set file was updated
    const updatedContent = await vault.read(testSetFile);
    expect(updatedContent).toContain("## Results (Judge v2)");
    expect(updatedContent).toContain("| ✅ |"); // Should have judge results
    expect(updatedContent).toContain("| ❌ |"); // Should have judge results

    // Verify original content is preserved
    expect(updatedContent).toContain("# Communication Style Test Set");
    expect(updatedContent).toContain("Additional notes about this test set...");

    // Verify results are prepended
    const resultsIndex = updatedContent.indexOf("## Results");
    const originalContentIndex = updatedContent.indexOf(
      "# Communication Style Test Set",
    );
    expect(resultsIndex).toBeLessThan(originalContentIndex);
  });

  it("should return error for non-existent test set file", async () => {
    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: "/non-existent/test-set.md",
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Test set file not found");
  });

  it("should return error for non-existent judge file", async () => {
    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: testSetFile.path,
        judge_agent_path: "/non-existent/judge.md",
      },
      toolContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Judge agent file not found");
  });

  it("should return error for invalid test set format", async () => {
    const invalidTestSetFile = await vault.create(
      "test-sets/invalid-format.md",
      `# Invalid Test Set

This file has no table.`,
    );

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: invalidTestSetFile.path,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("No test definitions found");
  });

  it("should return error for test set with invalid expected values", async () => {
    const invalidExpectedFile = await vault.create(
      "test-sets/invalid-expected.md",
      `### Invalid Test

| Field | Value |
|-------|-------|
| Expected | INVALID |
| Output | Some text |`,
    );

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: invalidExpectedFile.path,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Invalid expected value");
    expect(result.message).toContain(
      "must be \"PASS\", \"FAIL\", \"✅\", or \"❌\"",
    );
  });

  it("should handle test set with empty input", async () => {
    const emptyInputFile = await vault.create(
      "test-sets/empty-input.md",
      `### Empty Input Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input |  |
| Output | Some output |`,
    );

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: emptyInputFile.path,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result.tests_run).toBe(1);
    expect(result.successes + result.failures).toBe(1);
  });

  it("should handle test set with frontmatter", async () => {
    const frontmatterTestSetFile = await vault.create(
      "test-sets/frontmatter-test.md",
      `---
test_set: "frontmatter-test"
description: "Test with frontmatter"
---

# Test Set with Frontmatter

### Simple Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Write simply |
| Output | Simple clear text |

### Verbose Test

| Field | Value |
|-------|-------|
| Expected | FAIL |
| Input | Write verbosely |
| Output | Unnecessarily complex and verbose textual communication |`,
    );

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: frontmatterTestSetFile.path,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result.tests_run).toBe(2);

    // Verify results are inserted after frontmatter
    const updatedContent = await vault.read(frontmatterTestSetFile);
    expect(updatedContent).toMatch(/^---[\s\S]*?---\n## Results/);
    expect(updatedContent).toContain('test_set: "frontmatter-test"'); // Frontmatter preserved
  });

  it("should handle judge with specific model configuration", async () => {
    const specificModelJudge = await vault.create(
      "judges/specific-model-judge.md",
      `---
version: 3
model_id: claude-4-sonnet-20250514
---

Evaluate for clarity.

Respond with JSON: {"reasoning": "analysis", "result": "PASS" or "FAIL"}`,
    );

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: testSetFile.path,
        judge_agent_path: specificModelJudge.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result.judge_version).toBe(3);
  });

  it("should handle abort signal", async () => {
    const abortController = new AbortController();
    const abortedContext = {
      ...toolContext,
      abortSignal: abortController.signal,
    };

    // Abort immediately
    abortController.abort();

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: testSetFile.path,
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
        metadataCache: toolContext.getContext().metadataCache,
      }),
    };

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: testSetFile.path,
        judge_agent_path: judgeFile.path,
      },
      noVaultContext as any,
    );

    expect(result).toHaveProperty("error");
    expect(result.error).toBe("Vault not available in execution context.");
  });

  it("should handle single example test set", async () => {
    const singleExampleFile = await vault.create(
      "test-sets/single-example.md",
      `### Single Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Write clearly |
| Output | Clear and simple text |`,
    );

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: singleExampleFile.path,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result.tests_run).toBe(1);
    expect(result.successes + result.failures).toBe(1);

    // Verify accuracy calculation for single example
    expect([0, 100]).toContain(result.accuracy_percentage);
  });

  it("should preserve multiple tables in test set file", async () => {
    const multiTableFile = await vault.create(
      "test-sets/multi-table.md",
      `# Test Set

### First Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Write first |
| Output | First example |

## Previous Results

| Test | Expected | Judge | Reasoning |
|------|----------|-------|-----------|
| [[#old-test]] | ✅ | ✅ | Old reasoning |

Some additional content.`,
    );

    const result = await (evaluateTestSetTool as any).execute(
      {
        test_set_path: multiTableFile.path,
        judge_agent_path: judgeFile.path,
      },
      toolContext,
    );

    expect(result).not.toHaveProperty("error");
    expect(result.tests_run).toBe(1); // Only processes first table

    const updatedContent = await vault.read(multiTableFile);

    // Should have new results table at top
    expect(updatedContent).toContain("## Results (Judge v2)");

    // Should preserve previous results table
    expect(updatedContent).toContain("## Previous Results");
    expect(updatedContent).toContain("[[#old-test]]");
    expect(updatedContent).toContain("Old reasoning");

    // Should preserve additional content
    expect(updatedContent).toContain("Some additional content.");
  });
});
