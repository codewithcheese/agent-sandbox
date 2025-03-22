// API for communicating with the Pyodide web worker

// Types for the API
export interface PyodideResult {
  success: boolean;
  result?: any;
  error?: string;
  stdout?: string;
}

// Helper function to create a promise that can be resolved externally
function createResolvablePromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return { promise, resolve, reject };
}

// Generate unique IDs for messages
let lastId = 1;
function getNextId() {
  return lastId++;
}

export class PyodideWorkerAPI {
  private worker: Worker;
  private pendingRequests: Map<number, { resolve: (value: PyodideResult) => void, reject: (reason?: any) => void }>;
  
  constructor() {
    // Create the worker
    this.worker = new Worker(new URL('./pyodide-worker.ts', import.meta.url), { type: 'module' });
    this.pendingRequests = new Map();
    
    // Set up message handler
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
  }
  
  private handleWorkerMessage(event: MessageEvent) {
    const { id, success, result, error, stdout } = event.data;
    
    // Find the pending request for this ID
    const pendingRequest = this.pendingRequests.get(id);
    if (!pendingRequest) {
      console.warn(`Received response for unknown request ID: ${id}`);
      return;
    }
    
    // Resolve the promise with the result
    pendingRequest.resolve({
      success: success !== undefined ? success : !error,
      result,
      error,
      stdout
    });
    
    // Remove the pending request
    this.pendingRequests.delete(id);
  }
  
  /**
   * Initialize Pyodide in the web worker
   * @returns Promise that resolves when Pyodide is initialized
   */
  async initialize(): Promise<PyodideResult> {
    const id = getNextId();
    const { promise, resolve, reject } = createResolvablePromise<PyodideResult>();
    
    // Store the promise's resolve/reject functions
    this.pendingRequests.set(id, { resolve, reject });
    
    // Send the message to the worker
    this.worker.postMessage({
      id,
      cmd: 'init'
    });
    
    return promise;
  }
  
  /**
   * Execute Python code in the web worker
   * @param code Python code to execute
   * @param context Optional context variables to pass to the Python code
   * @returns Promise that resolves with the execution result
   */
  async executeCode(code: string, context?: Record<string, any>): Promise<PyodideResult> {
    const id = getNextId();
    const { promise, resolve, reject } = createResolvablePromise<PyodideResult>();
    
    // Store the promise's resolve/reject functions
    this.pendingRequests.set(id, { resolve, reject });
    
    // Send the message to the worker
    this.worker.postMessage({
      id,
      cmd: 'exec',
      python: code,
      context
    });
    
    return promise;
  }
  
  /**
   * Install a Python package in the web worker
   * @param packageName Name of the package to install
   * @returns Promise that resolves when the package is installed
   */
  async installPackage(packageName: string): Promise<PyodideResult> {
    const id = getNextId();
    const { promise, resolve, reject } = createResolvablePromise<PyodideResult>();
    
    // Store the promise's resolve/reject functions
    this.pendingRequests.set(id, { resolve, reject });
    
    // Send the message to the worker
    this.worker.postMessage({
      id,
      cmd: 'installPackage',
      packageName
    });
    
    return promise;
  }
  
  /**
   * Set up HTTP requests capability in the web worker
   * @returns Promise that resolves when HTTP requests are set up
   */
  async setupHttpRequests(): Promise<PyodideResult> {
    const id = getNextId();
    const { promise, resolve, reject } = createResolvablePromise<PyodideResult>();
    
    // Store the promise's resolve/reject functions
    this.pendingRequests.set(id, { resolve, reject });
    
    // Send the message to the worker
    this.worker.postMessage({
      id,
      cmd: 'setupHttpRequests'
    });
    
    return promise;
  }
  
  /**
   * Terminate the web worker
   */
  terminate() {
    this.worker.terminate();
    this.pendingRequests.clear();
  }
}
