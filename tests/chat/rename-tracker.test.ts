import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenameTracker } from "../../src/chat/rename-tracker.ts";

describe("RenameTracker", () => {
  let tracker: RenameTracker;
  let mockPlugin: any;

  beforeEach(() => {
    // Reset singleton
    (RenameTracker as any).instance = null;

    // Mock plugin with proper vault.on method
    mockPlugin = {
      registerEvent: vi.fn(),
      app: {
        vault: {
          on: vi.fn().mockReturnValue({}), // Mock event reference
        },
        loadLocalStorage: vi.fn().mockReturnValue([]),
        saveLocalStorage: vi.fn(),
      },
    };

    tracker = RenameTracker.register(mockPlugin);
  });

  afterEach(() => {
    (RenameTracker as any).instance = null;
  });

  describe("findRename", () => {
    it("should find recent renames", () => {
      const now = Date.now();

      // Mock Date.now to control timestamps
      vi.spyOn(Date, "now").mockReturnValue(now);

      // Directly call logRename via the private method (accessing via bracket notation)
      (tracker as any).logRename("old.md", "new.md");

      // Should find the rename
      expect(tracker.findRename("old.md")).toBe("new.md");
    });

    it("should filter out old renames based on maxAgeMs", () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      // Log rename 1 hour ago
      vi.spyOn(Date, "now").mockReturnValue(oneHourAgo);
      (tracker as any).logRename("old.md", "new.md");

      // Current time
      vi.spyOn(Date, "now").mockReturnValue(now);

      // Should not find rename older than 30 minutes
      expect(tracker.findRename("old.md", 30 * 60 * 1000)).toBeNull();

      // Should find rename within 2 hours
      expect(tracker.findRename("old.md", 2 * 60 * 60 * 1000)).toBe("new.md");
    });

    it("should return null for non-existent paths", () => {
      expect(tracker.findRename("nonexistent.md")).toBeNull();
    });

    it("should follow rename chains", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      // Create a rename chain: A → B → C
      (tracker as any).logRename("fileA.md", "fileB.md");
      (tracker as any).logRename("fileB.md", "fileC.md");

      // Looking up the original should return the final destination
      expect(tracker.findRename("fileA.md")).toBe("fileC.md");

      // Looking up intermediate should return the final destination
      expect(tracker.findRename("fileB.md")).toBe("fileC.md");

      // Looking up final should return null (no further renames)
      expect(tracker.findRename("fileC.md")).toBeNull();
    });

    it("should handle circular renames gracefully", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      // Create a circular rename: A → B → A
      (tracker as any).logRename("fileA.md", "fileB.md");
      (tracker as any).logRename("fileB.md", "fileA.md");

      // Circular rename means file ends up back where it started
      // So there's no net rename - should return null
      expect(tracker.findRename("fileA.md")).toBeNull();
      expect(tracker.findRename("fileB.md")).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("should remove old entries", () => {
      const now = Date.now();
      const longAgo = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago (beyond 30 day limit)

      // Log old rename
      vi.spyOn(Date, "now").mockReturnValue(longAgo);
      (tracker as any).logRename("old1.md", "new1.md");

      // Log recent rename
      vi.spyOn(Date, "now").mockReturnValue(now);
      (tracker as any).logRename("old2.md", "new2.md");

      // Only recent rename should be found
      expect(tracker.findRename("old1.md")).toBeNull();
      expect(tracker.findRename("old2.md")).toBe("new2.md");
    });
  });
});
