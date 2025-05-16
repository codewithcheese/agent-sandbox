import { beforeEach, describe, expect, it } from "vitest";

import { VaultOverlay } from "./vault-overlay.ts";
import { ChangeAccumulator } from "./change-accumulator.ts";
import { type Change, ChangeKind, type TrackedChange } from "./change.ts";
import type { TFile } from "obsidian";
import { MockTFile } from "../../../tests/mocks/obsidian.ts";

function makeMockApp(initial: Record<string, string> = {}) {
  const disk: Record<string, string> = { ...initial };

  const vault = {
    /** simulate latency‑free fs read */
    async read(file: TFile) {
      if (!(file.path in disk)) throw new Error("ENOENT " + file.path);
      return disk[file.path];
    },
    /** for our purposes cachedRead === read */
    cachedRead(file: TFile) {
      return this.read(file);
    },
    async create(path: string, data: string) {
      disk[path] = data;
    },
    async modify(file: TFile, data: string) {
      if (!(file.path in disk)) throw new Error("ENOENT " + file.path);
      disk[file.path] = data;
    },
    async delete(file: TFile) {
      delete disk[file.path];
    },
    async rename(file: TFile, newPath: string) {
      disk[newPath] = disk[file.path];
      delete disk[file.path];
    },
    getFileByPath(path: string) {
      if (!(path in disk)) return null;
      return new MockTFile(path);
    },
  };

  return { vault, disk } as any;
}

/** Utility to fabricate a change entry quickly */
function makeChange(change: Change): TrackedChange {
  return {
    id: "test‑id",
    description: "test change",
    turn: 1,
    timestamp: Date.now(),
    messageIds: ["m"],
    ...change,
  };
}

describe("VaultOverlay integration", () => {
  let overlay: VaultOverlay;
  let acc: ChangeAccumulator;
  let app: ReturnType<typeof makeMockApp>;

  beforeEach(() => {
    acc = new ChangeAccumulator();
    app = makeMockApp({ "note.md": "Hello" });
    overlay = new VaultOverlay(app as any, acc);
  });

  it("returns disk when no staged change", async () => {
    const txt = await overlay.readFile("note.md");
    expect(txt).toBe("Hello");
  });

  it("returns 'after' when create matches disk", async () => {
    const change = makeChange({
      kind: ChangeKind.CREATE,
      before: undefined,
      after: "Hi",
      path: "new.md",
    });
    overlay.writeChange(change);
    const txt = await overlay.readFile("new.md");
    expect(txt).toBe("Hi");
  });

  it("lazy re‑bases when disk drift is patchable", async () => {
    overlay.writeChange(
      makeChange({
        kind: ChangeKind.MODIFY,
        before: "Hello",
        after: "Hi",
        path: "note.md",
      }),
    );
    // user edits disk: "Hello there"
    app.disk["note.md"] = "Hello there";

    const result = await overlay.readFile("note.md");
    expect(result).toBe("Hi there"); // merged
    // After a successful lazy re‑base the overlay must promote the **live disk**
    // text to the new `before` snapshot. This ensures the commit‑time guard
    // (`live === change.before`) will pass if the user makes no further edits.
    const ch = acc.get("note.md");
    expect((ch as any).before).toBe("Hello there");
  });

  it("returns conflict bundle when patch fails", async () => {
    overlay.writeChange(
      makeChange({
        kind: ChangeKind.MODIFY,
        before: "Hello",
        after: "Hi",
        path: "note.md",
      }),
    );
    app.vault._files.set("note.md", "Goodbye"); // completely different

    const res = await overlay.readFile("note.md");
    expect((res as any).conflict).toBe(true);
    expect((res as any).reason).toBe("text");
  });

  it("DELETE kind returns conflict bundle if file still exists", async () => {
    overlay.writeChange(
      makeChange({ kind: ChangeKind.DELETE, path: "note.md", before: "Hello" }),
    );
    const res = await overlay.readFile("note.md");
    expect((res as any).conflict).toBe(true);
    expect((res as any).reason).toBe("deleted");
  });

  it("DELETE kind returns null if file already gone", async () => {
    overlay.writeChange(
      makeChange({ kind: ChangeKind.DELETE, path: "note.md", before: "Hello" }),
    );
    app.vault._files.delete("note.md");
    const res = await overlay.readFile("note.md");
    expect(res).toBeNull();
  });

  it("writeChange proxies to accumulator", () => {
    expect(acc.has("note.md")).toBe(false);
    const ch = makeChange({
      kind: ChangeKind.MODIFY,
      path: "note.md",
      before: "Hello",
      after: "Hello Matt",
    });
    overlay.writeChange(ch);
    expect(acc.has("note.md")).toBe(true);
  });

  it("apply commits CREATE", async () => {
    const ch = makeChange({
      kind: ChangeKind.CREATE,
      path: "new.md",
      before: undefined,
      after: "Content",
    });
    overlay.writeChange(ch);
    await overlay.flush(["new.md"]);
    const txt = await overlay.readFile("new.md", { raw: true });
    expect(txt).toBe("Content");
    expect(acc.has("new.md")).toBe(false);
  });

  it("apply commits MODIFY", async () => {
    const ch = makeChange({
      kind: ChangeKind.MODIFY,
      path: "note.md",
      before: "Hello",
      after: "Hi",
    });
    overlay.writeChange(ch);
    await overlay.flush(["note.md"]);
    const txt = await overlay.readFile("note.md", { raw: true });
    expect(txt).toBe("Hi");
    expect(acc.has("note.md")).toBe(false);
  });

  it("apply commits DELETE", async () => {
    const ch = makeChange({
      kind: ChangeKind.DELETE,
      path: "note.md",
      before: "Hello",
    });
    overlay.writeChange(ch);
    await overlay.flush(["note.md"]);
    await expect(overlay.readFile("note.md", { raw: true })).rejects.toThrow();
    expect(acc.has("note.md")).toBe(false);
  });
});
