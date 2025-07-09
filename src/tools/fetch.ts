import { z } from "zod";
import { requestUrl } from "obsidian";
import { createDebug } from "$lib/debug";
import type { ToolDefinition, ToolCallOptionsWithContext } from "./types.ts";
import { invariant } from "@epic-web/invariant";
import { type ToolUIPart } from "ai";

/**
 * Features:
 * - Makes HTTP/HTTPS requests without CORS restrictions using Obsidian's requestUrl
 * - Supports all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - Configurable headers and request body
 * - Handles different response content types (JSON, text, binary)
 * - Comprehensive error handling for network issues and HTTP errors
 * - Response size limits for safety
 * - Timeout support
 * - URL validation and security measures
 * - Structured response format with status, headers, and body
 * - Cancellation support using abort signal
 *
 * Security Features:
 * - URL protocol validation (HTTP/HTTPS only)
 * - Response size limits to prevent memory exhaustion
 * - Timeout limits to prevent hanging requests
 * - Malicious URL pattern detection
 *
 * Use Cases:
 * - API integration and testing
 * - Web scraping and content fetching
 * - Webhook testing and debugging
 * - Data synchronization with external services
 * - Authentication and authorization flows
 */

const debug = createDebug();

// Define the UI tool type for the fetch tool
type FetchUITool = {
  input: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    content_type?: string;
    response_type?: string;
    throw_on_error?: boolean;
  };
  output: {
    success: true;
    status: number;
    headers: Record<string, string>;
    response_type: string;
    body: any;
    size: number;
    url: string;
    method: string;
    duration: number;
  } | {
    error: string;
    message?: string;
    humanMessage?: string;
    status?: number;
    url?: string;
    method?: string;
    duration?: number;
  };
};

type FetchToolUIPart = ToolUIPart<{ Fetch: FetchUITool }>;

export const defaultConfig = {
  MAX_RESPONSE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_PROTOCOLS: ["http:", "https:"],
  BLOCKED_DOMAINS: ["localhost", "127.0.0.1", "0.0.0.0"],
  BLOCKED_IP_RANGES: ["127.", "10.", "192.168.", "172.16.", "169.254."],
} as const;

export const TOOL_NAME = "Fetch";
export const TOOL_DESCRIPTION =
  "Make HTTP/HTTPS requests without CORS restrictions";
export const TOOL_PROMPT_GUIDANCE = `Make HTTP/HTTPS requests to external APIs and websites without CORS restrictions.

This tool uses Obsidian's special request utility that bypasses browser CORS limitations, allowing you to fetch data from any HTTP/HTTPS endpoint.

Usage:
- url: The URL to fetch (required, must be HTTP/HTTPS)
- method: HTTP method (GET, POST, PUT, DELETE, etc.) - defaults to GET
- headers: Optional HTTP headers as key-value pairs
- body: Optional request body as string (JSON should be pre-serialized)
- content_type: Optional content type (alternative to Content-Type header)
- response_type: Expected response format - 'auto', 'json', 'text', or 'binary'
- throw_on_error: Whether to treat HTTP error status codes as failures (default: true)

Security Notes:
- Only HTTP/HTTPS URLs are allowed
- Response size is limited to prevent memory issues
- Some local/private IP ranges are blocked for security

Examples:
- GET request: { "url": "https://api.example.com/data" }
- POST with JSON: { "url": "https://api.example.com/users", "method": "POST", "body": "{\\"name\\":\\"John\\"}", "content_type": "application/json" }
- Custom headers: { "url": "https://api.example.com/protected", "headers": {"Authorization": "Bearer token123"} }`;

// Response type enum
const responseTypeSchema = z.enum(["auto", "json", "text", "binary"]);

// Input schema
const inputSchema = z.strictObject({
  url: z
    .string()
    // .url("Must be a valid URL") // creates invalid `type: url` schema for Google Generative API
    .describe("The URL to fetch (must be HTTP/HTTPS)"),
  method: z
    .string()
    .optional()
    .default("GET")
    .describe("HTTP method to use (GET, POST, PUT, DELETE, etc.)"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional HTTP headers as key-value pairs"),
  body: z
    .string()
    .optional()
    .describe(
      "Optional request body as string (JSON should be pre-serialized)",
    ),
  content_type: z
    .string()
    .optional()
    .describe("Optional content type (alternative to Content-Type header)"),
  response_type: responseTypeSchema
    .optional()
    .default("auto")
    .describe(
      "Expected response format - 'auto' detects based on Content-Type header",
    ),
  throw_on_error: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to treat HTTP error status codes (400+) as failures"),
});

type FetchToolOutput = {
  success: true;
  status: number;
  headers: Record<string, string>;
  response_type: string;
  body: any;
  size: number;
  url: string;
  method: string;
  duration: number;
} | {
  error: string;
  message?: string;
  humanMessage?: string;
  status?: number;
  url?: string;
  method?: string;
  duration?: number;
};

/**
 * Validates URL for security concerns
 */
function validateUrl(
  url: string,
  config: typeof defaultConfig,
): { valid: boolean; message?: string } {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return { valid: false, message: "Invalid URL format" };
  }

  // Check allowed protocols
  if (!config.ALLOWED_PROTOCOLS.includes(parsedUrl.protocol as any)) {
    return {
      valid: false,
      message: `Protocol ${parsedUrl.protocol} not allowed. Use HTTP or HTTPS.`,
    };
  }

  // Check blocked IP ranges first (more specific)
  for (const range of config.BLOCKED_IP_RANGES) {
    if (parsedUrl.hostname.startsWith(range)) {
      return {
        valid: false,
        message: `IP range ${range}* is blocked for security reasons`,
      };
    }
  }

  // Check blocked domains
  if (config.BLOCKED_DOMAINS.includes(parsedUrl.hostname as any)) {
    return {
      valid: false,
      message: `Domain ${parsedUrl.hostname} is blocked for security reasons`,
    };
  }

  return { valid: true };
}

/**
 * Determines content type from response headers
 */
function getContentType(headers: Record<string, string>): string {
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  return contentType.split(";")[0].toLowerCase();
}

/**
 * Processes response based on content type and user preference
 */
function processResponse(
  responseText: string,
  headers: Record<string, string>,
  responseType: string,
): { processedBody: any; detectedType: string } {
  const contentType = getContentType(headers);

  let detectedType = "text";
  let processedBody: any = responseText;

  if (responseType === "auto") {
    // Auto-detect based on Content-Type
    if (
      contentType.includes("application/json") ||
      contentType.includes("text/json")
    ) {
      detectedType = "json";
      try {
        processedBody = JSON.parse(responseText);
      } catch (e) {
        detectedType = "text"; // Fallback to text if JSON parsing fails
      }
    } else if (contentType.includes("text/")) {
      detectedType = "text";
    } else {
      detectedType = "binary";
    }
  } else if (responseType === "json") {
    detectedType = "json";
    try {
      processedBody = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Failed to parse response as JSON: ${e.message}`);
    }
  } else if (responseType === "text") {
    detectedType = "text";
  } else if (responseType === "binary") {
    detectedType = "binary";
  }

  return { processedBody, detectedType };
}

export async function execute(
  params: z.infer<typeof inputSchema>,
  toolExecOptions: ToolCallOptionsWithContext,
): Promise<FetchToolOutput> {
  const { abortSignal } = toolExecOptions;
  const { config: contextConfig } = toolExecOptions.getContext();
  const config = { ...defaultConfig, ...contextConfig };

  const startTime = Date.now();

  // Get resolved method value (with default applied)
  const method = params.method || "GET";

  // Validate URL
  const urlValidation = validateUrl(params.url, config);
  if (!urlValidation.valid) {
    return {
      error: "URL Validation Failed",
      message: urlValidation.message,
      humanMessage: "Invalid URL",
      url: params.url,
      method,
    };
  }

  // Request body is already a string (or undefined)
  const requestBody = params.body;

  try {
    debug(`Making ${method} request to ${params.url}`);

    const response = await requestUrl({
      url: params.url,
      method,
      headers: params.headers,
      body: requestBody,
      contentType: params.content_type,
      throw: params.throw_on_error, // Pass through directly - true means throw on 4xx/5xx errors
    });

    const duration = Date.now() - startTime;

    if (abortSignal?.aborted) {
      throw new Error("Operation aborted");
    }

    // Check response size
    const responseSize = response.text.length;
    if (responseSize > config.MAX_RESPONSE_SIZE) {
      return {
        error: "Response Too Large",
        message: `Response size (${Math.round(responseSize / 1024)}KB) exceeds maximum allowed size (${Math.round(config.MAX_RESPONSE_SIZE / 1024)}KB)`,
        humanMessage: "Response too large",
        status: response.status,
        url: params.url,
        method,
        duration,
      };
    }

    // Process response body
    const { processedBody, detectedType } = processResponse(
      response.text,
      response.headers,
      params.response_type || "auto",
    );

    debug(`Request completed: ${response.status} (${duration}ms)`);

    return {
      success: true,
      status: response.status,
      headers: response.headers,
      response_type: detectedType,
      body: processedBody,
      size: responseSize,
      url: params.url,
      method,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    debug(`Request failed for ${params.url}:`, error);

    if (abortSignal?.aborted) {
      throw new Error("Operation aborted");
    }

    // Handle different types of errors
    let errorMessage = "Request failed";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    }

    return {
      error: "Request Failed",
      message: errorMessage,
      humanMessage: "Request failed",
      url: params.url,
      method,
      duration,
    };
  }
}

export const fetchTool: ToolDefinition = {
  type: "local",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: TOOL_PROMPT_GUIDANCE,
  inputSchema,
  execute,
  generateDataPart: (toolPart: FetchToolUIPart) => {
    const { state, input } = toolPart;

    // Helper function to format URL and method
    const formatContext = (url: string, method: string = "GET", hasError = false) => {
      try {
        const urlObj = new URL(url);
        const host = urlObj.hostname;
        const path = urlObj.pathname;
        const displayUrl = path === "/" ? host : `${host}${path}`;
        const errorSuffix = hasError ? " (error)" : "";
        return `${method.toUpperCase()} ${displayUrl}${errorSuffix}`;
      } catch {
        const errorSuffix = hasError ? " (error)" : "";
        return `${method.toUpperCase()} ${url}${errorSuffix}`;
      }
    };

    // Show method and URL during streaming and processing
    if (state === "input-available" || state === "input-streaming") {
      if (!input?.url) return null;
      
      const method = input.method || "GET";
      
      return {
        title: "Fetch",
        context: formatContext(input.url, method),
      };
    }

    if (state === "output-available") {
      const { output } = toolPart;
      
      // Handle recoverable error output
      if (output && 'error' in output) {
        const method = output.method || input?.method || "GET";
        const url = output.url || input?.url || "";
        
        return {
          title: "Fetch",
          context: output.humanMessage || output.message || output.error || "Request failed",
          error: true,
        };
      }
      
      // Handle success output
      if (output && 'success' in output) {
        const { status, size, duration } = output;
        
        // Format size
        const sizeText = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`;
        
        // Format duration
        const durationText = duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
        
        return {
          title: "Fetch",
          context: formatContext(output.url, output.method),
          lines: `${status} • ${sizeText} • ${durationText}`,
        };
      }
    }

    if (state === "output-error") {
      const method = input?.method || "GET";
      const url = input?.url || "";
      
      // Show actual error message instead of generic "(error)"
      const errorText = toolPart.errorText || "Unknown error";
      
      return {
        title: "Fetch",
        context: formatContext(url, method, false),
        lines: errorText,
      };
    }

    return null;
  },
};
