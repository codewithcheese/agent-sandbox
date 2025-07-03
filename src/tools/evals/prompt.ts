import { z } from "zod";
import { createDebug } from "$lib/debug";
import type { ToolCallOptionsWithContext, ToolDefinition } from "../types.ts";
import { generateText } from "ai";
import { getAccount, getChatModel } from "../../settings/utils.ts";
import { createAIProvider } from "../../settings/providers.ts";
import { createSystemContent } from "../../chat/system.ts";
import { usePlugin } from "$lib/utils";
import type { TFile } from "obsidian";

const debug = createDebug();

const TOOL_NAME = "Prompt";
const TOOL_DESCRIPTION =
  "Generate output from a prompt file and input text using a specified model.";
const TOOL_PROMPT_GUIDANCE = `Generate output from a prompt file and input text using a specified model.

This tool allows you to test prompts by providing an input and getting the generated output, along with model and account information for traceability.

Usage:
- Provide the absolute path to a prompt file (markdown file with prompt instructions)
- Provide the input text to process with the prompt
- Optionally specify model_id and account_name (defaults to plugin settings)
- The tool returns the generated output along with model and account metadata

The prompt file should contain instructions for processing the input text. It can optionally specify a model_id in frontmatter to use a specific model.`;

// Input Schema
const inputSchema = z.strictObject({
  prompt_path: z
    .string()
    .describe(
      "Absolute path to the prompt file (e.g., '/prompts/summarize.md')",
    ),
  input: z.string().describe("The input text to process with the prompt"),
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
  const { vault } = toolExecOptions.getContext();

  if (!vault) {
    return { error: "Vault not available in execution context." };
  }

  try {
    const plugin = usePlugin();
    
    // Get the prompt file
    debug(`Looking for prompt file at path: ${params.prompt_path}`);
    const promptFile = vault.getFileByPath(params.prompt_path);
    if (!promptFile) {
      return {
        error: "Prompt file not found",
        message: `Could not find prompt file at path: ${params.prompt_path}`,
      };
    }

    // Get model and account configuration
    const metadata = plugin.app.metadataCache.getFileCache(promptFile);
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
          return {
            error: "No account found for model",
            message: `Model '${modelId}' (provider: ${model.provider}) requires an account for this provider`,
          };
        }
        account = foundAccount;
      } catch (error) {
        return {
          error: "Invalid model",
          message: `Model '${modelId}' is not configured`,
        };
      }
    } else {
      // Use plugin defaults - check they exist first
      if (!plugin.settings.defaults.accountId) {
        return {
          error: "Default account not configured",
          message: "Please configure a default account in plugin settings",
        };
      }
      
      if (!plugin.settings.defaults.modelId) {
        return {
          error: "Default model not configured",
          message: "Please configure a default model in plugin settings",
        };
      }
      
      try {
        account = getAccount(plugin.settings.defaults.accountId);
        model = getChatModel(plugin.settings.defaults.modelId);
        modelId = model.id;
      } catch (error) {
        return {
          error: "Default model/account not configured",
          message: "Please configure default model and account in plugin settings",
        };
      }
    }

    // Create system content using project standards
    const systemContent = await createSystemContent(promptFile);
    
    // Create provider and generate output
    const provider = createAIProvider(account);
    const result = await generateText({
      model: provider.languageModel(modelId),
      system: systemContent,
      prompt: params.input,
      abortSignal,
    });

    return {
      output: result.text,
    };
  } catch (error) {
    debug(`Error in Prompt:`, error);

    if (error?.name === "AbortError") {
      return { error: "Operation aborted" };
    }

    return {
      error: "Prompt generation failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const promptTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
};
