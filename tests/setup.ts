import { vi } from "vitest";

// Mock normalizePath function from obsidian
vi.mock("obsidian", async (importOriginal) => {
  const obsidian = await importOriginal();
  return {
    ...(obsidian as object),
    normalizePath: (path: string) => path,
  };
});
