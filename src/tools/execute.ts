import { PyodideExecutor } from "$lib/pyodide/executor";
import { errorToString } from "$lib/utils/error.ts";

export * from "./reddit.ts";

export async function executePython({ code, installPackages = [] }) {
  try {
    const pyodide = new PyodideExecutor();
    await pyodide.load();

    // Install any requested packages
    if (installPackages.length > 0) {
      for (const pkg of installPackages) {
        await pyodide.installPackage(pkg);
      }
    }

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
      error: errorToString(error),
    };
  }
}
