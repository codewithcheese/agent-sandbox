import { beforeEach, describe, expect, it } from "vitest";
import { execute as fetchToolExecute } from "../../src/tools/fetch";
import { helpers, vault as mockVault, metadataCache } from "../mocks/obsidian";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import type { ToolCallOptionsWithContext } from "../../src/tools/types.ts";
import { SessionStore } from "../../src/chat/session-store.svelte.ts";

describe("fetchToolExecute", () => {
  let toolExecOptions: ToolCallOptionsWithContext;
  let vault: VaultOverlay;
  let mockAbortController: AbortController;
  let sessionStore: SessionStore;

  beforeEach(async () => {
    await helpers.reset();

    vault = new VaultOverlay(mockVault);
    mockAbortController = new AbortController();
    sessionStore = new SessionStore(vault);

    toolExecOptions = {
      toolCallId: "test-fetch-tool-call",
      messages: [],
      getContext: () => ({
        vault,
        sessionStore,
        metadataCache,
      }),
      abortSignal: mockAbortController.signal,
    };
  });

  // --- URL Validation Tests ---
  describe("URL validation", () => {
    it("should reject non-HTTP(S) URLs", async () => {
      const result = await fetchToolExecute(
        { url: "ftp://example.com/data" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        error: "URL Validation Failed",
        message: "Protocol ftp: not allowed. Use HTTP or HTTPS.",
      });
    });

    it("should reject blocked domains", async () => {
      const result = await fetchToolExecute(
        { url: "https://localhost:3000/api" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        error: "URL Validation Failed",
        message: "Domain localhost is blocked for security reasons",
      });
    });

    it("should reject blocked IP ranges", async () => {
      const result = await fetchToolExecute(
        { url: "https://127.0.0.1:8080/api" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        error: "URL Validation Failed",
        message: "IP range 127.* is blocked for security reasons",
      });
    });

    it("should accept valid HTTPS URLs", async () => {
      const result = await fetchToolExecute(
        { url: "https://api.example.com/data" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        status: 200,
      });
    });
  });

  // --- Request Method Tests ---
  describe("HTTP methods", () => {
    it("should default to GET method", async () => {
      const result = await fetchToolExecute(
        { url: "https://api.example.com/data" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        method: "GET",
      });
    });

    it("should support POST method", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/data",
          method: "POST",
          body: '{"test": "data"}',
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        method: "POST",
      });
    });

    it("should support custom HTTP methods", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/data",
          method: "PATCH",
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        method: "PATCH",
      });
    });
  });

  // --- Headers and Content Type Tests ---
  describe("headers and content type", () => {
    it("should pass through custom headers", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/data",
          headers: {
            Authorization: "Bearer token123",
            "X-Custom-Header": "value",
          },
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        status: 200,
      });
    });

    it("should pass through content type", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/data",
          content_type: "application/xml",
          body: "<xml>test</xml>",
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        status: 200,
      });
    });
  });

  // --- Response Handling Tests ---
  describe("response handling", () => {
    it("should auto-detect JSON responses", async () => {
      const result = await fetchToolExecute(
        { url: "https://api.example.com/data" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        response_type: "json",
        body: { success: true, data: "test" },
      });
    });

    it("should handle text responses", async () => {
      const result = await fetchToolExecute(
        { url: "https://api.example.com/text" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        response_type: "text",
        body: "Hello World",
      });
    });

    it("should force JSON parsing when requested", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/data",
          response_type: "json",
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        response_type: "json",
        body: { success: true, data: "test" },
      });
    });

    it("should handle JSON parsing errors gracefully", async () => {
      const result = await fetchToolExecute(
        { url: "https://api.example.com/text" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        response_type: "text",
        body: "Hello World",
      });
    });

    it("should fail when forced JSON parsing fails", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/text",
          response_type: "json",
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        error: "Request Failed",
        message: expect.stringContaining("Failed to parse response as JSON"),
      });
    });
  });

  // --- Error Handling Tests ---
  describe("error handling", () => {
    it("should handle network errors", async () => {
      const result = await fetchToolExecute(
        { url: "https://api.example.com/error" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        error: "Request Failed",
        message: "Network error",
      });
    });

    it("should handle HTTP error status codes when throw_on_error is true", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/error",
          throw_on_error: true,
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        error: "Request Failed",
        message: "Network error",
      });
    });

    it("should not throw on HTTP errors when throw_on_error is false", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/404",
          throw_on_error: false,
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        status: 404,
        body: { error: "Resource not found" },
      });
    });

    it("should reject responses that are too large", async () => {
      const result = await fetchToolExecute(
        { url: "https://api.example.com/large" },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        error: "Response Too Large",
        message: expect.stringContaining("exceeds maximum allowed size"),
      });
    });
  });

  // --- Abort Signal Tests ---
  describe("cancellation", () => {
    it("should handle abort signal during request", async () => {
      mockAbortController.abort();

      await expect(() =>
        fetchToolExecute(
          { url: "https://api.example.com/data" },
          toolExecOptions,
        ),
      ).rejects.toThrow();
    });
  });

  // --- Integration Tests ---
  describe("integration tests", () => {
    it("should include all expected response metadata", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/users",
          method: "POST",
          body: '{"name": "test user"}',
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        status: 201,
        headers: {
          "content-type": "application/json",
          "x-rate-limit": "100",
        },
        response_type: "json",
        body: { id: 123, name: "test" },
        size: expect.any(Number),
        url: "https://api.example.com/users",
        method: "POST",
        duration: expect.any(Number),
      });
    });

    it("should properly configure requestUrl with all parameters", async () => {
      const result = await fetchToolExecute(
        {
          url: "https://api.example.com/data",
          method: "PUT",
          headers: { Authorization: "Bearer token" },
          body: '{"update": true}',
          content_type: "application/json",
          throw_on_error: false,
        },
        toolExecOptions,
      );

      expect(result).toMatchObject({
        success: true,
        status: 200,
        method: "PUT",
        url: "https://api.example.com/data",
      });
    });
  });
});
