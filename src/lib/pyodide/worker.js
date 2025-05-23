// Using JavaScript instead of Typescript since Vite must bundle this worker into main.js
// simple solution was to use ?raw, but raw import does not transpile TypeScript

// force pyodide to detect browser environment, so it doesn't try to load node modules
self.process = undefined;
self.Deno = undefined;

const COMLINK_URL =
  self.COMLINK_URL || "https://unpkg.com/comlink/dist/umd/comlink.js";
const PYODIDE_BASE_URL =
  self.PYODIDE_BASE_URL || "https://cdn.jsdelivr.net/pyodide/v0.27.4/full/";

importScripts(COMLINK_URL);
importScripts(`${PYODIDE_BASE_URL}pyodide.js`);

class Worker {
  pyodide = null;
  stdout = "";

  async init() {
    this.pyodide = await loadPyodide({
      indexURL: PYODIDE_BASE_URL,
    });
    // Save the original stdout write function
    this.pyodide.runPython(`
    import sys
    from io import StringIO
    
    # Create a custom stdout to capture output
    class CaptureStdout(StringIO):
        def write(self, text):
            # Call the JavaScript function to store the output
            self.getvalue()
            super().write(text)
    
    # Replace sys.stdout with our custom stdout
    sys.stdout = CaptureStdout()
  `);
  }

  async execute(code, globals) {
    // Reset stdout for each new execution
    this.stdout = "";

    await this.pyodide.loadPackagesFromImports(code);

    const options = {};

    // globals creates a namespace, do not set if wish to share variables across execute calls
    if (globals) {
      options.globals = this.pyodide.toPy(globals);
    }

    // Execute the Python code
    let result = await this.pyodide.runPythonAsync(code, options);

    // Get the captured stdout
    this.stdout = this.pyodide.runPython("sys.stdout.getvalue()").toString();

    // Clear the stdout buffer
    this.pyodide.runPython("sys.stdout = CaptureStdout()");

    // Convert result to JavaScript
    if (result !== undefined) {
      try {
        // Use the toJs method if available, with proper conversion options
        if (result?.toJs) {
          console.log("Converting Python result to JavaScript using toJs");
          result = result.toJs({ dict_converter: Object.fromEntries });
        }
        // For primitive types that don't have toJs
        else {
          console.log("Result is already a JavaScript compatible value");
        }
      } catch (error) {
        console.error("Error converting Python result to JavaScript:", error);
        throw new Error(
          `Failed to convert Python result to JavaScript: ${error}`,
        );
      }
    }

    return {
      id: 0,
      success: true,
      result,
      stdout: this.stdout,
    };
  }

  async installPackage(packageName) {
    await this.pyodide.loadPackage("micropip");
    const micropip = this.pyodide.pyimport("micropip");
    await micropip.install(packageName);
  }
}

// Expose the Worker class using Comlink
Comlink.expose(new Worker());
