// Web worker for Pyodide execution
// We need to explicitly import the Pyodide script in the worker

// Declare web worker specific functions for TypeScript
declare function importScripts(...urls: string[]): void;

// Define the loadPyodide function type
declare const loadPyodide: (config: any) => Promise<any>;

// Import the Pyodide script
const pyodideUrl = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js';
console.log(`Worker: Importing Pyodide script from ${pyodideUrl}`);

// We need to use importScripts in a web worker to load external scripts
try {
  console.log('Worker: About to call importScripts...');
  importScripts(pyodideUrl);
  console.log('Worker: importScripts completed successfully');
} catch (error) {
  console.error('Worker: Error loading Pyodide script with importScripts:', error);
  // Post an error message back to the main thread
  self.postMessage({
    id: 0, // Special ID for initialization errors
    success: false,
    error: `Failed to load Pyodide script: ${error instanceof Error ? error.message : String(error)}`
  });
  throw error;
}

// Define a type for Pyodide interface based on the documentation
interface PyodideInterface {
  runPython: (code: string, options?: any) => any;
  runPythonAsync: (code: string, options?: any) => Promise<any>;
  loadPackage: (names: string | string[]) => Promise<void>;
  loadPackagesFromImports: (code: string) => Promise<void>;
  globals: any;
  pyimport: (name: string) => any;
}

// Define message types for TypeScript
interface PyodideWorkerMessage {
  id: number;
  cmd: string;
  code?: string;
  globals?: Record<string, any>;
  packageName?: string;
}

interface PyodideWorkerResponse {
  id: number;
  success: boolean;
  result?: any;
  error?: string;
  stdout?: string;
}

// Initialize Pyodide with detailed logging
console.log('Worker: Starting to load Pyodide...');
let pyodideReadyPromise = loadPyodide({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/',
}).then(pyodide => {
  console.log('Worker: Pyodide loaded successfully!');
  return pyodide;
}).catch(error => {
  console.error('Worker: Failed to load Pyodide:', error);
  throw error;
});

let pyodide: PyodideInterface;
let stdout = '';

// Capture stdout
function captureStdout() {
  // Save the original stdout write function
  pyodide.runPython(`
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

// Handle messages from the main thread
self.onmessage = async (event: MessageEvent<PyodideWorkerMessage>) => {
  const { id, cmd, code, globals, packageName } = event.data;
  
  console.log(`Worker received message: cmd=${cmd}, id=${id}`);
  if (code) console.log('Code:', code);
  if (globals) console.log('Globals:', globals);
  
  // Handle init command separately (before Pyodide is loaded)
  if (cmd === 'init') {
    try {
      // Wait for Pyodide to load
      pyodide = await pyodideReadyPromise;
      captureStdout();
      
      // Send success response
      self.postMessage({
        id,
        success: true,
        result: 'Pyodide initialized successfully'
      } as PyodideWorkerResponse);
      return;
    } catch (error) {
      self.postMessage({
        id,
        success: false,
        error: `Failed to initialize Pyodide: ${error instanceof Error ? error.message : String(error)}`
      } as PyodideWorkerResponse);
      return;
    }
  }
  
  // For all other commands, make sure Pyodide is loaded
  if (!pyodide) {
    try {
      pyodide = await pyodideReadyPromise;
      captureStdout();
    } catch (error) {
      self.postMessage({
        id,
        success: false,
        error: `Failed to load Pyodide: ${error instanceof Error ? error.message : String(error)}`
      } as PyodideWorkerResponse);
      return;
    }
  }
  
  // Reset stdout for each new execution
  stdout = '';
  
  // Handle different commands
  try {
    let result;
    
    switch (cmd) {
      case 'exec':
        if (!code) {
          throw new Error('No Python code provided');
        }
        
        console.log('Worker executing Python code:', code);
        
        // Load any packages needed by the code
        await pyodide.loadPackagesFromImports(code);
        
        // Create globals from context
        let pyGlobals = pyodide.globals.get('dict')();
        if (globals) {
          // Convert JavaScript objects to Python objects
          Object.entries(globals).forEach(([key, value]) => {
            try {
              // Use Pyodide's built-in conversion
              pyGlobals.set(key, value);
            } catch (error) {
              console.error(`Error converting ${key} to Python:`, error);
              throw new Error(`Failed to convert JavaScript value for '${key}' to Python: ${error}`);
            }
          });
        }
        
        // Execute the Python code
        result = await pyodide.runPythonAsync(code, { globals: pyGlobals });
        
        // Get the captured stdout
        stdout = pyodide.runPython('sys.stdout.getvalue()').toString();
        
        // Clear the stdout buffer
        pyodide.runPython('sys.stdout = CaptureStdout()');
        
        // Convert result to JavaScript
        if (result !== undefined) {
          try {
            // Use the toJs method if available, with proper conversion options
            if (result?.toJs) {
              console.log('Converting Python result to JavaScript using toJs');
              result = result.toJs({ dict_converter: Object.fromEntries });
            }
            // For primitive types that don't have toJs
            else {
              console.log('Result is already a JavaScript compatible value');
            }
          } catch (error) {
            console.error('Error converting Python result to JavaScript:', error);
            throw new Error(`Failed to convert Python result to JavaScript: ${error}`);
          }
        }
        
        break;
        
      case 'installPackage':
        if (!packageName) {
          throw new Error('No package name provided');
        }
        
        // Install the package using micropip
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport('micropip');
        await micropip.install(packageName);
        result = `Package ${packageName} installed successfully`;
        break;
        
      case 'setupHttpRequests':
        // Install and configure requests library
        await pyodide.loadPackage('micropip');
        const micropipForRequests = pyodide.pyimport('micropip');
        await micropipForRequests.install('requests');
        result = 'HTTP requests setup completed';
        break;
        
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
    
    // Send the result back to the main thread
    console.log('Worker sending success response:', { id, result, stdout });
    self.postMessage({
      id,
      success: true,
      result,
      stdout
    } as PyodideWorkerResponse);
    
  } catch (error) {
    // Send any errors back to the main thread
    console.error('Worker encountered an error:', error);
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stdout
    } as PyodideWorkerResponse);
  }
};
