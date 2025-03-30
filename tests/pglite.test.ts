import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import obsidian from "./mocks/obsidian";

// Import after mocking
import { PGliteProvider } from "../src/pglite/provider";

const { plugin } = obsidian;

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
    provider = new PGliteProvider(plugin as any, "test-db");
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
