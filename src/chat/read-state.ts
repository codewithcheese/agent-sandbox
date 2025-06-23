import { normalizePath } from "obsidian";

export type ReadStateEntry = {
  timestamp: number; // File modification time (mtimeMs)
};

export type ReadFileState = {
  [filePath: string]: ReadStateEntry;
};

export class ReadState {
  private static readonly READ_STATE_KEY = "readFileState";

  constructor(private sessionStore: any) {} // Using any to avoid circular dependency

  async setLastRead(path: string, mtime: number): Promise<void> {
    path = normalizePath(path);
    const readState = await this.getReadFileState();
    readState[path] = { timestamp: mtime };
    await this.sessionStore.set(ReadState.READ_STATE_KEY, readState);
  }

  async getLastRead(path: string): Promise<number | undefined> {
    path = normalizePath(path);
    const readState = await this.getReadFileState();
    return readState[path]?.timestamp;
  }

  async hasBeenRead(path: string): Promise<boolean> {
    return (await this.getLastRead(path)) !== undefined;
  }

  async isModifiedSinceRead(
    path: string,
    currentMtime: number,
  ): Promise<boolean> {
    const lastReadTime = await this.getLastRead(path);
    if (lastReadTime === undefined) {
      return true; // File hasn't been read, so consider it "modified"
    }
    return currentMtime > lastReadTime;
  }

  private async getReadFileState(): Promise<ReadFileState> {
    return (await this.sessionStore.get(ReadState.READ_STATE_KEY)) || {};
  }
}
