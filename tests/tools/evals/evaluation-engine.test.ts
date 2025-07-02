// mocks
import { plugin, vault } from "../../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { useRecording } from "../../use-recording.ts";
import {
  resolveJudgeConfig,
  evaluateExample,
  parseEvaluationResult,
  parseTestSetTable,
  validateTestSetTable,
  generateResultsTable,
  updateTestSetFile,
  evaluateTestSet,
} from "../../../src/tools/evals/evaluation-engine.ts";
import type { AIAccount } from "../../../src/settings/settings.ts";
import { TFile } from "obsidian";

describe("Evaluation Engine", () => {
  useRecording();

  let judgeFile: TFile;
  let account: AIAccount;

  beforeEach(async () => {
    // Create a test judge agent file
    judgeFile = await vault.create(
      "judges/clarity-judge.md",
      `---
version: 1
model_id: claude-4-sonnet-20250514
---

Evaluate whether the provided text demonstrates clear, concise writing.

Criteria:
- Uses simple, direct language
- Avoids unnecessary jargon
- Gets to the point quickly

{% if criteria_context %}
Additional context: {{ criteria_context }}
{% endif %}

Evaluate the text against the criteria above. Respond with valid JSON containing:
- "reasoning": your analysis of the text
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

  describe("parseEvaluationResult", () => {
    it("should parse PASS from clear pass text", () => {
      const result = parseEvaluationResult(
        "This text is clear and concise. PASS",
      );
      expect(result).toBe("PASS");
    });

    it("should parse FAIL from clear fail text", () => {
      const result = parseEvaluationResult(
        "This text is confusing and verbose. FAIL",
      );
      expect(result).toBe("FAIL");
    });

    it("should handle fuzzy pass matching", () => {
      const result = parseEvaluationResult(
        "The text passes all criteria successfully.",
      );
      expect(result).toBe("PASS");
    });

    it("should handle fuzzy fail matching", () => {
      const result = parseEvaluationResult(
        "The text fails to meet the requirements.",
      );
      expect(result).toBe("FAIL");
    });

    it("should default to FAIL for unclear text", () => {
      const result = parseEvaluationResult(
        "This is ambiguous text with no clear decision.",
      );
      expect(result).toBe("FAIL");
    });

    it("should handle case insensitive matching", () => {
      expect(parseEvaluationResult("PASS")).toBe("PASS");
      expect(parseEvaluationResult("pass")).toBe("PASS");
      expect(parseEvaluationResult("Pass")).toBe("PASS");
      expect(parseEvaluationResult("FAIL")).toBe("FAIL");
      expect(parseEvaluationResult("fail")).toBe("FAIL");
      expect(parseEvaluationResult("Fail")).toBe("FAIL");
    });
  });

  describe("resolveJudgeConfig", () => {
    it("should resolve judge config with explicit model_id", async () => {
      const config = await resolveJudgeConfig(judgeFile.path, vault);

      expect(config).not.toHaveProperty("error");
      if (!("error" in config)) {
        expect(config.account.id).toBe(account.id);
        expect(config.model.id).toBe("claude-4-sonnet-20250514");
        expect(config.judgeFile.basename).toBe("clarity-judge");
        expect(config.judgeVersion).toBe(1);
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
        undefined,
        undefined,
      );

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result.result).toBe("PASS");
        expect(result.reasoning).toBeTruthy();
        expect(result.judge_version).toBe(1);
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
        undefined,
        undefined,
      );

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result.result).toBe("FAIL");
        expect(result.reasoning).toBeTruthy();
        expect(result.judge_version).toBe(1);
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
    it("should parse valid test set table", () => {
      const content = `# Test Set

| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ | Clear text here | |
| ❌ | ⏳ | Verbose complicated text | |

Some other content.`;

      const result = parseTestSetTable(content);

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          expected: "PASS",
          example: "Clear text here",
        });
        expect(result[1]).toEqual({
          expected: "FAIL",
          example: "Verbose complicated text",
        });
      }
    });

    it("should return error for no table found", () => {
      const content = "# Test Set\n\nNo table here.";

      const result = parseTestSetTable(content);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("No table found");
      }
    });

    it("should return error for invalid expected values", () => {
      const content = `| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| PASS | ⏳ | Some text | |`;

      const result = parseTestSetTable(content);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("Invalid expected value");
        expect(result.message).toContain(
          "must contain ✅ (for PASS) or ❌ (for FAIL)",
        );
      }
    });

    it("should return error for empty example text", () => {
      const content = `| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ |  | |`;

      const result = parseTestSetTable(content);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("Empty example text");
      }
    });

    it("should return error for insufficient columns", () => {
      const content = `| Expected | Judge |
|----------|-------|
| ✅ | ⏳ |`;

      const result = parseTestSetTable(content);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("Invalid table format");
        expect(result.message).toContain("must have at least 3 columns");
      }
    });

    it("should handle table with frontmatter", () => {
      const content = `---
test_set: "example"
---

| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ | Test example | |`;

      const result = parseTestSetTable(content);

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result).toHaveLength(1);
        expect(result[0].example).toBe("Test example");
      }
    });
  });

  describe("validateTestSetTable", () => {
    it("should validate correct test set", () => {
      const content = `| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ | Good example | |`;

      const result = validateTestSetTable(content);

      expect(result).toBe(true);
    });

    it("should return error for invalid test set", () => {
      const content = "No table here";

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
          example: "Clear text",
          reasoning: "This is clear and concise",
        },
        {
          expected: "FAIL" as const,
          judge_result: "FAIL" as const,
          example: "Verbose text",
          reasoning: "Too wordy and complex",
        },
        {
          expected: "PASS" as const,
          judge_result: "FAIL" as const,
          example: "Misaligned example",
          reasoning: "Judge disagreed",
        },
      ];

      const result = generateResultsTable(evaluatedExamples, 2);

      expect(result).toContain("## Results (Judge v2) - 2/3 (67%)");
      expect(result).toContain("| Expected | Judge | Example | Reasoning |");
      expect(result).toContain(
        "| ✅ | ✅ | Clear text | This is clear and concise |",
      );
      expect(result).toContain(
        "| ❌ | ❌ | Verbose text | Too wordy and complex |",
      );
      expect(result).toContain(
        "| ✅ | ❌ | Misaligned example | Judge disagreed |",
      );
    });

    it("should handle long text with reasoning truncation", () => {
      const longExample = "A".repeat(300);
      const longReasoning = "B".repeat(600); // Longer than 500 char limit

      const evaluatedExamples = [
        {
          expected: "PASS" as const,
          judge_result: "PASS" as const,
          example: longExample,
          reasoning: longReasoning,
        },
      ];

      const result = generateResultsTable(evaluatedExamples, 1);

      // Should NOT truncate example, but should truncate reasoning to 500 chars
      expect(result).toContain("A".repeat(300)); // Full example should be present
      expect(result).toContain("B".repeat(500)); // Reasoning truncated at 500
      expect(result).not.toContain("B".repeat(600)); // Reasoning should not exceed 500
    });

    it("should escape pipe characters", () => {
      const evaluatedExamples = [
        {
          expected: "PASS" as const,
          judge_result: "PASS" as const,
          example: "Text with | pipe character",
          reasoning: "Reasoning with | pipe too",
        },
      ];

      const result = generateResultsTable(evaluatedExamples, 1);

      expect(result).toContain("Text with \\| pipe character");
      expect(result).toContain("Reasoning with \\| pipe too");
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
          example: "Test example",
          reasoning: "Good reasoning",
        },
      ];

      const result = await updateTestSetFile(
        testFile,
        vault,
        evaluatedExamples,
        1,
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
          example: "Test",
          reasoning: "Failed",
        },
      ];

      const result = await updateTestSetFile(
        testFile,
        vault,
        evaluatedExamples,
        2,
      );

      expect(result).toBeUndefined();

      const updatedContent = await vault.read(testFile);
      expect(updatedContent).toMatch(/^---[\s\S]*?---\n## Results/);
      expect(updatedContent).toContain("## Results (Judge v2) - 0/1 (0%)");
    });
  });

  describe("evaluateTestSet", () => {
    it("should evaluate complete test set successfully", async () => {
      const testSetFile = await vault.create(
        "test-sets/complete-test.md",
        `# Test Set

| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ | Simple clear text | |
| ❌ | ⏳ | Overly verbose and unnecessarily complex textual communication | |`,
      );

      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const result = await evaluateTestSet(testSetFile, vault, config);

      expect(result).not.toHaveProperty("error");
      if (!("error" in result)) {
        expect(result.tests_run).toBe(2);
        expect(result.successes + result.failures).toBe(2);
        expect(result.accuracy_percentage).toBeGreaterThanOrEqual(0);
        expect(result.accuracy_percentage).toBeLessThanOrEqual(100);
        expect(result.judge_version).toBe(1);
      }

      // Verify file was updated
      const updatedContent = await vault.read(testSetFile);
      expect(updatedContent).toContain("## Results (Judge v1)");
      expect(updatedContent).toContain("| ✅ |"); // Should have judge results
    });

    it("should return error for invalid test set", async () => {
      const invalidTestSetFile = await vault.create(
        "test-sets/invalid-test.md",
        "No table here",
      );

      const config = await resolveJudgeConfig(judgeFile.path, vault);
      if ("error" in config) {
        throw new Error(`Failed to resolve judge config: ${config.message}`);
      }

      const result = await evaluateTestSet(invalidTestSetFile, vault, config);

      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toBe("No table found");
      }
    });

    it("should handle abort signal", async () => {
      const testSetFile = await vault.create(
        "test-sets/abort-test.md",
        `| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|  
| ✅ | ⏳ | Test example | |`,
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
