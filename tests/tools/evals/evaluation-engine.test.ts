// mocks
import { plugin, vault } from "../../mocks/obsidian.ts";

import { beforeEach, describe, expect, it } from "vitest";
import { useRecording } from "../../use-recording.ts";
import {
  resolveJudgeConfig,
  evaluateExample,
  parseEvaluationResult,
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
      "judges/test-judge.md",
      `---
judge_version: 1
model_id: claude-4-sonnet-20250514
---

Evaluate whether the provided text demonstrates clear, concise writing.

Criteria:
- Uses simple, direct language
- Avoids unnecessary jargon
- Gets to the point quickly

Text to evaluate: {{ text }}

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
        expect(config.judgeFile.path).toBe(judgeFile.path);
        expect(config.judgeVersion).toBe(1);
      }
    });

    it("should resolve judge config with default model", async () => {
      // Create judge without explicit model_id
      const defaultJudgeFile = await vault.create(
        "judges/default-judge.md",
        `---
judge_version: 2
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
        "judges/invalid-judge.md",
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


});
