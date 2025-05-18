import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PyodideExecutor } from "../../src/lib/pyodide/executor";

const describeIf = import.meta.env.ONLINE === "false" ? describe.skip : describe;

describeIf("PyodideExecutor Tests", () => {
  beforeAll(() => {
    (window as any).PYODIDE_BASE_URL = `${location.origin}/node_modules/pyodide/`;
    (window as any).COMLINK_URL = `${location.origin}/node_modules/comlink/dist/umd/comlink.js`;
  });
  let executor: PyodideExecutor;

  beforeAll(async () => {
    // Create a new executor instance
    executor = new PyodideExecutor();

    // Load Pyodide (this might take some time)
    await executor.load();
  }, 60000); // Increase timeout for Pyodide loading

  afterAll(() => {
    // Clean up by terminating the web worker
    if (executor) {
      executor.terminate();
    }
  });

  describe("Basic Functionality", () => {
    it("should execute basic Python code", async () => {
      const result = await executor.execute("1 + 2");
      expect(result.success).toBe(true);
      expect(result.result).toBe(3);
    });

    it("should handle complex Python code", async () => {
      const result = await executor.execute(`
        def fibonacci(n):
            a, b = 0, 1
            for _ in range(n):
                a, b = b, a + b
            return a
        
        result = [fibonacci(i) for i in range(10)]
        result
      `);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.result)).toBe(true);
      expect(result.result).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
    });

    it("should execute async Python code", async () => {
      const result = await executor.execute(`
        import asyncio
        
        async def async_function():
            await asyncio.sleep(0.1)
            return "async result"
        
        await async_function()
      `);

      expect(result.success).toBe(true);
      expect(result.result).toBe("async result");
    });
  });

  describe("Stdout Handling", () => {
    it("should handle print statements and capture stdout", async () => {
      const result = await executor.execute(`
        print("Hello, world!")
        print("Multiple lines")
        print("of output")
      `);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain("Hello, world!");
      expect(result.stdout).toContain("Multiple lines");
      expect(result.stdout).toContain("of output");
    });

    it("should reset stdout between executions", async () => {
      // First execution
      await executor.execute('print("First execution")');

      // Second execution
      const response = await executor.execute('print("Second execution")');

      expect(response.stdout).toBe("Second execution\n");
      expect(response.stdout).not.toContain("First execution");
    });
  });

  describe("Error Handling", () => {
    it("should handle errors gracefully", async () => {
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

    it("should handle syntax errors in Python code", async () => {
      const code = `
        if True
          print("Missing colon in if statement")
      `;

      try {
        await executor.execute(code);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toContain("SyntaxError");
      }
    });

    it("should handle runtime errors in Python code", async () => {
      const code = `
        # Division by zero error
        result = 10 / 0
      `;

      try {
        await executor.execute(code);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toContain("ZeroDivisionError");
      }
    });
  });

  describe("Globals Passing", () => {
    it("should pass JavaScript variables to Python", async () => {
      const globals = {
        name: "John",
        age: 30,
        data: { items: [1, 2, 3] },
      };

      const result = await executor.execute(
        `
        print(f"Name: {name}, Age: {age}")
        data_sum = sum(data['items'])
        data_sum
      `,
        globals,
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain("Name: John, Age: 30");
      expect(result.result).toBe(6);
    });





    it("should handle complex objects in globals", async () => {
      const complexObj = {
        nested: {
          array: [1, 2, [3, 4]],
          object: { a: 1, b: { c: 2 } },
        },
      };

      const code = `
        # Access nested properties
        result = {
          'array_0': nested['array'][0],
          'array_2_1': nested['array'][2][1],
          'object_b_c': nested['object']['b']['c']
        }
        result
      `;

      const response = await executor.execute(code, {
        nested: complexObj.nested,
      });

      expect(response.success).toBe(true);
      expect(response.result).toEqual({
        array_0: 1,
        array_2_1: 4,
        object_b_c: 2,
      });
    });
  });
});
