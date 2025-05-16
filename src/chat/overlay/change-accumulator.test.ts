import { describe, it, expect, beforeEach } from "vitest";
import { ChangeAccumulator } from "./change-accumulator.ts";
import { type Change, ChangeKind, type TrackedChange } from "./change";

const BASE_FILE = "note.md";

function makeChange(change: Change): TrackedChange {
  return {
    id: "test-id",
    kind: ChangeKind.MODIFY,
    path: BASE_FILE,
    turn: 1,
    timestamp: Date.now(),
    description: "unit-test",
    messageIds: ["m1"],
    ...change,
  } as TrackedChange;
}

describe("ChangeAccumulator", () => {
  it("stores first create", () => {
    const ch = makeChange({
      kind: ChangeKind.CREATE,
      after: "Hi",
      before: undefined,
      path: BASE_FILE,
    });
    const acc = new ChangeAccumulator();
    acc.add(ch);
    expect(acc.get(BASE_FILE)).toBeDefined();
  });

  it("merge create→modify keeps original before", () => {
    const acc = new ChangeAccumulator();
    acc.add(
      makeChange({
        kind: ChangeKind.CREATE,
        after: "Hi",
        before: undefined,
        path: BASE_FILE,
      }),
    );
    const merged = acc.add(
      makeChange({
        kind: ChangeKind.MODIFY,
        before: "Hi",
        after: "Hello",
        path: BASE_FILE,
      }),
    )!;
    expect((merged as any).before).toBe(undefined);
    expect((merged as any).after).toBe("Hello");
  });

  it("create followed by delete cancels entry", () => {
    const acc = new ChangeAccumulator();
    acc.add(
      makeChange({
        kind: ChangeKind.CREATE,
        after: "Hi",
        before: undefined,
        path: BASE_FILE,
      }),
    );
    const res = acc.add(
      makeChange({ kind: ChangeKind.DELETE, before: "Hi", path: BASE_FILE }),
    );
    expect(res).toBeNull();
    expect(acc.has(BASE_FILE)).toBe(false);
  });

  it("delete→create becomes modify", () => {
    const acc = new ChangeAccumulator();
    acc.add(
      makeChange({ kind: ChangeKind.DELETE, before: "Hi", path: BASE_FILE }),
    );
    const merged = acc.add(
      makeChange({
        kind: ChangeKind.CREATE,
        after: "Hello, world!",
        before: undefined,
        path: BASE_FILE,
      }),
    )!;
    expect(merged.kind).toBe(ChangeKind.MODIFY);
    expect((merged as any).before).toBe("Hi");
    expect((merged as any).after).toBe("Hello, world!");
  });

  it("handles rename re‑keying", () => {
    const acc = new ChangeAccumulator();
    acc.add(
      makeChange({
        kind: ChangeKind.MODIFY,
        after: "Hi",
        before: "Hello",
        path: BASE_FILE,
      }),
    );
    const rename = acc.add(
      makeChange({
        kind: ChangeKind.RENAME,
        oldPath: BASE_FILE,
        path: "note-renamed.md",
      }),
    )!;
    expect(acc.has("note-renamed.md")).toBe(true);
    expect(acc.has(BASE_FILE)).toBe(false);
    expect(rename.kind).toBe(ChangeKind.RENAME);
  });
});
