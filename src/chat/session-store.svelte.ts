import type { VaultOverlay } from "./vault-overlay.svelte.ts";
import superjson from "superjson";
import type { SuperJSONObject } from "$lib/utils/superjson.ts";
import { ReadState } from "./read-state.ts";

export class SessionStore {
  private stateFilePath = ".overlay-tmp/session-store.json";
  public data = $state<SuperJSONObject>({});
  private initialized = false;
  public readonly readState: ReadState;

  constructor(private vault: VaultOverlay) {
    this.readState = new ReadState(this);
  }

  /**
   * Initialize the session store by loading data from vault
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.load();
      this.initialized = true;
    }
  }

  /**
   * Reload the session store from vault (clears current data and reloads)
   */
  async reload(): Promise<void> {
    // Clear current data
    this.data = {};
    // Reload from vault
    await this.load();
  }

  /**
   * Get a value from the session store
   */
  async get<T = any>(key: string): Promise<T | undefined> {
    await this.initialize();
    return this.data[key] as T;
  }

  /**
   * Set a value in the session store and persist to vault
   */
  async set(key: string, value: any): Promise<void> {
    await this.initialize();
    this.data[key] = value;
    await this.persist();
  }

  /**
   * Load session store from vault if it exists
   */
  async load(): Promise<void> {
    try {
      const file = this.vault.getFileByPath(this.stateFilePath);
      if (file) {
        const content = await this.vault.read(file);
        const parsed = superjson.parse(content) as any;
        Object.assign(this.data, parsed);
      }
    } catch (error) {
      console.debug(
        "SessionStore: Could not load from vault, using current data",
        error,
      );
    }
  }

  /**
   * Persist session store to vault
   */
  private async persist(): Promise<void> {
    try {
      const content = superjson.stringify(this.data);
      const existingFile = this.vault.getFileByPath(this.stateFilePath);

      if (existingFile) {
        await this.vault.modify(existingFile, content);
      } else {
        await this.vault.create(this.stateFilePath, content);
      }
    } catch (error) {
      console.error("SessionStore: Failed to persist to vault", error);
      // Don't throw - session store should be resilient to persistence failures
    }
  }
}
