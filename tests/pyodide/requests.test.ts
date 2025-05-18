import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PyodideExecutor } from "../../src/lib/pyodide/executor";

// These tests require internet access which is unavailable in this environment.
// Skip the entire suite.
describe.skip("Pyodide HTTP Request Tests", () => {
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

    // Set up HTTP requests by installing the requests package
    await executor.installPackage("requests");
  }, 5000); // Increase timeout for Pyodide loading and setup

  afterAll(() => {
    // Clean up by terminating the web worker
    if (executor) {
      executor.terminate();
    }
  });

  it("should be able to make GET requests using the requests library directly", async () => {
    const code = `
      import requests
      
      # Make a GET request to a public API
      response = requests.get('https://jsonplaceholder.typicode.com/todos/1')
      
      # Check if the request was successful
      response.status_code == 200 and response.json()['id'] == 1
    `;

    const result = await executor.execute(code);

    expect(result.success).toBe(true);
    expect(result.result).toBe(true);
  });

  it("should handle request errors gracefully", async () => {
    const code = `
      import requests
      
      try:
          # Try to access a non-existent domain
          response = requests.get('https://non-existent-domain-12345.com', timeout=1)
          print("This should not be reached")
      except Exception as e:
          print(f"Error caught: {str(e)}")
    `;

    const result = await executor.execute(code);

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("Error caught:");
  });

  it("should be able to make POST requests with JSON data", async () => {
    const code = `
      import requests
      import json
      
      # Data to send
      data = {
          'title': 'foo',
          'body': 'bar',
          'userId': 1
      }
      
      # Make a POST request
      response = requests.post(
          'https://jsonplaceholder.typicode.com/posts',
          json=data,
          headers={'Content-type': 'application/json; charset=UTF-8'}
      )
      
      # Return the response data
      response_json = response.json()
      response.status_code == 201 and response_json['title'] == 'foo'
    `;

    const result = await executor.execute(code);

    expect(result.success).toBe(true);
    expect(result.result).toBe(true);
  });

  it("should be able to extract and process data from API responses", async () => {
    const code = `
      import requests
      
      # Make a GET request to a public API
      response = requests.get('https://jsonplaceholder.typicode.com/users/1')
      
      # Extract data from the response
      user_data = response.json()
      user_name = user_data['name']
      user_email = user_data['email']
      
      # Return a formatted result
      f"User: {user_name}, Email: {user_email}"
    `;

    const result = await executor.execute(code);

    expect(result.success).toBe(true);
    expect(result.result).toContain("User:");
    expect(result.result).toContain("Email:");
  });

  it("should handle query parameters correctly", async () => {
    const code = `
      import requests
      
      # Make a GET request with query parameters
      response = requests.get(
          'https://jsonplaceholder.typicode.com/posts',
          params={'userId': 1}
      )
      
      # Check that all returned posts have userId = 1
      posts = response.json()
      all(post['userId'] == 1 for post in posts)
    `;

    const result = await executor.execute(code);

    expect(result.success).toBe(true);
    expect(result.result).toBe(true);
  });
});
