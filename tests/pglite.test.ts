import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

// Mock Obsidian modules
vi.mock("obsidian", () => {
  return {
    normalizePath: (path: string) => path,
  };
});

// Import after mocking
import { PGliteProvider } from "../src/pglite/provider";

// Define the interface for PGlite result
interface PGliteResult {
  rows: any[];
  rowCount: number;
  fields: any[];
}

describe("PGlite CDN Tests", () => {
  let pglite: PGlite;
  let provider: PGliteProvider;

  beforeAll(async () => {
    // This runs in a real browser environment, so we can directly test the CDN implementation
    // Create a mock plugin object
    const mockPlugin = {
      manifest: { dir: "test-dir" },
      app: {
        vault: {
          adapter: {
            exists: async (path: string) => false,
            mkdir: async (path: string) => {},
            writeBinary: async (path: string, data: Buffer) => {},
            readBinary: async (path: string) => new ArrayBuffer(0),
          },
        },
      },
    };

    // Create a provider instance
    provider = new PGliteProvider(mockPlugin as any, "test-db");
    await provider.initialize();
    pglite = provider.getClient();
  }, 60000);

  afterAll(async () => {
    // Clean up by closing the database connection
    if (pglite) {
      await pglite.close();
    }
  });

  it("should load PGlite from CDN", async () => {
    // Verify that the instance was created successfully
    expect(pglite).toBeDefined();
    expect(provider.isReady()).toBe(true);
    // Verify that it's a PGlite instance by checking for expected methods
    expect(typeof pglite.query).toBe("function");
    expect(typeof pglite.close).toBe("function");
  }, 30000);

  it("should execute a simple query", async () => {
    // Execute a simple query
    const result = (await pglite.query("SELECT 1 + 1 AS sum")) as PGliteResult;

    // Verify the result
    expect(result).toBeDefined();
    expect(result.rows).toBeDefined();
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].sum).toBe(2);
  });

  it("should create a table and insert data", async () => {
    // Create a table
    await pglite.query(`
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);

    // Insert data
    await pglite.query(
      `
      INSERT INTO test_table (name, value)
      VALUES ($1, $2)
    `,
      ["test", 42],
    );

    // Query the data
    const result = (await pglite.query(
      "SELECT * FROM test_table",
    )) as PGliteResult;

    // Verify the result
    expect(result).toBeDefined();
    expect(result.rows).toBeDefined();
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe("test");
    expect(result.rows[0].value).toBe(42);
  });

  it("should handle errors gracefully", async () => {
    // Execute a query with a syntax error
    try {
      await pglite.query("SELECT * FROM nonexistent_table");
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Verify that an error was thrown
      expect(error).toBeDefined();
    }
  });
});
