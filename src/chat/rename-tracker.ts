import { Plugin, TFile } from "obsidian";
import { createDebug } from "$lib/debug.ts";

const debug = createDebug();

const STORAGE_KEY = "rename-tracker-log";
const MAX_ENTRIES = 1000;
const MAX_AGE_MS = 60 * 60 * 1000 * 24 * 30; // 30 days

export interface RenameEvent {
  oldPath: string;
  newPath: string;
  timestamp: number;
}

/**
 * Global rename tracker that maintains a log of vault rename events
 * to support rename detection across vault overlay reverts
 */
export class RenameTracker {
  private static instance: RenameTracker | null = null;
  private renameLog: RenameEvent[] = [];

  private constructor(private plugin: Plugin) {}

  static register(plugin: Plugin): RenameTracker {
    if (!RenameTracker.instance) {
      RenameTracker.instance = new RenameTracker(plugin);
      RenameTracker.instance.loadFromStorage();
      RenameTracker.instance.setupEventHandlers();
    }
    return RenameTracker.instance;
  }

  static getInstance(): RenameTracker | null {
    return RenameTracker.instance;
  }

  private loadFromStorage(): void {
    const data = this.plugin.app.loadLocalStorage(STORAGE_KEY);
    if (Array.isArray(data)) {
      this.renameLog = data;
      this.cleanupOldEntries();
      debug(`Loaded ${this.renameLog.length} rename entries from storage`);
    }
  }

  private saveToStorage(): void {
    this.plugin.app.saveLocalStorage(STORAGE_KEY, this.renameLog);
    debug(`Saved ${this.renameLog.length} rename entries to storage`);
  }

  private setupEventHandlers() {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file: TFile, oldPath: string) => {
        // Skip chat files - they have their own handling
        if (file.path.endsWith(".chat") || oldPath.endsWith(".chat")) {
          return;
        }

        this.logRename(oldPath, file.path);
        debug(`Logged rename: ${oldPath} → ${file.path}`);
      }),
    );
  }

  private logRename(oldPath: string, newPath: string): void {
    const event: RenameEvent = {
      oldPath,
      newPath,
      timestamp: Date.now(),
    };

    this.renameLog.push(event);
    this.cleanupOldEntries();
    this.saveToStorage();
  }

  private cleanupOldEntries() {
    const now = Date.now();
    const cutoffTime = now - MAX_AGE_MS;

    // Remove old entries
    this.renameLog = this.renameLog.filter(
      (event) => event.timestamp > cutoffTime,
    );

    // Keep only the most recent entries if we exceed max count
    if (this.renameLog.length > MAX_ENTRIES) {
      this.renameLog = this.renameLog.slice(-MAX_ENTRIES);
    }
  }

  /**
   * Check if a path was recently renamed and return the new path if found
   * Follows rename chains (A→B→C returns C when looking up A)
   */
  findRename(oldPath: string, maxAgeMs: number = MAX_AGE_MS): string | null {
    const cutoffTime = Date.now() - maxAgeMs;
    const recentEvents = this.renameLog.filter(
      (event) => event.timestamp > cutoffTime,
    );

    // Follow the rename chain
    let currentPath = oldPath;
    const visited = new Set<string>(); // Prevent infinite loops

    while (true) {
      // Prevent infinite loops in case of circular renames
      if (visited.has(currentPath)) {
        debug(`Circular rename detected for path: ${currentPath}`);
        break;
      }
      visited.add(currentPath);

      // Find rename event for current path
      const renameEvent = recentEvents.find(
        (event) => event.oldPath === currentPath,
      );

      if (!renameEvent) {
        // No more renames in the chain
        break;
      }

      currentPath = renameEvent.newPath;
    }

    // Return final path if it's different from the original
    return currentPath !== oldPath ? currentPath : null;
  }

  /**
   * Get all recent renames for debugging
   */
  getRecentRenames(maxAgeMs: number = MAX_AGE_MS): RenameEvent[] {
    const cutoffTime = Date.now() - maxAgeMs;
    return this.renameLog.filter((event) => event.timestamp > cutoffTime);
  }
}
