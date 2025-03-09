import { tool } from "ai";
import { z } from "zod";
import { fileTree } from "$lib/utils/fileTree";

export const listFilesTool = tool({
  description: "List files in a directory in the Obsidian vault",
  parameters: z.object({
    path: z.string().describe("The path to the directory to list files from"),
  }),
  execute: async ({ path }) => {
    try {
      // Coerce '.' into '/' since there's no concept of working directory in Obsidian
      const normalizedPath = path === '.' ? '/' : path;
      const result = await fileTree(normalizedPath);
      return { result };
    } catch (error) {
      return { error: `Failed to list files: ${error.message}` };
    }
  },
});
