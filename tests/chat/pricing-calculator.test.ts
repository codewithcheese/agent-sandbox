import { describe, it, expect } from "vitest";
import {
  calculateInputCost,
  calculateOutputCost,
  calculateTotalCost,
  formatCost,
} from "$lib/pricing-calculator.ts";
import type { ChatModel } from "../../src/settings/settings.ts";

describe("Pricing Calculator", () => {
  const mockModel: ChatModel = {
    id: "test-model",
    provider: "test",
    type: "chat",
    inputTokenLimit: 100000,
    outputTokenLimit: 4000,
    inputPrice: 5.0, // $5 per 1M tokens
    outputPrice: 20.0, // $20 per 1M tokens
  };

  it("should calculate input cost correctly", () => {
    const cost = calculateInputCost(1000, mockModel);
    // 1000 tokens * ($5 / 1,000,000) = $0.005
    expect(cost).toBe(0.005);
  });

  it("should calculate output cost correctly", () => {
    const cost = calculateOutputCost(1000, mockModel);
    // 1000 tokens * ($20 / 1,000,000) = $0.02
    expect(cost).toBe(0.02);
  });

  it("should calculate total cost correctly", () => {
    const cost = calculateTotalCost(1000, 500, mockModel);
    // Input: 1000 * ($5 / 1M) = $0.005
    // Output: 500 * ($20 / 1M) = $0.01
    // Total: $0.015
    expect(cost).toBe(0.015);
  });

  it("should return 0 for zero tokens", () => {
    expect(calculateInputCost(0, mockModel)).toBe(0);
    expect(calculateOutputCost(0, mockModel)).toBe(0);
    expect(calculateTotalCost(0, 0, mockModel)).toBe(0);
  });

  it("should format cost correctly", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.005)).toBe("$0.005000");
    expect(formatCost(0.12345)).toBe("$0.1235");
    expect(formatCost(1.23)).toBe("$1.2300");
  });

  it("should format very small costs with more precision", () => {
    expect(formatCost(0.000123)).toBe("$0.000123");
  });
});
