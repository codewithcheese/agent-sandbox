import { generateText } from "ai";
import { normalizePath, type TFile, type Vault } from "obsidian";
import { createDebug } from "$lib/debug";
import { usePlugin } from "$lib/utils";
import { createSystemContent } from "../../chat/system.ts";
import { createAIProvider } from "../../settings/providers.ts";
import { getAccount, getChatModel } from "../../settings/utils.ts";
import type { AIAccount, ChatModel } from "../../settings/settings.ts";

const debug = createDebug();

export interface EvaluationResult {
  result: "PASS" | "FAIL";
  reasoning: string;
  judge_version: number;
  judge_model: string;
  judge_account: string;
}

export interface EvaluationError {
  error: string;
  message: string;
}

export interface JudgeConfig {
  account: AIAccount;
  model: ChatModel;
  judgeFile: TFile;
  judgeVersion: number;
}

/**
 * Resolves judge configuration from judge agent file and settings
 */
export async function resolveJudgeConfig(
  judgeAgentPath: string,
  vault: Vault,
): Promise<JudgeConfig | EvaluationError> {
  const plugin = usePlugin();

  // Resolve and validate judge agent file
  const normalizedJudgePath = normalizePath(judgeAgentPath);
  const judgeFile = vault.getFileByPath(normalizedJudgePath);

  if (!judgeFile) {
    return {
      error: "Judge agent file not found",
      message: `Could not find judge agent file at path: ${judgeAgentPath}`,
    };
  }

  // Get judge agent metadata for model configuration
  const judgeMetadata = plugin.app.metadataCache.getFileCache(judgeFile);
  const judgeFrontmatter = judgeMetadata?.frontmatter || {};

  // Determine which model and account to use
  let account: AIAccount, model: ChatModel;

  if (judgeFrontmatter.model_id) {
    // Judge specifies a specific model
    try {
      model = getChatModel(judgeFrontmatter.model_id);
      // Find an account that supports this model's provider
      const foundAccount = plugin.settings.accounts.find(
        (a) => a.provider === model.provider,
      );
      if (!foundAccount) {
        return {
          error: "No account found for judge model",
          message: `Judge specifies model '${judgeFrontmatter.model_id}' (provider: ${model.provider}) but no account found for this provider`,
        };
      }
      account = foundAccount;
    } catch (error) {
      return {
        error: "Invalid judge model",
        message: `Judge specifies model_id '${judgeFrontmatter.model_id}' but this model is not configured`,
      };
    }
  } else {
    // Use default account and model from settings
    if (
      !plugin.settings.defaults.accountId ||
      !plugin.settings.defaults.modelId
    ) {
      return {
        error: "No default model configured",
        message:
          "Judge agent file does not specify model_id and no default account/model is configured in settings",
      };
    }

    try {
      account = getAccount(plugin.settings.defaults.accountId);
      model = getChatModel(plugin.settings.defaults.modelId);
    } catch (error) {
      return {
        error: "Invalid default configuration",
        message: `Default account or model configuration is invalid: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Get judge version if available
  const judgeVersion = judgeFrontmatter.judge_version || 1;

  return {
    account,
    model,
    judgeFile,
    judgeVersion,
  };
}

/**
 * Parses evaluation result from judge response text
 */
export function parseEvaluationResult(evaluationText: string): "PASS" | "FAIL" {
  // Extract PASS/FAIL result with fuzzy matching
  const passRegex =
    /\b(pass|passed|passes|passing|success|successful|accept|accepted|good|correct|valid)\b/i;
  const failRegex =
    /\b(fail|failed|fails|failing|failure|reject|rejected|bad|incorrect|invalid|wrong)\b/i;

  if (passRegex.test(evaluationText) && !failRegex.test(evaluationText)) {
    return "PASS";
  } else if (
    failRegex.test(evaluationText) &&
    !passRegex.test(evaluationText)
  ) {
    return "FAIL";
  } else {
    // If both or neither are found, try to extract from the end of the text
    const lastLine =
      evaluationText.split("\n").pop()?.trim().toLowerCase() || "";
    if (lastLine.includes("pass")) {
      return "PASS";
    } else if (lastLine.includes("fail")) {
      return "FAIL";
    } else {
      // Default to FAIL if unclear
      return "FAIL";
    }
  }
}

/**
 * Evaluates a single text example using a judge agent
 */
export async function evaluateExample(
  text: string,
  judgeConfig: JudgeConfig,
  criteriaContext?: string,
  abortSignal?: AbortSignal,
): Promise<EvaluationResult | EvaluationError> {
  try {
    // Create judge system content with JSON schema instruction
    const judgeSystemContent = await createSystemContent(
      judgeConfig.judgeFile,
      {
        additionalData: {
          text,
          criteria_context: criteriaContext || "",
          json_schema: `{
  "reasoning": "Your detailed reasoning for the evaluation",
  "result": "PASS or FAIL"
}`,
        },
      },
    );

    // Add JSON instruction to the system content
    const systemContentWithJsonInstruction = `${judgeSystemContent}

Provide your evaluation as JSON following this exact schema:
{
  "reasoning": "Your detailed reasoning for the evaluation",
  "result": "PASS or FAIL"
}

Respond with valid JSON only.`;

    // Prepare messages for judge evaluation
    const messages = [
      {
        role: "user" as const,
        content: systemContentWithJsonInstruction,
      },
      {
        role: "assistant" as const,
        content: "{",
      },
    ];

    // Call the judge model
    const provider = createAIProvider(judgeConfig.account);

    const textResult = await generateText({
      model: provider.languageModel(judgeConfig.model.id),
      messages,
      maxRetries: 0,
      abortSignal,
    });

    // Parse the JSON response
    const fullJsonText = "{" + textResult.text;
    let evaluationData;

    try {
      evaluationData = JSON.parse(fullJsonText);
    } catch (parseError) {
      debug("Failed to parse JSON response:", fullJsonText);
      // Fallback to text parsing
      const result = parseEvaluationResult(textResult.text);
      return {
        result,
        reasoning: `${textResult.text}\n\n[Note: Could not parse JSON response, used fallback parsing]`,
        judge_version: judgeConfig.judgeVersion,
        judge_model: judgeConfig.model.id,
        judge_account: judgeConfig.account.name,
      };
    }

    // Validate the parsed JSON
    if (!evaluationData.reasoning || !evaluationData.result) {
      return {
        error: "Invalid evaluation response",
        message: "Judge response missing required fields (reasoning, result)",
      };
    }

    // Normalize the result
    const normalizedResult = parseEvaluationResult(evaluationData.result);

    return {
      result: normalizedResult,
      reasoning: evaluationData.reasoning,
      judge_version: judgeConfig.judgeVersion,
      judge_model: judgeConfig.model.id,
      judge_account: judgeConfig.account.name,
    };
  } catch (error) {
    debug(`Error in evaluateExample:`, error);

    if (
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      return {
        error: "Operation aborted",
        message: "Evaluation was aborted by user",
      };
    }

    return {
      error: "Evaluation failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}


