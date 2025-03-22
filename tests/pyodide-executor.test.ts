import { describe, it, expect, beforeAll } from 'vitest';
import { PyodideExecutor } from '../src/pyodide-executor';

describe('PyodideExecutor Tests', () => {
  let executor: PyodideExecutor;

  beforeAll(async () => {
    // Create a new executor instance
    executor = new PyodideExecutor();
    
    // Load Pyodide (this might take some time)
    await executor.load();
  }, 60000); // Increase timeout for Pyodide loading

  it('should execute basic Python code', async () => {
    const result = await executor.execute('1 + 2');
    expect(result.success).toBe(true);
    expect(result.result).toBe(3);
  });

  it('should handle print statements and capture stdout', async () => {
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

  it('should handle errors gracefully', async () => {
    const result = await executor.execute(`
      # This will raise a NameError
      undefined_variable
    `);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("NameError");
  });

  it('should pass JavaScript variables to Python', async () => {
    const globals = {
      name: 'John',
      age: 30,
      data: { items: [1, 2, 3] }
    };
    
    const result = await executor.execute(`
      print(f"Name: {name}, Age: {age}")
      data_sum = sum(data.items)
      data_sum
    `, globals);
    
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("Name: John, Age: 30");
    expect(result.result).toBe(6);
  });

  it('should handle complex Python code', async () => {
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

  it('should execute async Python code', async () => {
    const result = await executor.executeAsync(`
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
