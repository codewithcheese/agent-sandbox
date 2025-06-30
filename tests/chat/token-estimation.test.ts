import { describe, it, expect } from "vitest";
import {
  estimateTokenCount,
  estimateTokenCountMultiple,
} from "$lib/token-estimation.ts";

describe("Token Estimation", () => {
  it("should estimate token count for simple text", () => {
    const text = "Hello world";
    const tokenCount = estimateTokenCount(text);

    // "Hello world" is 11 characters, so should be 3 tokens (11/4 = 2.75, rounded up to 3)
    expect(tokenCount).toBe(3);
  });

  it("should return 0 for empty text", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount("   ")).toBe(1); // 3 spaces = 1 token
  });

  it("should estimate token count for longer text", () => {
    const text =
      "This is a longer piece of text that should result in more tokens being estimated.";
    const tokenCount = estimateTokenCount(text);

    // 81 characters / 4 = 20.25, rounded up to 21
    expect(tokenCount).toBe(21);
  });

  it("should estimate token count for multiple texts", () => {
    const texts = ["Hello", "world", "test"];
    const totalTokens = estimateTokenCountMultiple(texts);

    // "Hello" (5) + "world" (5) + "test" (4) = 14 chars
    // Each text is calculated separately: ceil(5/4) + ceil(5/4) + ceil(4/4) = 2 + 2 + 1 = 5
    expect(totalTokens).toBe(5);
  });

  it("should handle empty array", () => {
    expect(estimateTokenCountMultiple([])).toBe(0);
  });
});
