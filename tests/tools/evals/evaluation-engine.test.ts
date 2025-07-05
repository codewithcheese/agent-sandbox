// mocks
import { helpers, plugin, vault } from "../../mocks/obsidian.ts";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRecording } from "../../use-recording.ts";
import {
  resolveJudgeConfig,
  evaluateExample,
  parseTestSetTable,
  validateTestSetTable,
  generateResultsTable,
  updateTestSetFile,
  evaluateTestSet,
} from "../../../src/tools/evals/evaluation-engine.ts";
import type { AIAccount } from "../../../src/settings/settings.ts";
import { TFile } from "obsidian";

describe.skipIf(process.env.CI)("Evaluation Engine", () => {
  useRecording();

  let judgeFile: TFile;
  let account: AIAccount;

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
  });

  describe("resolveJudgeConfig", () => {
    it("should resolve judge config with explicit model_id", async () => {
      const config = await resolveJudgeConfig(judgeFile.path, vault);

      expect(config).not.toHaveProperty("error");
      if (!("error" in config)) {
        expect(config.account.id).toBe(account.id);
        expect(config.model.id).toBe("claude-4-sonnet-20250514");
        expect(config.judgeFile.basename).toBe("clarity-judge");
        expect(config.judgeVersion).toBe(2);
      }
    });

    it("should resolve judge config with default model", async () => {
      // Create judge without explicit model_id
      const defaultJudgeFile = await vault.create(
        "judges/default-model-judge.md",
        `---
version: 2
---

Simple judge without explicit model.`,
      );

      const config = await resolveJudgeConfig(defaultJudgeFile.path, vault);

      expect(config).not.toHaveProperty("error");
      if (!("error" in config)) {
        expect(config.account.id).toBe(plugin.settings.defaults.accountId);
        expect(config.model.id).toBe(plugin.settings.defaults.modelId);
        expect(config.judgeVersion).toBe(2);
      }
    });

    it("should return error for non-existent judge file", async () => {
      const config = await resolveJudgeConfig("/non-existent/judge.md", vault);

      expect(config).toHaveProperty("error");
      if ("error" in config) {
        expect(config.error).toBe("Judge agent file not found");
      }
    });

    it("should return error for invalid model_id", async () => {
      const invalidJudgeFile = await vault.create(
        "judges/invalid-model-judge.md",
        `---
model_id: non-existent-model
---

Judge with invalid model.`,
      );

      const config = await resolveJudgeConfig(invalidJudgeFile.path, vault);

      expect(config).toHaveProperty("error");
      if ("error" in config) {
        expect(config.error).toBe("Invalid judge model");
      }
    });
  });

  describe("evaluateExample", () => {
    it("should evaluate a clear, concise text as PASS", async () => {
      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const result = await evaluateExample(
        "The sky is blue.",
        config,
        vault,
        plugin.app.metadataCache,
        undefined,
        undefined,
      );

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result.result).toBe("PASS");
        expect(result.reasoning).toBeTruthy();
        expect(result.judge_version).toBe(2);
        expect(result.judge_model).toBe("claude-4-sonnet-20250514");
        expect(result.judge_account).toBe("Anthropic");
      }
    });

    it("should evaluate verbose, jargon-heavy text as FAIL", async () => {
      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const verboseText =
        "In accordance with the aforementioned meteorological observations and atmospheric conditions, it has been determined through extensive analysis that the chromatic properties of the celestial dome exhibit characteristics consistent with the wavelength spectrum commonly associated with the designation 'blue'.";

      const result = await evaluateExample(
        verboseText,
        config,
        vault,
        plugin.app.metadataCache,
        undefined,
        undefined,
      );

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result.result).toBe("FAIL");
        expect(result.reasoning).toBeTruthy();
        expect(result.judge_version).toBe(2);
      }
    });

    it("should include criteria context in evaluation", async () => {
      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const result = await evaluateExample(
        "The weather is nice today.",
        config,
        vault,
        plugin.app.metadataCache,
        "This is for a weather report, so casual language is acceptable.",
        undefined,
      );

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result.reasoning).toBeTruthy();
        // The reasoning should contain some reference to the context
        expect(result.reasoning.toLowerCase()).toContain("weather");
      }
    });

    it("should handle abort signal", async () => {
      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const abortController = new AbortController();
      abortController.abort();

      const result = await evaluateExample(
        "Test text",
        config,
        vault,
        plugin.app.metadataCache,
        undefined,
        abortController.signal,
      );

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("Operation aborted");
      }
    });
  });

  describe("parseTestSetTable", () => {
    it("should parse valid test set with Field|Value tables", () => {
      const content = `# Test Set

### Clear Communication Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Write clearly |
| Output | Clear text here |

### Verbose Communication Test

| Field | Value |
|-------|-------|
| Expected | FAIL |
| Input | Write verbosely |
| Output | Verbose complicated text |

Some other content.`;

      const result = parseTestSetTable(content);

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          expected: "PASS",
          input: "Write clearly",
          output: "Clear text here",
          testName: "Clear Communication Test",
        });
        expect(result[1]).toEqual({
          expected: "FAIL",
          input: "Write verbosely",
          output: "Verbose complicated text",
          testName: "Verbose Communication Test",
        });
      }
    });

    it("should return error for no test definitions", () => {
      const content = "No test definitions here";

      const result = parseTestSetTable(content);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("No test definitions found");
      }
    });

    it("should return error for invalid expected values", () => {
      const content = `### Invalid Test

| Field | Value |
|-------|-------|
| Expected | INVALID |
| Output | Some text |`;

      const result = parseTestSetTable(content);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("Invalid expected value");
        expect(result.message).toContain(
          "must be \"PASS\", \"FAIL\", \"✅\", or \"❌\"",
        );
      }
    });

    it("should allow empty input text", () => {
      const content = `### Empty Input Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input |  |
| Output | Some output |`;

      const result = parseTestSetTable(content);

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          expected: "PASS",
          input: "",
          output: "Some output",
          testName: "Empty Input Test",
        });
      }
    });

    it("should return error for missing required fields", () => {
      const content = `### Incomplete Test

| Field | Value |
|-------|-------|
| Expected | PASS |`;

      const result = parseTestSetTable(content);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("Missing Output field");
        expect(result.message).toContain("Output");
      }
    });

    it("should handle test with frontmatter", () => {
      const content = `---
test_set: "example"
---

### Frontmatter Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Test input |
| Output | Test example |`;

      const result = parseTestSetTable(content);

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result).toHaveLength(1);
        expect(result[0].input).toBe("Test input");
        expect(result[0].output).toBe("Test example");
        expect(result[0].testName).toBe("Frontmatter Test");
      }
    });
  });

  describe("validateTestSetTable", () => {
    it("should validate correct test set", () => {
      const content = `### Good Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Good input |
| Output | Good example |`;

      const result = validateTestSetTable(content);

      expect(result).toBe(true);
    });

    it("should return error for invalid test set", () => {
      const content = "No test definitions here";

      const result = validateTestSetTable(content);

      expect(result).not.toBe(true);
      if (result !== true) {
        expect(result).toHaveProperty("error");
      }
    });
  });

  describe("generateResultsTable", () => {
    it("should generate results table with correct format", () => {
      const evaluatedExamples = [
        {
          expected: "PASS" as const,
          judge_result: "PASS" as const,
          input: "Write clearly",
          output: "Clear text",
          reasoning: "This is clear and concise",
          testName: "Clear Test",
        },
        {
          expected: "FAIL" as const,
          judge_result: "FAIL" as const,
          input: "Write verbosely",
          output: "Verbose text",
          reasoning: "Too wordy and complex",
          testName: "Verbose Test",
        },
        {
          expected: "PASS" as const,
          judge_result: "FAIL" as const,
          input: "Write example",
          output: "Misaligned example",
          reasoning: "Judge disagreed",
          testName: "Misaligned Test",
        },
      ];

      const result = generateResultsTable(
        evaluatedExamples,
        2,
        "claude-4-sonnet-20250514",
        "test-account",
      );

      expect(result).toContain("## Results (Judge v2) - 2/3 (67%)");
      expect(result).toContain("**Evaluation Details:**");
      expect(result).toContain("- Model: claude-4-sonnet-20250514");
      expect(result).toContain("- Account: test-account");
      expect(result).toContain(
        "| Test | Expected | Judge | Reasoning |",
      );
      expect(result).toContain(
        "[[#clear-test]]",
      );
      expect(result).toContain(
        "[[#verbose-test]]",
      );
      expect(result).toContain(
        "[[#misaligned-test]]",
      );
    });

    it("should handle long text with reasoning truncation", () => {
      const longReasoning = "B".repeat(600); // Longer than 500 char limit

      const evaluatedExamples = [
        {
          expected: "PASS" as const,
          judge_result: "PASS" as const,
          input: "Long input",
          output: "Long output",
          reasoning: longReasoning,
          testName: "Long Test",
        },
      ];

      const result = generateResultsTable(
        evaluatedExamples,
        1,
        "claude-4-sonnet-20250514",
        "test-account",
      );

      // Should truncate reasoning to 500 chars
      expect(result).toContain("B".repeat(500)); // Reasoning truncated at 500
      expect(result).not.toContain("B".repeat(600)); // Reasoning should not exceed 500
      expect(result).toContain("[[#long-test]]"); // Test name link should be present
    });

    it("should escape pipe characters", () => {
      const evaluatedExamples = [
        {
          expected: "PASS" as const,
          judge_result: "PASS" as const,
          input: "Input with | pipe",
          output: "Text with | pipe character",
          reasoning: "Reasoning with | pipe too",
          testName: "Pipe Test",
        },
      ];

      const result = generateResultsTable(
        evaluatedExamples,
        1,
        "claude-4-sonnet-20250514",
        "test-account",
      );

      expect(result).toContain("Reasoning with \\| pipe too");
      expect(result).toContain("[[#pipe-test]]");
    });
  });

  describe("updateTestSetFile", () => {
    it("should prepend results to file without frontmatter", async () => {
      const testFile = await vault.create(
        "test-sets/update-test.md",
        `# Original Content

| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ | Original example | |`,
      );

      const evaluatedExamples = [
        {
          expected: "PASS" as const,
          judge_result: "PASS" as const,
          input: "Test input",
          output: "Test example",
          reasoning: "Good reasoning",
          testName: "Test Example",
        },
      ];

      const result = await updateTestSetFile(
        testFile,
        vault,
        evaluatedExamples,
        1,
        "claude-4-sonnet-20250514",
        "test-account",
      );

      expect(result).toBeUndefined(); // No error

      const updatedContent = await vault.read(testFile);
      expect(updatedContent).toContain("## Results (Judge v1) - 1/1 (100%)");
      expect(updatedContent).toContain("# Original Content"); // Original content preserved
      expect(updatedContent.indexOf("## Results")).toBeLessThan(
        updatedContent.indexOf("# Original Content"),
      );
    });

    it("should prepend results after frontmatter", async () => {
      const testFile = await vault.create(
        "test-sets/frontmatter-test.md",
        `---
test_set: "example"
---

# Content

| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ | Example | |`,
      );

      const evaluatedExamples = [
        {
          expected: "PASS" as const,
          judge_result: "FAIL" as const,
          input: "Test input",
          output: "Test",
          reasoning: "Failed",
          testName: "Failed Test",
        },
      ];

      const result = await updateTestSetFile(
        testFile,
        vault,
        evaluatedExamples,
        2,
        "claude-4-sonnet-20250514",
        "test-account",
      );

      expect(result).toBeUndefined();

      const updatedContent = await vault.read(testFile);
      expect(updatedContent).toMatch(/^---[\s\S]*?---\n## Results/);
      expect(updatedContent).toContain("## Results (Judge v2) - 0/1 (0%)");
    });
  });

  describe("evaluateTestSet", () => {
    // fixme:multi-hop breaks recording
    it.skip("should evaluate complete test set successfully", async () => {
      const testSetFile = await vault.create(
        "test-sets/complete-test.md",
        `# Test Set

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
| Output | Overly verbose and unnecessarily complex textual communication |`,
      );

      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const result = await evaluateTestSet(testSetFile, vault, plugin.app.metadataCache, config);

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result.tests_run).toBe(2);
        expect(result.successes + result.failures).toBe(2);
        expect(result.accuracy_percentage).toBeGreaterThanOrEqual(0);
        expect(result.accuracy_percentage).toBeLessThanOrEqual(100);
        expect(result.judge_version).toBe(2);
      }

      // Verify file was updated
      const updatedContent = await vault.read(testSetFile);
      expect(updatedContent).toContain("## Results (Judge v2)");
      expect(updatedContent).toContain("| ✅ |"); // Should have judge results
    });

    it("should return error for invalid test set", async () => {
      const invalidTestSetFile = await vault.create(
        "test-sets/invalid-test.md",
        "No test definitions here",
      );

      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const result = await evaluateTestSet(invalidTestSetFile, vault, plugin.app.metadataCache, config);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("No test definitions found");
      }
    });

    it("should handle abort signal", async () => {
      const testSetFile = await vault.create(
        "test-sets/abort-test.md",
        `### Abort Test

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Test input |
| Output | Test example |`,
      );

      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const abortController = new AbortController();
      abortController.abort();

      const result = await evaluateTestSet(
        testSetFile,
        vault,
        plugin.app.metadataCache,
        config,
        abortController.signal,
      );

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("Operation aborted");
      }
    });
  });
});
