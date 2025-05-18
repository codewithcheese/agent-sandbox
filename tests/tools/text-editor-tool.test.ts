// import { describe, it, expect, vi, beforeEach } from "vitest";
// import { vault, helpers } from "../mocks/obsidian";
// import "../mocks/ai-sdk";
//
// import type { ToolExecutionOptions } from "ai";
// import type { TFile } from "obsidian";
//
// // @ts-expect-error raw import not recognized by TypeScript
// import textEditorMd from "../../src/tools/Text Editor.md?raw";
// import { createTool, parseToolDefinition } from "../../src/tools";
//
// describe("Text Editor Tool", () => {
//   let testFile: TFile;
//   let toolFile: TFile;
//
//   const toolFilePath = "Text Editor.md";
//
//   const testFilePath = "test-file.txt";
//   const testFileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
//
//   const callOptions: ToolExecutionOptions = {
//     toolCallId: "test-tool-call-id",
//     messages: [],
//     abortSignal: undefined,
//   };
//
//   beforeEach(() => {
//     // Reset all mocks
//     vi.clearAllMocks();
//
//     // Clear the in-memory file system
//     helpers.reset();
//
//     // Create a tool file
//     helpers.addFile(toolFilePath, textEditorMd);
//     toolFile = vault.getFileByPath(toolFilePath) as TFile;
//
//     // Create a test file
//     helpers.addFile(testFilePath, testFileContent);
//     testFile = vault.getFileByPath(testFilePath) as TFile;
//   });
//
//   it("should view a file", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     const result = await tool.execute(
//       {
//         command: "view",
//         path: testFilePath,
//         file_text: undefined,
//         insert_line: undefined,
//         new_str: undefined,
//         old_str: undefined,
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("content");
//     expect(result.content).toContain("1: Line 1");
//     expect(result.content).toContain("5: Line 5");
//   });
//
//   it("should view a specific range of lines", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     const result = await tool.execute(
//       {
//         command: "view",
//         path: testFilePath,
//         file_text: undefined,
//         insert_line: undefined,
//         new_str: undefined,
//         old_str: undefined,
//         view_range: [2, 4],
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("content");
//     expect(result.content).toContain("2: Line 2");
//     expect(result.content).toContain("4: Line 4");
//     expect(result.content).not.toContain("1: Line 1");
//     expect(result.content).not.toContain("5: Line 5");
//   });
//
//   it("should create a new file", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     const newFilePath = "new-file.txt";
//     const newFileContent = "This is a new file";
//
//     const result = await tool.execute(
//       {
//         command: "create",
//         path: newFilePath,
//         file_text: newFileContent,
//         insert_line: undefined,
//         new_str: undefined,
//         old_str: undefined,
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("content");
//     expect(result.content).toContain("Successfully created file");
//
//     // Verify the file was created
//     const file = vault.getFileByPath(newFilePath);
//     expect(file).not.toBeNull();
//
//     // Verify the content
//     const content = await vault.read(file);
//     expect(content).toBe(newFileContent);
//   });
//
//   it("should replace text in a file", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     const result = await tool.execute(
//       {
//         command: "str_replace",
//         path: testFilePath,
//         file_text: undefined,
//         insert_line: undefined,
//         new_str: "Modified Line 3",
//         old_str: "Line 3",
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("content");
//     expect(result.content).toContain("Successfully replaced text");
//
//     // Verify the content was updated
//     const content = await vault.read(testFile);
//     expect(content).toContain("Modified Line 3");
//     // We can't use a simple not.toContain check because the replacement
//     // changes "Line 3" to "Modified Line 3" which still contains "Line 3"
//     // Instead, check that the exact standalone line "Line 3" is not present
//     const lines = content.split("\n");
//     expect(lines).not.toContain("Line 3");
//   });
//
//   it("should insert text at a specific line", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     const result = await tool.execute(
//       {
//         command: "insert",
//         path: testFilePath,
//         file_text: undefined,
//         insert_line: 3,
//         new_str: "Inserted Line",
//         old_str: undefined,
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("content");
//     expect(result.content).toContain("Successfully inserted text");
//
//     // Verify the content was updated
//     const content = await vault.read(testFile);
//     const lines = content.split("\n");
//     expect(lines.length).toBe(6); // Original 5 lines + 1 inserted
//     expect(lines[3]).toBe("Inserted Line");
//   });
//
//   it("should undo the last edit", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     // First make an edit
//     await tool.execute(
//       {
//         command: "str_replace",
//         path: testFilePath,
//         file_text: undefined,
//         insert_line: undefined,
//         new_str: "Modified Line 3",
//         old_str: "Line 3",
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     // Then undo it
//     const result = await tool.execute(
//       {
//         command: "undo_edit",
//         path: testFilePath,
//         file_text: undefined,
//         insert_line: undefined,
//         new_str: undefined,
//         old_str: undefined,
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("content");
//     expect(result.content).toContain("Successfully undid last edit");
//
//     // Verify the content was restored
//     const content = await vault.read(testFile);
//     expect(content).toContain("Line 3");
//     expect(content).not.toContain("Modified Line 3");
//   });
//
//   it("should return an error for non-existent file", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     const result = await tool.execute(
//       {
//         command: "view",
//         path: "non-existent-file.txt",
//         file_text: undefined,
//         insert_line: undefined,
//         new_str: undefined,
//         old_str: undefined,
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("error");
//     expect(result.error).toContain("not found");
//   });
//
//   it("should return an error for multiple occurrences of text to replace", async () => {
//     const toolDef = await parseToolDefinition(toolFile);
//     const { tool } = createTool(toolDef);
//
//     // Create a file with duplicate lines
//     const duplicateFilePath = "duplicate-lines.txt";
//     const duplicateContent = "Line 1\nLine 2\nLine 2\nLine 3";
//     helpers.addFile(duplicateFilePath, duplicateContent);
//
//     const result = await tool.execute(
//       {
//         command: "str_replace",
//         path: duplicateFilePath,
//         file_text: undefined,
//         insert_line: undefined,
//         new_str: "Modified Line 2",
//         old_str: "Line 2",
//         view_range: undefined,
//       },
//       callOptions,
//     );
//
//     expect(result).toHaveProperty("error");
//     expect(result.error).toContain("Multiple occurrences");
//   });
// });

export {};

