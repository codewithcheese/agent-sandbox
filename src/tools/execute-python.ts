import { tool } from "ai";
import { z } from "zod";
import { PyodideExecutor } from "$lib/pyodide/executor.ts";

export const executePythonTool = tool({
  description: "Execute Python code using Pyodide",
  parameters: z.object({
    code: z.string().describe("The Python code to execute"),
    installPackages: z
      .array(z.string())
      .optional()
      .describe("Optional Python packages to install before execution"),
  }),
  execute: async ({ code, installPackages = [] }) => {
    try {
      console.log("Executing Python code:", code);
      const pyodide = new PyodideExecutor();
      console.log("Loading Pyodide...");
      await pyodide.load();

      console.log("Installing packages...");
      // Install any requested packages
      if (installPackages.length > 0) {
        for (const pkg of installPackages) {
          await pyodide.installPackage(pkg);
        }
      }

      console.log("Executing code...");
      // Execute the Python code
      const result = await pyodide.execute(code);

      return {
        success: result.success,
        result: result.result,
        stdout: result.stdout,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        stdout: "",
        error: error?.message || String(error),
      };
    }
  },
});
