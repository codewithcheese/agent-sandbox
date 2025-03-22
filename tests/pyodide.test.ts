import { describe, it, expect, beforeAll, vi } from 'vitest';

// We'll use the global loadPyodide function that's available after loading the script
declare global {
  function loadPyodide(config?: any): Promise<any>;
}

describe('Pyodide Basic Tests', () => {
  let pyodide: any;

  beforeAll(async () => {
    // In browser tests, we need to inject the Pyodide script
    if (!document.querySelector('script[src*="pyodide.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js';
      script.async = true;
      
      // Wait for the script to load
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = (e) => reject(new Error(`Failed to load Pyodide script: ${e}`));
        document.head.appendChild(script);
      });
    }
    
    // Now load Pyodide with a timeout to ensure it completes
    const timeout = setTimeout(() => {
      console.error('Pyodide loading timed out after 30 seconds');
    }, 30000);
    
    try {
      // Load Pyodide
      console.log('Loading Pyodide...');
      pyodide = await loadPyodide();
      console.log('Pyodide loaded successfully!');
      
      // Optional: You can preload packages if needed
      // await pyodide.loadPackage(['numpy', 'pandas']);
    } catch (error) {
      console.error('Error loading Pyodide:', error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }, 60000); // Increase timeout for Pyodide loading

  it('should execute basic Python code', async () => {
    const result = pyodide.runPython(`
      x = 1 + 1
      x
    `);
    expect(result).toBe(2);
  });

  it('should handle Python errors properly', () => {
    expect(() => {
      pyodide.runPython(`
        # This will raise a NameError
        undefined_variable
      `);
    }).toThrow();
  });

  it('should convert data between JavaScript and Python', async () => {
    // Create a JavaScript object
    const jsObj = { name: 'John', age: 30 };
    
    // Pass it to Python
    pyodide.globals.set('js_obj', jsObj);
    
    // Manipulate it in Python and return
    pyodide.runPython(`
      # Access and modify the JS object directly
      js_obj.age = js_obj.age + 1
    `);
    
    // Check that the original JS object was modified
    expect(jsObj.age).toBe(31);
    
    // Create a new object in Python and return it to JS
    // Use Pyodide's toJs() method to convert Python objects to JavaScript
    const result = pyodide.runPython(`
      from pyodide.ffi import to_js
      
      # Create a new Python dict
      py_dict = {'name': 'John', 'age': 31, 'language': 'Python'}
      
      # Convert to JavaScript explicitly
      to_js(py_dict)
    `);
    
    // Check the result - in Pyodide 0.27.4 this should be a JavaScript object
    expect(result).toMatchObject({
      name: 'John',
      age: 31,
      language: 'Python'
    });
  });
});
