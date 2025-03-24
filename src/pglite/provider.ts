import { type Plugin, normalizePath } from "obsidian";
import type { PGlite } from "@electric-sql/pglite";

const PGLITE_VERSION = "0.2.17";
const CDN_URL = `https://cdn.jsdelivr.net/npm/@electric-sql/pglite@${PGLITE_VERSION}/dist/index.js`;

export class PGliteProvider {
  private plugin: Plugin;
  private dbName: string;
  private pgClient: PGlite | null = null;
  private isInitialized = false;
  private dbPath: string;
  private relaxedDurability: boolean;

  constructor(
    plugin: Plugin,
    dbName: string = "pglite",
    relaxedDurability = true,
  ) {
    this.plugin = plugin;
    this.dbName = dbName;
    this.relaxedDurability = relaxedDurability;

    // Use the plugin's data directory for storing the database file
    // This ensures we're using the correct plugin ID from the manifest
    this.dbPath = normalizePath(
      `${this.plugin.manifest.dir}/${this.dbName}.db`,
    );
    console.log("Database path set to:", this.dbPath);
  }

  async initialize(): Promise<void> {
    try {
      // Check if we have a saved database file
      const databaseFileExists = await this.plugin.app.vault.adapter.exists(
        this.dbPath,
      );

      if (databaseFileExists) {
        // Load existing database
        console.log("Loading existing database from:", this.dbPath);
        const fileBuffer = await this.plugin.app.vault.adapter.readBinary(
          this.dbPath,
        );
        const fileBlob = new Blob([fileBuffer], { type: "application/x-gzip" });

        // Create PGlite instance with existing data
        this.pgClient = await this.createPGliteInstance({
          loadDataDir: fileBlob,
        });
      } else {
        // Create new database
        console.log("Creating new database");
        this.pgClient = await this.createPGliteInstance({});
      }

      this.isInitialized = true;
      console.log("PGlite initialized successfully");

      // Make sure the directory exists
      const dirPath = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
      if (!(await this.plugin.app.vault.adapter.exists(dirPath))) {
        await this.plugin.app.vault.adapter.mkdir(dirPath);
      }
    } catch (error) {
      console.error("Error initializing PGlite:", error);
      throw new Error(`Failed to initialize PGlite: ${error}`);
    }
  }

  getClient(): PGlite {
    if (!this.pgClient) {
      throw new Error("PGlite client is not initialized");
    }
    return this.pgClient;
  }

  isReady(): boolean {
    return this.isInitialized && this.pgClient !== null;
  }

  async save(): Promise<void> {
    if (!this.pgClient || !this.isInitialized) {
      console.log("Cannot save: PGlite not initialized");
      return;
    }

    try {
      console.log("Saving database to:", this.dbPath);
      const blob: Blob = await this.pgClient.dumpDataDir("gzip");
      await this.plugin.app.vault.adapter.writeBinary(
        this.dbPath,
        Buffer.from(await blob.arrayBuffer()),
      );
      console.log("Database saved successfully");
    } catch (error) {
      console.error("Error saving database:", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.pgClient) {
      try {
        // Save before closing
        await this.save();

        // Close the connection
        await this.pgClient.close();
        this.pgClient = null;
        this.isInitialized = false;
        console.log("PGlite connection closed");
      } catch (error) {
        console.error("Error closing PGlite connection:", error);
      }
    }
  }

  private async createPGliteInstance(options: {
    loadDataDir?: Blob;
  }): Promise<PGlite> {
    const originalProcess = window.process;
    try {
      // Set process.version to undefined so pglite resolve IN_NODE=false
      window.process = {
        ...window.process,
        versions: undefined,
      };

      // Create PGlite instance with options
      const module = await import(/* @vite-ignore */ CDN_URL);
      const PGliteClass: typeof PGlite = module.PGlite;
      return await PGliteClass.create({
        ...options,
        relaxedDurability: this.relaxedDurability,
        extensions: {
          vector: new URL(
            `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/vector.tar.gz`,
          ),
        },
      });
    } finally {
      // Restore process object
      window.process = originalProcess;
    }
  }
}
