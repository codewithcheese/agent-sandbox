import { tool } from "ai";
import { z } from "zod";
import { usePlugin } from "$lib/utils";

export const readFileTool = 
  tool({
    description: "Read the contents of a file in the Obsidian vault",
    parameters: z.object({
      path: z.string().describe("The path to the file to read"),
    }),
    execute: async ({ path }) => {
      try {
        const plugin = usePlugin();
        // Remove leading slash if present as Obsidian doesn't support root path syntax
        const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
        const file = plugin.app.vault.getFileByPath(normalizedPath);
        if (!file) {
          return { error: `File not found: ${path}` };
        }
        const content = await plugin.app.vault.read(file);
        return { content };
      } catch (error) {
        return { error: `Failed to read file: ${error.message}` };
      }
    },
  });
