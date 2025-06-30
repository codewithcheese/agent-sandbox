import { vi } from "vitest";
import { MockTAbstractFile, MockTFile, MockTFolder } from "./mocks/obsidian.ts";
import { normalizePath } from "./mocks/normalize-path.ts";

// Mock normalizePath function from obsidian
vi.mock("obsidian", async (importOriginal) => {
  const obsidian = await importOriginal();
  return {
    ...(obsidian as object),
    normalizePath,
    TFile: MockTFile,
    TFolder: MockTFolder,
    TAbstractFile: MockTAbstractFile,
    Notice: class {},
  };
});
