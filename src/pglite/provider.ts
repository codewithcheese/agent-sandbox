import type { PGlite } from "@electric-sql/pglite";

const PGLITE_VERSION = "0.2.17";
const CDN_URL = `https://cdn.jsdelivr.net/npm/@electric-sql/pglite@${PGLITE_VERSION}/dist/index.js`;

export class PGliteProvider {
  private pgClient: PGlite | null = null;
  private isInitialized = false;
  private relaxedDurability: boolean;

  constructor(relaxedDurability = true) {
    this.relaxedDurability = relaxedDurability;
  }

  async initialize(): Promise<void> {
    try {
      this.pgClient = await this.createPGliteInstance();
      this.isInitialized = true;
      console.log("PGlite initialized successfully");
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

  async close(): Promise<void> {
    if (this.pgClient) {
      try {
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

  private async createPGliteInstance(): Promise<PGlite> {
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
        dataDir: "idb://agent-sandbox",
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
