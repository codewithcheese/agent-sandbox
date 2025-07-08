import { z } from "zod";
import { normalizePath } from "obsidian";
import { createDebug } from "$lib/debug";
import type { ToolCallOptionsWithContext, ToolDefinition } from "../types.ts";
import {
  evaluateTestSet,
  resolveJudgeConfig,
  validateTestSetTable,
} from "./evaluation-engine.ts";
import { type ToolUIPart } from "ai";

const debug = createDebug();

// Define the UI tool type for the evaluate test set tool
type EvaluateTestSetUITool = {
  input: {
    test_set_path: string;
    judge_agent_path: string;
  };
  output: {
    passed: number;
    failed: number;
    total: number;
    accuracy: number;
    test_set_path: string;
    judge_agent_path: string;
  } | {
    error: string;
    message?: string;
  };
};

type EvaluateTestSetToolUIPart = ToolUIPart<{ EvaluateTestSet: EvaluateTestSetUITool }>;

const TOOL_NAME = "EvaluateTestSet";
const TOOL_DESCRIPTION =
  "Evaluate all examples in a test set file against judge criteria using an LLM judge agent.";
const TOOL_PROMPT_GUIDANCE = `Evaluate all examples in a test set file against judge criteria using an LLM judge agent.

This tool processes a test set markdown file containing a table of examples and evaluates each one using a judge agent. It updates the test set file with results and provides summary statistics.

Usage:
- Provide the path to a test set markdown file (must contain a table with Expected, Judge, Example, Reasoning columns)
- Specify the path to a judge agent file (markdown file with evaluation instructions)
- The tool will evaluate all examples sequentially and update the test set file with results

Test Set Format:
The test set file must contain a markdown table as the first table with these columns in order:
1. Expected: ✅ (for PASS) or ❌ (for FAIL)
2. Judge: Will be populated with evaluation results
3. Example: The text to evaluate
4. Reasoning: Will be populated with judge's reasoning

The tool will prepend a new results table to the file and return summary statistics.

Requirements:
- Test set file must exist and contain a valid table
- Judge agent file must exist and be properly configured
- All examples must have non-empty text
- Expected column must only contain ✅ or ❌ emojis

The judge agent file should contain evaluation instructions and criteria. It can optionally specify a model_id in frontmatter to use a specific model for evaluation.`;

// Input Schema
const inputSchema = z.strictObject({
  test_set_path: z
    .string()
    .describe(
      "Path to the test set markdown file (e.g., '/test-sets/internal-notes-style.md')",
    ),
  judge_agent_path: z
    .string()
    .describe(
      "Path to the judge agent file (e.g., '/judges/internal-notes-judge.md')",
    ),
});

async function execute(
  params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
) {
  const { abortSignal } = toolExecOptions;
  const { vault, metadataCache } = toolExecOptions.getContext();

  if (!vault) {
    return { error: "Vault not available in execution context." };
  }

  try {
    // Validate test set file exists
    const normalizedTestSetPath = normalizePath(params.test_set_path);
    const testSetFile = vault.getFileByPath(normalizedTestSetPath);

    if (!testSetFile) {
      return {
        error: "Test set file not found",
        message: `Could not find test set file at path: ${params.test_set_path}`,
      };
    }

    // Validate test set file format
    const testSetContent = await vault.read(testSetFile);
    const validationResult = validateTestSetTable(testSetContent);

    if (validationResult !== true) {
      return validationResult;
    }

    // Resolve judge configuration
    const judgeConfig = await resolveJudgeConfig(
      params.judge_agent_path,
      vault,
    );
    if ("error" in judgeConfig) {
      return judgeConfig;
    }

    // Evaluate the test set
    return await evaluateTestSet(
      testSetFile,
      vault,
      metadataCache,
      judgeConfig,
      abortSignal,
    );
  } catch (error) {
    debug(`Error in EvaluateTestSet:`, error);

    return {
      error: "Test set evaluation failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const evaluateTestSetTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: EvaluateTestSetToolUIPart, streamingInfo) => {
    const { state, input } = toolPart;

    // Helper function to get test set name from path
    const getTestSetName = (testSetPath: string) => {
      const parts = testSetPath.split('/');
      const filename = parts[parts.length - 1];
      return filename?.replace(/\.(md|txt)$/, '') || 'test-set';
    };

    // Show test set name during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      const testSetName = input?.test_set_path ? getTestSetName(input.test_set_path) : "test-set";
      
      return {
        title: "EvaluateTestSet",
        path: input?.test_set_path,
        context: testSetName,
        tokenCount: streamingInfo?.tokenCount,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;
      
      // Handle error output
      if (output && 'error' in output) {
        return {
          title: "EvaluateTestSet",
          path: input?.test_set_path,
          context: "(error)",
        };
      }
      
      // Handle success output
      if (output && 'total' in output) {
        const { passed, total } = output;
        
        return {
          title: "EvaluateTestSet",
          path: input?.test_set_path,
          lines: `${passed}/${total} passed`,
        };
      }
    }

    if (state === "output-error") {
      return {
        title: "EvaluateTestSet",
        path: input?.test_set_path,
        context: "(error)",
      };
    }

    return null;
  },
};
