/**
 * Pricing calculation utilities for estimating LLM costs
 */

import type { ChatModel } from "../settings/settings.ts";

/**
 * Calculates the cost for input tokens using a chat model's pricing
 * @param tokenCount - Number of input tokens
 * @param model - Chat model with pricing information
 * @returns Cost in dollars
 */
export function calculateInputCost(tokenCount: number, model: ChatModel): number {
  if (tokenCount <= 0) {
    return 0;
  }
  
  // Model prices are per 1M tokens, convert to per token
  const costPerToken = model.inputPrice / 1_000_000;
  return tokenCount * costPerToken;
}

/**
 * Calculates the cost for output tokens using a chat model's pricing
 * @param tokenCount - Number of output tokens
 * @param model - Chat model with pricing information
 * @returns Cost in dollars
 */
export function calculateOutputCost(tokenCount: number, model: ChatModel): number {
  if (tokenCount <= 0) {
    return 0;
  }
  
  // Model prices are per 1M tokens, convert to per token
  const costPerToken = model.outputPrice / 1_000_000;
  return tokenCount * costPerToken;
}

/**
 * Calculates the total cost for both input and output tokens
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param model - Chat model with pricing information
 * @returns Total cost in dollars
 */
export function calculateTotalCost(
  inputTokens: number,
  outputTokens: number,
  model: ChatModel
): number {
  return calculateInputCost(inputTokens, model) + calculateOutputCost(outputTokens, model);
}

/**
 * Formats a cost value for display
 * @param cost - Cost in dollars
 * @returns Formatted cost string (e.g., "$0.0012" or "$1.23")
 */
export function formatCost(cost: number): string {
  if (cost === 0) {
    return "$0.00";
  }
  
  if (cost < 0.01) {
    // For very small costs, show more decimal places
    return `$${cost.toFixed(6)}`;
  }
  
  return `$${cost.toFixed(4)}`;
}
