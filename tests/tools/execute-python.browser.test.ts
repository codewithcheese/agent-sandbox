import { describe, it, expect } from "vitest";
import { executePython } from "../../src/tools/execute.ts";

describe("Execute Python Tool Tests", () => {
  const options = {
    toolCallId: "test-tool-call-id",
    messages: [],
    abortSignal: undefined,
  };

  it("should execute basic Python code", async () => {
    const result = await executePython({ code: "1 + 2" });

    expect(result.success).toBe(true);
    expect(result.result).toBe(3);
    expect(result.error).toBeUndefined();
  });

  it("should handle print statements and capture stdout", async () => {
    const result = await executePython({
      code: `
        print("Hello from Python!")
        print("Multiple lines")
        print("of output")
      `,
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("Hello from Python!");
    expect(result.stdout).toContain("Multiple lines");
    expect(result.stdout).toContain("of output");
  });

  it("should handle errors gracefully", async () => {
    const result = await executePython({
      code: `
        # This will raise a NameError
        undefined_variable
      `,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("NameError");
  });

  it("should install and use packages", async () => {
    // This test uses numpy, a common Python package
    const result = await executePython({
      code: `
        import numpy as np
        
        # Create a numpy array and perform an operation
        arr = np.array([1, 2, 3, 4, 5])
        mean = np.mean(arr)
        mean
      `,
      installPackages: ["numpy"],
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(3);
  });
});
