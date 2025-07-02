import { generateObject } from "ai";
import { normalizePath, Notice, type TFile, type Vault } from "obsidian";
import { createDebug } from "$lib/debug";
import { usePlugin } from "$lib/utils";
import { createSystemContent } from "../../chat/system.ts";
import { createAIProvider } from "../../settings/providers.ts";
import { getAccount, getChatModel } from "../../settings/utils.ts";
import type { AIAccount, ChatModel } from "../../settings/settings.ts";
import { unified } from "unified";
import { z } from "zod";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, Table, TableRow, TableCell } from "mdast";
import { resolveInternalLink } from "$lib/utils/obsidian.ts";

const debug = createDebug();

// Zod schema for evaluation response
const EvaluationResponseSchema = z.object({
  reasoning: z.string().min(1, "Reasoning must not be empty"),
  result: z.enum(["PASS", "FAIL"]),
});

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

export interface TestSetExample {
  expected: "PASS" | "FAIL";
  example: string;
}

export interface TestSetEvaluationResult {
  tests_run: number;
  successes: number;
  failures: number;
  accuracy_percentage: number;
  judge_version: number;
}

export interface EvaluatedExample {
  expected: "PASS" | "FAIL";
  judge_result: "PASS" | "FAIL";
  example: string;
  reasoning: string;
}

/**
 * Resolves judge configuration from judge agent file and settings
 */
export async function resolveJudgeConfig(
  judgeAgentPath: string,
  vault: Vault,
): Promise<JudgeConfig | EvaluationError> {
  const plugin = usePlugin();

  let judgeFile: TFile | null = null;

  // Check if this is a wiki link (starts with [[ and ends with ]])
  if (judgeAgentPath.startsWith("[[") && judgeAgentPath.endsWith("]]")) {
    // Handle wiki link format (from frontmatter)
    judgeFile = resolveInternalLink(judgeAgentPath, plugin);
    if (!judgeFile) {
      return {
        error: "Judge agent file not found",
        message: `Could not resolve judge agent link: ${judgeAgentPath}`,
      };
    }
  } else {
    // Handle absolute path format (from tool parameters)
    const normalizedJudgePath = normalizePath(judgeAgentPath);
    judgeFile = vault.getFileByPath(normalizedJudgePath);
    if (!judgeFile) {
      return {
        error: "Judge agent file not found",
        message: `Could not find judge agent file at path: ${judgeAgentPath}`,
      };
    }
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
  const judgeVersion = judgeFrontmatter.version || 1;

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
    // Create cacheable judge system content (without specific text)
    const judgeSystemContent = await createSystemContent(
      judgeConfig.judgeFile,
      {
        additionalData: {
          criteria_context: criteriaContext || "",
        },
      },
    );

    // Call the judge model with generateObject for structured output
    const provider = createAIProvider(judgeConfig.account);

    const result = await generateObject({
      model: provider.languageModel(judgeConfig.model.id),
      schema: EvaluationResponseSchema,
      messages: [
        {
          role: "system" as const,
          content: judgeSystemContent,
          providerOptions: {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          },
        },
        {
          role: "user" as const,
          content: `Text to evaluate:

${text}`,
        },
      ],
      maxRetries: 0,
      abortSignal,
    });

    const evaluationData = result.object;

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

/**
 * Extracts text content from a table cell node
 */
function extractCellText(cell: TableCell): string {
  // Extract text from all text nodes in the cell
  let text = "";

  function visitNode(node: any): void {
    if (node.type === "text") {
      text += node.value;
    } else if (node.children) {
      node.children.forEach(visitNode);
    }
  }

  cell.children.forEach(visitNode);
  return text.trim();
}

/**
 * Parses test set markdown file to extract examples from first table
 */
export function parseTestSetTable(
  content: string,
): TestSetExample[] | EvaluationError {
  try {
    // Parse markdown content with GFM support for tables
    const processor = unified().use(remarkParse).use(remarkGfm);
    const ast = processor.parse(content) as Root;

    // Find the first table in the AST
    let firstTable: Table | null = null;

    function visitNode(node: any): void {
      if (node.type === "table" && !firstTable) {
        firstTable = node as Table;
      } else if (node.children) {
        node.children.forEach(visitNode);
      }
    }

    ast.children.forEach(visitNode);

    if (!firstTable) {
      return {
        error: "No table found",
        message: "Test set file must contain at least one markdown table",
      };
    }

    // Extract data rows (skip header row)
    const dataRows = firstTable.children.slice(1); // Skip header row

    if (dataRows.length === 0) {
      return {
        error: "No data rows found",
        message:
          "Test set table must contain at least one data row with examples",
      };
    }

    const examples: TestSetExample[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] as TableRow;
      const cells = row.children as TableCell[];

      if (cells.length < 3) {
        return {
          error: "Invalid table format",
          message: `Row ${i + 1} must have at least 3 columns (Expected, Judge, Example). Found ${cells.length} columns.`,
        };
      }

      const expectedCell = extractCellText(cells[0]);
      const exampleCell = extractCellText(cells[2]); // Third column is Example

      // Validate expected value (must be emoji)
      let expected: "PASS" | "FAIL";
      if (expectedCell === "✅") {
        expected = "PASS";
      } else if (expectedCell === "❌") {
        expected = "FAIL";
      } else {
        return {
          error: "Invalid expected value",
          message: `Row ${i + 1}: Expected column must contain ✅ (for PASS) or ❌ (for FAIL). Found: "${expectedCell}"`,
        };
      }

      // Validate example is not empty
      if (!exampleCell || exampleCell.trim() === "") {
        return {
          error: "Empty example text",
          message: `Row ${i + 1}: Example column cannot be empty`,
        };
      }

      examples.push({
        expected,
        example: exampleCell.trim(),
      });
    }

    return examples;
  } catch (error) {
    debug(`Error parsing markdown table:`, error);
    return {
      error: "Markdown parsing failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validates test set table format and content
 */
export function validateTestSetTable(content: string): true | EvaluationError {
  const parseResult = parseTestSetTable(content);

  if ("error" in parseResult) {
    return parseResult;
  }

  if (parseResult.length === 0) {
    return {
      error: "No examples found",
      message: "Test set must contain at least one example",
    };
  }

  return true;
}

/**
 * Generates results table markdown with evaluated examples
 */
export function generateResultsTable(
  evaluatedExamples: EvaluatedExample[],
  judgeVersion: number,
): string {
  const successes = evaluatedExamples.filter(
    (ex) => ex.expected === ex.judge_result,
  ).length;
  const total = evaluatedExamples.length;
  const percentage = Math.round((successes / total) * 100);

  let markdown = `## Results (Judge v${judgeVersion}) - ${successes}/${total} (${percentage}%)\n\n`;

  // Table header
  markdown += "| Expected | Judge | Example | Reasoning |\n";
  markdown += "|----------|-------|---------|-----------|\n";

  // Table rows
  for (const example of evaluatedExamples) {
    const expectedEmoji = example.expected === "PASS" ? "✅" : "❌";
    const judgeEmoji = example.judge_result === "PASS" ? "✅" : "❌";

    // Escape pipe characters in content
    const exampleText = example.example.replace(/\|/g, "\\|");
    // Truncate reasoning for table readability (safety measure)
    const reasoningText = example.reasoning
      .replace(/\|/g, "\\|")
      .substring(0, 500);

    markdown += `| ${expectedEmoji} | ${judgeEmoji} | ${exampleText} | ${reasoningText} |\n`;
  }

  markdown += "\n";
  return markdown;
}

/**
 * Updates test set file by prepending new results
 */
export async function updateTestSetFile(
  testSetFile: TFile,
  vault: Vault,
  evaluatedExamples: EvaluatedExample[],
  judgeVersion: number,
): Promise<void | EvaluationError> {
  try {
    const currentContent = await vault.read(testSetFile);
    const newResultsTable = generateResultsTable(
      evaluatedExamples,
      judgeVersion,
    );

    // Find where to insert (after frontmatter if it exists)
    const frontmatterMatch = currentContent.match(
      /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
    );
    let insertPosition = 0;

    if (frontmatterMatch) {
      insertPosition = frontmatterMatch[0].length;
    }

    // Insert new results at the beginning (after frontmatter)
    const beforeInsert = currentContent.substring(0, insertPosition);
    const afterInsert = currentContent.substring(insertPosition);

    const updatedContent = beforeInsert + newResultsTable + afterInsert;

    await vault.modify(testSetFile, updatedContent);
  } catch (error) {
    return {
      error: "Failed to update test set file",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Evaluates all examples in a test set
 */
export async function evaluateTestSet(
  testSetFile: TFile,
  vault: Vault,
  judgeConfig: JudgeConfig,
  abortSignal?: AbortSignal,
): Promise<TestSetEvaluationResult | EvaluationError> {
  try {
    // Read and parse test set file
    const content = await vault.read(testSetFile);
    const examples = parseTestSetTable(content);

    if ("error" in examples) {
      return examples;
    }

    // Evaluate each example sequentially
    const evaluatedExamples: EvaluatedExample[] = [];

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];

      if (abortSignal?.aborted) {
        return {
          error: "Operation aborted",
          message: "Test set evaluation was aborted by user",
        };
      }

      const result = await evaluateExample(
        example.example,
        judgeConfig,
        undefined, // No criteria context for test sets
        abortSignal,
      );

      if ("error" in result) {
        return {
          error: "Evaluation failed",
          message: `Failed to evaluate example ${i + 1}: ${result.message}`,
        };
      }

      evaluatedExamples.push({
        expected: example.expected,
        judge_result: result.result,
        example: example.example,
        reasoning: result.reasoning,
      });

      // Show progress notice
      const isCorrect = example.expected === result.result;
      const statusIcon = isCorrect ? "✅" : "❌";
      new Notice(
        `${statusIcon} Example ${i + 1}/${examples.length}: ${result.result}`,
        2000, // Show for 2 seconds
      );
    }

    // Update the test set file with results
    const updateResult = await updateTestSetFile(
      testSetFile,
      vault,
      evaluatedExamples,
      judgeConfig.judgeVersion,
    );

    if (updateResult && "error" in updateResult) {
      return updateResult;
    }

    // Calculate final statistics
    const successes = evaluatedExamples.filter(
      (ex) => ex.expected === ex.judge_result,
    ).length;
    const failures = evaluatedExamples.length - successes;
    const accuracy_percentage = Math.round(
      (successes / evaluatedExamples.length) * 100,
    );

    return {
      tests_run: evaluatedExamples.length,
      successes,
      failures,
      accuracy_percentage,
      judge_version: judgeConfig.judgeVersion,
    };
  } catch (error) {
    debug(`Error in evaluateTestSet:`, error);

    if (
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      return {
        error: "Operation aborted",
        message: "Test set evaluation was aborted by user",
      };
    }

    return {
      error: "Test set evaluation failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
