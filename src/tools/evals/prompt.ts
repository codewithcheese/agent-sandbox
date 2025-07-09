import { z } from "zod";
import { createDebug } from "$lib/debug";
import type { ToolCallOptionsWithContext, ToolDefinition } from "../types.ts";
import { generateText } from "ai";
import { getAccount, getChatModel } from "../../settings/utils.ts";
import { createAIProvider } from "../../settings/providers.ts";
import { createSystemContent } from "../../chat/system.ts";
import { usePlugin } from "$lib/utils";
import type { TFile } from "obsidian";
import { type ToolUIPart } from "ai";

const debug = createDebug();

// Define the UI tool type for the prompt tool
type PromptUITool = {
  input: {
    prompt_path: string;
    inputs: string[];
    temperature?: number;
    model_id?: string;
    account_name?: string;
  };
  output: {
    outputs: string[];
    totalProcessed: number;
    modelId: string;
    accountName: string;
  };
};

type PromptToolUIPart = ToolUIPart<{ Prompt: PromptUITool }>;

const TOOL_NAME = "Prompt";
const TOOL_DESCRIPTION =
  "Generate outputs from a prompt file and multiple input texts using a specified model.";
const TOOL_PROMPT_GUIDANCE = `Generate outputs from a prompt file and multiple input texts using a specified model.

This tool allows you to test prompts by providing multiple inputs and getting the generated outputs sequentially, along with model and account information for traceability.

Usage:
- Provide the absolute path to a prompt file (markdown file with prompt instructions)
- Provide an array of input texts to process with the prompt (minimum 1 required)
- Optionally specify model_id and account_name (defaults to plugin settings)
- The tool returns an array of generated outputs corresponding to each input
- Use temperature to control randomness

The prompt file should contain instructions for processing the input text. It can optionally specify a model_id in frontmatter to use a specific model.

Outputs are generated sequentially to ensure consistent performance and avoid rate limiting issues.`;

// Input Schema
const inputSchema = z.strictObject({
  prompt_path: z
    .string()
    .describe(
      "Absolute path to the prompt file (e.g., '/prompts/summarize.md')",
    ),
  inputs: z
    .array(z.string())
    .min(1, "At least one input is required")
    .describe("Array of input texts to process with the prompt"),
  temperature: z
    .number()
    .optional()
    .default(0.7)
    .describe("Optional temperature to use (defaults to 0.7)"),
  model_id: z
    .string()
    .optional()
    .describe("Optional model ID to use (defaults to plugin default)"),
  account_name: z
    .string()
    .optional()
    .describe("Optional account name to use (defaults to plugin default)"),
});

async function execute(
  params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
) {
  const { abortSignal } = toolExecOptions;
  const { vault, metadataCache } = toolExecOptions.getContext();

  if (!vault) {
    throw new Error("Vault not available in execution context.");
  }

  const plugin = usePlugin();

  // Get the prompt file
  debug(`Looking for prompt file at path: ${params.prompt_path}`);
  const promptFile = vault.getFileByPath(params.prompt_path);
  if (!promptFile) {
    throw new Error(
      `Could not find prompt file at path: ${params.prompt_path}`,
    );
  }

  // Get model and account configuration using overlay-aware metadata cache
  const metadata = metadataCache.getFileCache(promptFile);
  const frontmatter = metadata?.frontmatter || {};

  let modelId = params.model_id || frontmatter.model_id;
  let account, model;

  if (modelId) {
    try {
      model = getChatModel(modelId);
      // Find an account that supports this model's provider
      const foundAccount = plugin.settings.accounts.find(
        (a) => a.provider === model.provider,
      );
      if (!foundAccount) {
        throw new Error(
          `Model '${modelId}' (provider: ${model.provider}) requires an account for this provider`,
        );
      }
      account = foundAccount;
    } catch (error) {
      throw new Error(`Model '${modelId}' not configured`);
    }
  } else {
    // Use plugin defaults - check they exist first
    if (!plugin.settings.defaults.accountId) {
      throw new Error("Please configure a default account in plugin settings");
    }

    if (!plugin.settings.defaults.modelId) {
      throw new Error("Please configure a default model in plugin settings");
    }

    try {
      account = getAccount(plugin.settings.defaults.accountId);
      model = getChatModel(plugin.settings.defaults.modelId);
      modelId = model.id;
    } catch (error) {
      throw new Error("Configure default model and account in settings");
    }
  }

  // Create system content using overlay-aware vault and metadata cache
  const systemContent = await createSystemContent(
    promptFile,
    vault,
    metadataCache,
  );

  // Create provider
  const provider = createAIProvider(account);

  // Generate outputs sequentially for each input
  const outputs: string[] = [];

  for (let i = 0; i < params.inputs.length; i++) {
    const input = params.inputs[i];

    // Check for abort signal before each generation
    abortSignal.throwIfAborted();

    try {
      const result = await generateText({
        model: provider.languageModel(modelId),
        system: systemContent,
        prompt: input,
        temperature: params.temperature,
        abortSignal,
      });

      outputs.push(result.text);
      debug(`Generated output ${i + 1}/${params.inputs.length}`);
    } catch (error) {
      // If one generation fails, throw the underlying error directly
      throw error;
    }
  }

  return {
    outputs,
    totalProcessed: outputs.length,
    modelId: modelId!,
    accountName: account.name,
  };
}

export const promptTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: PromptToolUIPart) => {
    const { state, input } = toolPart;

    // Show model and input count during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      const inputCount = input?.inputs?.length || 0;
      const modelId = input?.model_id || "default";

      return {
        title: "Prompt",
        path: input?.prompt_path,
        context: `${modelId} • ${inputCount} inputs`,
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;

      // Handle success output (errors now go to output-error state)
      if (output && "totalProcessed" in output) {
        const { totalProcessed, modelId, accountName } = output;

        return {
          title: "Prompt",
          path: input?.prompt_path,
          context: `${modelId} • ${accountName}`,
          lines: `${totalProcessed} outputs generated`,
        };
      }
    }

    if (state === "output-error") {
      // For errors, we only have input model_id since output isn't available
      // But we can show what was attempted vs "default"
      const modelId = input?.model_id || "(using defaults)";

      // Extract and simplify error message
      let errorText = toolPart.errorText || "Unknown error";

      // Handle specific error types more concisely
      if (errorText === "Operation aborted") {
        errorText = "Cancelled";
      } else if (
        errorText.includes("AbortError") ||
        errorText.includes("cancelled")
      ) {
        errorText = "Cancelled";
      } else if (
        errorText.includes("Failed on input") &&
        errorText.includes("cancelled")
      ) {
        errorText = "Cancelled";
      } else if (errorText.startsWith("Failed on input")) {
        // Extract just the underlying error
        const match = errorText.match(/Failed on input \d+\/\d+:\s*(.+)$/);
        if (match) {
          errorText = match[1];
        }
      }

      return {
        title: "Prompt",
        path: input?.prompt_path,
        context: modelId,
        lines: errorText,
      };
    }

    return null;
  },
};
