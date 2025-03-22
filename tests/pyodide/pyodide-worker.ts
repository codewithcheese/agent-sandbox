import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Pyodide Worker Direct Test', () => {
  let worker: Worker;
  let messagePromise: Promise<any>;
  let resolveMessage: (value: any) => void;

  beforeAll(() => {
    // Create a new promise that will be resolved when we receive a message from the worker
    messagePromise = new Promise((resolve) => {
      resolveMessage = resolve;
    });

    // Create the worker
    console.log('Creating worker...');
    worker = new Worker(new URL('../src/pyodide-worker.ts', import.meta.url));
    
    // Set up message handler
    worker.onmessage = (event) => {
      console.log('Received message from worker:', event.data);
      resolveMessage(event.data);
    };
    
    worker.onerror = (error) => {
      console.error('Worker error:', error);
      console.error('Error details:', {
        message: error.message,
        filename: error.filename,
        lineno: error.lineno,
        colno: error.colno
      });
    };
    
    // Handle uncaught errors in the worker
    worker.addEventListener('error', (event) => {
      console.error('Worker uncaught error:', event);
      event.preventDefault();
    });
    
    console.log('Worker created');
  }, 10000);
  
  afterAll(() => {
    // Clean up by terminating the worker
    if (worker) {
      worker.terminate();
    }
  });

  it('should initialize Pyodide in the worker', async () => {
    console.log('Sending init message to worker...');
    
    // Create a new promise for this specific message
    messagePromise = new Promise((resolve) => {
      resolveMessage = resolve;
    });
    
    // Send init message
    worker.postMessage({
      id: 1,
      cmd: 'init'
    });
    
    // Wait for response with a timeout
    const response = await Promise.race([
      messagePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Worker init timed out')), 30000))
    ]);
    
    console.log('Worker init response:', response);
    
    // Check response
    expect(response).toBeDefined();
    expect(response.id).toBe(1);
    expect(response.success).toBe(true);
  }, 10000);

  it('should execute Python code in the worker', async () => {
    console.log('Sending exec message to worker...');
    
    // Create a new promise for this specific message
    messagePromise = new Promise((resolve) => {
      resolveMessage = resolve;
    });
    
    // Send exec message
    worker.postMessage({
      id: 2,
      cmd: 'exec',
      python: 'x = 1 + 1; x'
    });
    
    // Wait for response
    const response = await messagePromise;
    console.log('Worker exec response:', response);
    
    // Check response
    expect(response).toBeDefined();
    expect(response.id).toBe(2);
    expect(response.success).toBe(true);
    expect(response.result).toBe(2);
  }, 10000);
});
