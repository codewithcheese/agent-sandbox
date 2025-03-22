/**
 * PyodideExecutor - A utility class for executing Python code in the browser using Pyodide in a web worker
 * This can be used as a tool in an agentic chat plugin for Obsidian
 */

// Define the interface for execution results
export interface PyodideExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  stdout?: string;
}

// Define the interface for worker messages
interface PyodideWorkerMessage {
  id: number;
  cmd: string;
  code?: string;
  globals?: Record<string, any>;
  packageName?: string;
}

// Define the interface for worker responses
interface PyodideWorkerResponse {
  id: number;
  success: boolean;
  result?: any;
  error?: string;
  stdout?: string;
}

export class PyodideExecutor {
  private worker: Worker | null = null;
  private isLoading: boolean = false;
  private loadPromise: Promise<void> | null = null;
  private pendingRequests: Map<number, { resolve: (value: PyodideExecutionResult) => void, reject: (reason?: any) => void }> = new Map();
  private nextRequestId: number = 1;

  constructor() {}

  /**
   * Load the Pyodide runtime in a web worker
   * @param options Optional configuration options
   * @returns Promise that resolves when Pyodide is loaded
   */
  async load(options: { indexURL?: string } = {}): Promise<void> {
    // If already loading, return the existing promise
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    // If already loaded, return immediately
    if (this.worker) {
      return Promise.resolve();
    }

    this.isLoading = true;

    try {
      console.log('Loading Pyodide in web worker...');
      this.loadPromise = new Promise<void>((resolve, reject) => {
        try {
          // Create the web worker
          this.worker = new Worker(new URL('./pyodide-worker.ts', import.meta.url));
          
          // Set up message handler
          this.worker.onmessage = this.handleWorkerMessage.bind(this);
          
          // Initialize Pyodide in the worker
          const initRequestId = this.nextRequestId++;
          
          // Set up the promise resolution
          this.pendingRequests.set(initRequestId, {
            resolve: (result) => {
              if (result.success) {
                console.log('Pyodide loaded successfully in web worker!');
                resolve();
              } else {
                reject(new Error(result.error || 'Failed to initialize Pyodide'));
              }
            },
            reject
          });
          
          // Send the init message
          this.worker.postMessage({
            id: initRequestId,
            cmd: 'init'
          });
          
        } catch (error) {
          reject(error);
        }
      });

      return this.loadPromise;
    } catch (error) {
      this.isLoading = false;
      console.error('Error loading Pyodide in web worker:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Handle messages from the web worker
   */
  private handleWorkerMessage(event: MessageEvent<PyodideWorkerResponse>): void {
    const { id, success, result, error, stdout } = event.data;
    
    // Find the pending request for this ID
    const pendingRequest = this.pendingRequests.get(id);
    if (!pendingRequest) {
      console.warn(`Received response for unknown request ID: ${id}`);
      return;
    }
    
    // Resolve the promise with the result
    pendingRequest.resolve({
      success,
      result,
      error,
      stdout
    });
    
    // Remove the pending request
    this.pendingRequests.delete(id);
  }

  /**
   * Send a message to the web worker and return a promise for the response
   */
  private sendWorkerMessage(message: Omit<PyodideWorkerMessage, 'id'>): Promise<PyodideExecutionResult> {
    if (!this.worker) {
      return Promise.reject(new Error('Pyodide worker not initialized'));
    }
    
    const id = this.nextRequestId++;
    const promise = new Promise<PyodideExecutionResult>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
    
    this.worker.postMessage({ id, ...message });
    
    return promise;
  }

  /**
   * Execute Python code and return the result
   * @param code Python code to execute
   * @param globals Optional global variables to pass to the Python context
   * @returns Result of the execution
   */
  async execute(code: string, globals: Record<string, any> = {}): Promise<PyodideExecutionResult> {
    if (!this.worker) {
      await this.load();
    }

    try {
      console.log('Executing Python code:', code);
      console.log('With globals:', globals);
      
      const result = await this.sendWorkerMessage({
        cmd: 'exec',
        code,
        globals
      });
      
      console.log('Execution result:', result);
      return result;
    } catch (error) {
      console.error('Error executing Python code:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
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
    // In the web worker implementation, regular execution is already async
    return this.execute(code, globals);
  }

  /**
   * Install a Python package using micropip
   * @param packageName Name of the package to install
   * @returns Result of the installation
   */
  async installPackage(packageName: string): Promise<PyodideExecutionResult> {
    if (!this.worker) {
      await this.load();
    }

    try {
      return await this.sendWorkerMessage({
        cmd: 'installPackage',
        packageName
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Set up HTTP request capabilities in Pyodide
   * This will install the requests package so Python code can make HTTP requests
   * @returns Result of the setup
   */
  async setupHttpRequests(): Promise<PyodideExecutionResult> {
    if (!this.worker) {
      await this.load();
    }

    try {
      return await this.sendWorkerMessage({
        cmd: 'setupHttpRequests'
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Terminate the web worker and clean up resources
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    this.pendingRequests.clear();
  }
}
