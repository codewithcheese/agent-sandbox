import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PyodideExecutor } from "../../src/lib/pyodide/executor";

const describeIf = import.meta.env.ONLINE === "false" ? describe.skip : describe;

describeIf("Pyodide Basic Tests", () => {
  beforeAll(() => {
    (window as any).PYODIDE_BASE_URL = `${location.origin}/node_modules/pyodide/`;
    (window as any).COMLINK_URL = `${location.origin}/node_modules/comlink/dist/umd/comlink.js`;
  });
  let executor: PyodideExecutor;

  beforeAll(async () => {
    // Create a new executor instance
    executor = new PyodideExecutor();

    // Load Pyodide in web worker (this might take some time)
    await executor.load();
  }, 60000); // Increase timeout for Pyodide loading

  afterAll(() => {
    // Clean up by terminating the web worker
    if (executor) {
      executor.terminate();
    }
  });

  it("should execute basic Python code", async () => {
    const result = await executor.execute(`
      x = 1 + 1
      x
    `);

    expect(result.success).toBe(true);
    expect(result.result).toBe(2);
  });

  it("should handle Python errors properly", async () => {
    try {
      await executor.execute(`
        # This will raise a NameError
        undefined_variable
      `);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toContain("NameError");
    }
  });

  it("should convert data between JavaScript and Python", async () => {
    // Create a JavaScript object
    const jsObj = { name: "John", age: 30 };

    // Execute Python code with the JavaScript object in context
    const result1 = await executor.execute(
      `
      # Access and modify the JS object directly using dot notation
      # In a web worker, JS objects are wrapped as JsProxy objects
      js_obj['age'] = js_obj['age'] + 1
      js_obj['age']
    `,
      { js_obj: jsObj },
    );

    // Check the result
    expect(result1.success).toBe(true);
    expect(result1.result).toBe(31);

    // Create a new object in Python and return it to JS
    const result2 = await executor.execute(`
      # Create a new Python dict
      py_dict = {'name': 'John', 'age': 31, 'language': 'Python'}
      py_dict
    `);

    // Check the result
    expect(result2.success).toBe(true);
    expect(result2.result).toMatchObject({
      name: "John",
      age: 31,
      language: "Python",
    });
  });
});
