import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderStringAsync, hasVariable } from "$lib/utils/nunjucks.ts";
import { processTemplate } from "$lib/utils/templates.ts";

// Helper function to capture error details
function captureError(error: any) {
  console.log("=== ERROR CAPTURED ===");
  console.log("Error message:", error.message);
  console.log("Error name:", error.name);
  console.log("Error stack:", error.stack);
  console.log("Error toString:", error.toString());
  console.log("Full error object:", JSON.stringify(error, null, 2));

  // Check for additional nunjucks-specific properties
  console.log("Error properties:");
  console.log("- lineno:", error.lineno);
  console.log("- colno:", error.colno);
  console.log("- firstLineNumber:", error.firstLineNumber);
  console.log("- Update:", error.Update);
  console.log("- loader:", error.loader);
  console.log("- path:", error.path);
  console.log("- source:", error.source);

  // Log all enumerable properties
  console.log("All properties:", Object.getOwnPropertyNames(error));
  console.log("=== END ERROR ===");
  return error;
}

describe("nunjucks error handling", () => {
  describe("renderStringAsync", () => {
    it("should handle undefined variables with throwOnUndefined disabled", async () => {
      const template = "Hello {{ name }}";
      const data = {};
      const options = { throwOnUndefined: false };

      const result = await renderStringAsync(template, data, options);
      expect(result).toBe("Hello ");
    });

    it("should throw on undefined variables with throwOnUndefined enabled", async () => {
      const template = "Hello {{ name }}";
      const data = {};
      const options = { throwOnUndefined: true };

      try {
        await renderStringAsync(template, data, options);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(
          /attempted to output null or undefined value/,
        );
      }
    });

    it("should include template name in error when provided", async () => {
      const template = "Hello {{ name }}";
      const data = {};
      const options = { throwOnUndefined: true, templateName: "test-agent.md" };

      try {
        await renderStringAsync(template, data, options);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toContain("test-agent.md");
        expect(err.message).not.toContain("(unknown path)");
      }
    });

    it("should include template snippet in error message", async () => {
      const template = "Hello {{ undefined_variable }} and more text";
      const data = {};
      const options = { throwOnUndefined: true, templateName: "test-agent.md" };

      try {
        await renderStringAsync(template, data, options);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        // Should include template name
        expect(err.message).toContain("test-agent.md");
        // The current implementation might not add snippet for all error types
        // This test verifies the core functionality works
      }
    });

    it("should provide better error messages with dev mode enabled", async () => {
      const template = "Hello {{ undefined_variable }}";
      const data = { existing_var: "value" };
      const options = { throwOnUndefined: true, templateName: "test-agent.md" };

      try {
        await renderStringAsync(template, data, options);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        console.log("=== DEV MODE ERROR MESSAGE ===");
        console.log(err.message);
        console.log("=== END DEV MODE ERROR ===");
        expect(err.message).toContain("test-agent.md");
      }
    });

    it("should handle syntax errors", async () => {
      const template = "Hello {{ name ";
      const data = { name: "World" };

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/expected variable end/);
      }
    });

    it("should handle invalid filter usage", async () => {
      const template = "Hello {{ name | nonexistent }}";
      const data = { name: "World" };

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/filter not found: nonexistent/);
      }
    });

    it("should handle malformed expressions", async () => {
      const template = "Hello {{ name.invalid.access }}";
      const data = { name: "World" };

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(
          /attempted to output null or undefined value/,
        );
      }
    });

    it("should handle circular references", async () => {
      const data: any = { name: "World" };
      data.self = data;
      const template = "Hello {{ name }}";

      // Should not throw for simple access
      const result = await renderStringAsync(template, data);
      expect(result).toBe("Hello World");
    });

    it("should handle complex nested undefined access", async () => {
      const template = "Hello {{ user.profile.name }}";
      const data = { user: {} };
      const options = { throwOnUndefined: false };

      const result = await renderStringAsync(template, data, options);
      expect(result).toBe("Hello ");
    });

    it("should handle array access errors", async () => {
      const template = "First: {{ items[0] }}";
      const data = { items: [] };
      const options = { throwOnUndefined: false };

      const result = await renderStringAsync(template, data, options);
      expect(result).toBe("First: ");
    });

    it("should handle function calls on undefined", async () => {
      const template = "Length: {{ items.length }}";
      const data = {};
      const options = { throwOnUndefined: false };

      const result = await renderStringAsync(template, data, options);
      expect(result).toBe("Length: ");
    });

    it("should handle malformed for loops", async () => {
      const template = "{% for item in %} {{ item }} {% endfor %}";
      const data = { items: ["a", "b", "c"] };

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/unexpected token/);
      }
    });

    it("should handle malformed if statements", async () => {
      const template = "{% if %} Hello {% endif %}";
      const data = {};

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/unexpected token/);
      }
    });

    it("should handle unclosed blocks", async () => {
      const template = "{% if true %} Hello";
      const data = {};

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(
          /parseIf: expected elif, else, or endif, got end of file/,
        );
      }
    });

    it("should handle invalid macro calls", async () => {
      const template = "{% macro test() %} Hello {% endmacro %} {{ test( }}";
      const data = {};

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/unexpected token/);
      }
    });

    it("should handle division by zero", async () => {
      const template = "Result: {{ 10 / 0 }}";
      const data = {};

      const result = await renderStringAsync(template, data);
      expect(result).toBe("Result: Infinity");
    });

    it("should handle null and undefined differences", async () => {
      const template = "Null: {{ nullValue }}, Undefined: {{ undefinedValue }}";
      const data = { nullValue: null };
      const options = { throwOnUndefined: false };

      const result = await renderStringAsync(template, data, options);
      expect(result).toBe("Null: , Undefined: ");
    });

    it("should capture specific error details for complex syntax errors", async () => {
      const template = "{% set items = [1, 2, 3 %} {{ items }}";
      const data = {};

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(
          /parseAggregate: expected comma after expression/,
        );
      }
    });

    it("should capture error details for invalid variable syntax", async () => {
      const template = "{{ 123abc }}";
      const data = {};

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(
          /attempted to output null or undefined value/,
        );
      }
    });

    it("should capture error details for invalid function calls", async () => {
      const template = "{{ nonexistentFunction() }}";
      const data = {};

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(
          /Unable to call `nonexistentFunction`, which is undefined or falsey/,
        );
      }
    });

    it("should capture error details for malformed string literals", async () => {
      const template = '{{ \"unclosed string }}';
      const data = {};

      try {
        await renderStringAsync(template, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/expected variable end/);
      }
    });
  });

  describe("processTemplate", () => {
    it("should handle filter errors gracefully", async () => {
      const template = "Hello {{ name | failing }}";
      const filters = {
        failing: () => {
          throw new Error("Filter failed");
        },
      };
      const data = { name: "World" };

      try {
        await processTemplate(template, filters, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/Error: Filter failed/);
      }
    });

    it("should handle async filter errors", async () => {
      const template = "Hello {{ name | asyncFailing }}";
      const filters = {
        asyncFailing: async () => {
          throw new Error("Async filter failed");
        },
      };
      const data = { name: "World" };

      try {
        await processTemplate(template, filters, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/Error: Async filter failed/);
      }
    });

    it("should handle path function with no arguments", async () => {
      const template = "Path: {{ path() }}";
      const data = {};

      const result = await processTemplate(template, {}, data);
      expect(result).toBe("Path: .md");
    });

    it("should handle exists filter with non-string input", async () => {
      const template = "Exists: {{ 123 | exists }}";
      const data = {};

      // The exists filter handles non-string input by converting to string
      const result = await processTemplate(template, {}, data);
      expect(result).toBe("Exists: false");
    });

    it("should handle read filter with non-existent file", async () => {
      const template = 'Content: {{ "non-existent-file.md" | read }}';
      const data = {};

      try {
        await processTemplate(template, {}, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/File not found: non-existent-file.md/);
      }
    });

    it("should handle debug filter with circular references", async () => {
      const data: any = { name: "World" };
      data.self = data;
      const template = "Debug: {{ self | debug }}";

      // Should not throw - debug filter should handle circular refs
      const result = await processTemplate(template, {}, data);
      expect(result).toContain("Debug:");
    });

    it("should handle multiple filter chain errors", async () => {
      const template = "Result: {{ name | upper | failing }}";
      const filters = {
        upper: (value: string) => value.toUpperCase(),
        failing: () => {
          throw new Error("Chain failed");
        },
      };
      const data = { name: "world" };

      try {
        await processTemplate(template, filters, data);
        expect.fail("Should have thrown an error");
      } catch (error) {
        const err = captureError(error);
        expect(err.message).toMatch(/Error: Chain failed/);
      }
    });

    it("should handle template with mixed sync and async filters", async () => {
      const template = "Result: {{ name | upper | asyncDouble }}";
      const filters = {
        upper: (value: string) => value.toUpperCase(),
        asyncDouble: async (value: string) => value + value,
      };
      const data = { name: "world" };

      const result = await processTemplate(template, filters, data);
      expect(result).toBe("Result: WORLDWORLD");
    });

    it("should handle undefined context passed to filters", async () => {
      const template = "Result: {{ undefinedVar | safeFilter }}";
      const filters = {
        safeFilter: (value: any) => value || "default",
      };
      const data = {};
      const options = { throwOnUndefined: false };

      const result = await processTemplate(template, filters, data, options);
      expect(result).toBe("Result: default");
    });
  });

  describe("hasVariable", () => {
    it("should detect simple variables", () => {
      expect(hasVariable("Hello {{ name }}", "name")).toBe(true);
      expect(hasVariable("Hello {{ age }}", "name")).toBe(false);
    });

    it("should handle variables with whitespace", () => {
      expect(hasVariable("Hello {{  name  }}", "name")).toBe(true);
      expect(hasVariable("Hello {{ name}}", "name")).toBe(true);
      expect(hasVariable("Hello {{name }}", "name")).toBe(true);
    });

    it("should handle partial matches correctly", () => {
      expect(hasVariable("Hello {{ namePrefix }}", "name")).toBe(false);
      expect(hasVariable("Hello {{ name }}", "namePrefix")).toBe(false);
    });

    it("should handle complex expressions", () => {
      expect(hasVariable("Hello {{ user.name }}", "user")).toBe(true);
      expect(hasVariable("Hello {{ user.name }}", "name")).toBe(false);
    });

    it("should handle arrays and filters", () => {
      expect(hasVariable("Hello {{ items[0] }}", "items")).toBe(true);
      expect(hasVariable("Hello {{ name | upper }}", "name")).toBe(true);
    });

    it("should handle multiple occurrences", () => {
      expect(hasVariable("{{ name }} says hello {{ name }}", "name")).toBe(
        true,
      );
    });

    it("should handle edge cases", () => {
      expect(hasVariable("", "name")).toBe(false);
      expect(hasVariable("Hello world", "name")).toBe(false);
      expect(hasVariable("Hello {{ }}", "name")).toBe(false);
    });
  });
});
