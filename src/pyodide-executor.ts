/**
 * PyodideExecutor - A utility class for executing Python code in the browser using Pyodide
 * This can be used as a tool in an agentic chat plugin for Obsidian
 */

// Define the interface for execution results
export interface PyodideExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  stdout?: string;
}

export class PyodideExecutor {
  private pyodide: any;
  private isLoading: boolean = false;
  private loadPromise: Promise<any> | null = null;
  private stdoutBuffer: string = '';

  constructor() {
    this.pyodide = null;
  }

  /**
   * Load the Pyodide runtime
   * @param options Optional configuration options
   * @returns Promise that resolves when Pyodide is loaded
   */
  async load(options: { indexURL?: string } = {}): Promise<void> {
    // If already loading, return the existing promise
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    // If already loaded, return immediately
    if (this.pyodide) {
      return Promise.resolve();
    }

    this.isLoading = true;

    // Load the Pyodide script if it's not already in the document
    if (!document.querySelector('script[src*="pyodide.js"]')) {
      const script = document.createElement('script');
      script.src = options.indexURL || 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js';
      script.async = true;
      
      // Wait for the script to load
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = (e) => reject(new Error(`Failed to load Pyodide script: ${e}`));
        document.head.appendChild(script);
      });
    }

    try {
      // Create a global loadPyodide function type
      const loadPyodide = (window as any).loadPyodide;
      
      // Load Pyodide
      console.log('Loading Pyodide...');
      this.pyodide = await loadPyodide({
        indexURL: options.indexURL || 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/'
      });
      console.log('Pyodide loaded successfully!');
      
      // Set up stdout capture using Python
      await this.setupStdoutCapture();
      
      this.isLoading = false;
      return Promise.resolve();
    } catch (error) {
      this.isLoading = false;
      console.error('Error loading Pyodide:', error);
      throw error;
    }
  }

  /**
   * Set up stdout capture for Pyodide using Python's sys module
   */
  private async setupStdoutCapture(): Promise<void> {
    // Initialize the stdout capture using Python's sys module
    await this.pyodide.runPythonAsync(`
      import sys
      from io import StringIO
      
      class StdoutCatcher:
          def __init__(self):
              self.value = ''
              
          def write(self, text):
              self.value += text
              return len(text)
              
          def flush(self):
              pass
      
      # Create a global stdout catcher that we can access from JavaScript
      stdout_catcher = StdoutCatcher()
      sys.stdout = stdout_catcher
    `);
  }

  /**
   * Clear the stdout buffer
   */
  private clearStdout(): void {
    this.pyodide.runPython(`stdout_catcher.value = ''`);
  }

  /**
   * Get the current stdout content
   */
  private getStdout(): string {
    return this.pyodide.runPython(`stdout_catcher.value`);
  }

  /**
   * Execute Python code and return the result
   * @param code Python code to execute
   * @param globals Optional global variables to pass to the Python context
   * @returns Result of the execution
   */
  async execute(code: string, globals: Record<string, any> = {}): Promise<PyodideExecutionResult> {
    if (!this.pyodide) {
      await this.load();
    }

    // Clear stdout buffer before execution
    this.clearStdout();

    // Set global variables in the Python context
    Object.entries(globals).forEach(([key, value]) => {
      this.pyodide.globals.set(key, value);
    });

    try {
      // Execute the Python code
      const result = this.pyodide.runPython(code);
      const stdout = this.getStdout();
      
      // Convert Python objects to JavaScript if needed
      let jsResult = result;
      if (result && typeof result === 'object' && result.toJs) {
        jsResult = result.toJs();
      }
      
      return {
        success: true,
        result: jsResult,
        stdout: stdout
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stdout: this.getStdout()
      };
    }
  }

  /**
   * Execute Python code asynchronously and return the result
   * @param code Python code to execute
   * @param globals Optional global variables to pass to the Python context
   * @returns Result of the execution
   */
  async executeAsync(code: string, globals: Record<string, any> = {}): Promise<PyodideExecutionResult> {
    if (!this.pyodide) {
      await this.load();
    }

    // Clear stdout buffer before execution
    this.clearStdout();

    // Set global variables in the Python context
    Object.entries(globals).forEach(([key, value]) => {
      this.pyodide.globals.set(key, value);
    });

    try {
      // Execute the Python code asynchronously
      const result = await this.pyodide.runPythonAsync(code);
      const stdout = this.getStdout();
      
      // Convert Python objects to JavaScript if needed
      let jsResult = result;
      if (result && typeof result === 'object' && result.toJs) {
        jsResult = result.toJs();
      }
      
      return {
        success: true,
        result: jsResult,
        stdout: stdout
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stdout: this.getStdout()
      };
    }
  }

  /**
   * Install a Python package using micropip
   * @param packageName Name of the package to install
   * @returns Result of the installation
   */
  async installPackage(packageName: string): Promise<PyodideExecutionResult> {
    if (!this.pyodide) {
      await this.load();
    }

    // Clear stdout buffer before execution
    this.clearStdout();

    try {
      // Load micropip if not already loaded
      await this.pyodide.loadPackage('micropip');
      
      // Install the package
      await this.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${packageName}')
      `);

      return {
        success: true,
        stdout: this.getStdout()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stdout: this.getStdout()
      };
    }
  }
}
