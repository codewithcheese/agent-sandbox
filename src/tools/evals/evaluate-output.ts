import { z } from "zod";
import { createDebug } from "$lib/debug";
import type { ToolCallOptionsWithContext, ToolDefinition } from "../types.ts";
import { evaluateExample, resolveJudgeConfig } from "./evaluation-engine.ts";
import { createSystemContent } from "../../chat/system.ts";

const debug = createDebug();

const TOOL_NAME = "EvaluateOutput";
const TOOL_DESCRIPTION =
  "Evaluate a single text output (provided directly or from a file) against judge criteria using an LLM judge agent.";
const TOOL_PROMPT_GUIDANCE = `Evaluate a single text output against judge criteria using an LLM judge agent.

This tool allows you to quickly test whether a piece of text output meets your evaluation criteria by running it through a judge agent during conversation development.

Usage:
- Provide either direct text OR a file path containing the text to evaluate (exactly one required)
- Specify the path to a judge agent file (markdown file with evaluation instructions)
- Optionally provide additional criteria context
- The judge will return PASS/FAIL with reasoning

Input Options:
- 'text': Direct text content to evaluate
- 'path': Path to a file containing the text to evaluate

The judge agent file should contain evaluation instructions and criteria. It can optionally specify a model_id in frontmatter to use a specific model for evaluation.`;

// Input Schema
const inputSchema = z.strictObject({
  text: z
    .string()
    .optional()
    .describe("The text output to evaluate against the judge criteria"),
  path: z
    .string()
    .optional()
    .describe("Path to a file containing the text output to evaluate"),
  judge_agent_path: z
    .string()
    .describe(
      "Path to the judge agent file (e.g., '/judges/internal-notes-judge.md')",
    ),
  criteria_context: z
    .string()
    .optional()
    .describe(
      "Optional additional context or criteria to provide to the judge",
    ),
});

async function execute(
  params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
) {
  const { abortSignal } = toolExecOptions;
  const { vault } = toolExecOptions.getContext();

  if (!vault) {
    return { error: "Vault not available in execution context." };
  }

  // Validate that exactly one of text or path is provided
  const hasText = !!params.text;
  const hasPath = !!params.path;
  
  if (!hasText && !hasPath) {
    return {
      error: "Missing input",
      message: "Either 'text' or 'path' must be provided",
    };
  }
  
  if (hasText && hasPath) {
    return {
      error: "Invalid input",
      message: "Only one of 'text' or 'path' can be provided, not both",
    };
  }

  try {
    // Get text content from either direct text or file path
    let textToEvaluate: string;
    
    if (params.text) {
      textToEvaluate = params.text;
    } else if (params.path) {
      // Read and process text from file using createSystemContent
      const file = vault.getFileByPath(params.path);
      if (!file) {
        return {
          error: "File not found",
          message: `Could not find file at path: ${params.path}`,
        };
      }
      textToEvaluate = await createSystemContent(file);
    } else {
      // This should never happen due to validation above
      throw new Error("Invalid state: neither text nor path provided");
    }

    // Resolve judge configuration
    const judgeConfig = await resolveJudgeConfig(
      params.judge_agent_path,
      vault,
    );
    if ("error" in judgeConfig) {
      return judgeConfig;
    }

    // Evaluate the example
    return await evaluateExample(
      textToEvaluate,
      judgeConfig,
      params.criteria_context,
      abortSignal,
    );
  } catch (error) {
    debug(`Error in EvaluateOutput:`, error);

    return {
      error: "Evaluation failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const evaluateOutputTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
};
