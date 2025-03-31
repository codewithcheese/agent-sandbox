import { vi } from "vitest";

vi.mock("ai", () => ({
  tool: vi.fn().mockImplementation((config) => ({
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  })),
}));
