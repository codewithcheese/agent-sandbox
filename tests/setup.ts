import { vi } from "vitest";
import { MockTFile, MockTFolder } from "./mocks/obsidian.ts";

// Mock normalizePath function from obsidian
vi.mock("obsidian", async (importOriginal) => {
  const obsidian = await importOriginal();
  return {
    ...(obsidian as object),
    normalizePath: (path: string) => path,
    TFile: MockTFile,
    TFolder: MockTFolder,
  };
});
