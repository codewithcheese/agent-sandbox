/**
 * Token estimation utilities for calculating approximate token counts
 * Uses character-based estimation with 4 characters per token average
 */

const CHARS_PER_TOKEN = 4;

/**
 * Estimates token count from text using character-based approximation
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  
  // Use character count divided by average characters per token
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimates token count for multiple text segments
 * @param texts - Array of text segments
 * @returns Total estimated token count
 */
export function estimateTokenCountMultiple(texts: string[]): number {
  return texts.reduce((total, text) => total + estimateTokenCount(text), 0);
}
