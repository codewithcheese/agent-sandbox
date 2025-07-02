import { z } from "zod";
import { createDebug } from "$lib/debug";
import type { ToolCallOptionsWithContext, ToolDefinition } from "../types.ts";
import { evaluateExample, resolveJudgeConfig } from "./evaluation-engine.ts";

const debug = createDebug();

const TOOL_NAME = "EvaluateExample";
const TOOL_DESCRIPTION =
  "Evaluate a single text example against judge criteria using an LLM judge agent.";
const TOOL_PROMPT_GUIDANCE = `Evaluate a single text example against judge criteria using an LLM judge agent.

This tool allows you to quickly test whether a piece of text meets your evaluation criteria by running it through a judge agent during conversation development.

Usage:
- Provide the text to evaluate
- Specify the path to a judge agent file (markdown file with evaluation instructions)
- Optionally provide additional criteria context
- The judge will return PASS/FAIL with reasoning

The judge agent file should contain evaluation instructions and criteria. It can optionally specify a model_id in frontmatter to use a specific model for evaluation.`;

// Input Schema
const inputSchema = z.strictObject({
  text: z
    .string()
    .describe("The text content to evaluate against the judge criteria"),
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

  try {
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
      params.text,
      judgeConfig,
      params.criteria_context,
      abortSignal,
    );
  } catch (error) {
    debug(`Error in EvaluateExample:`, error);

    return {
      error: "Evaluation failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const evaluateExampleTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
};
