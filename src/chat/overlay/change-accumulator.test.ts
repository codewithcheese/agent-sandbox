import { describe, it, expect, beforeEach } from "vitest";
import { ChangeAccumulator } from "./change-accumulator";
import {
  type TrackedChange,
  type CreateChange,
  type ModifyChange,
  type DeleteChange,
  type RenameChange,
  ChangeKind,
  // EffectiveCompositeChange is not directly created by makeChange, but is a result type
} from "./change";

let changeIdCounter = 0;
const newId = () => `test-id-${changeIdCounter++}`;

const BASE_FILE = "note.md";
const RENAMED_FILE = "note-renamed.md";

function makeChange(props: Partial<TrackedChange>): TrackedChange {
  const fullProps = {
    id: newId(),
    turn: 1,
    timestamp: Date.now() + changeIdCounter * 10, // Ensure unique, ordered timestamps
    description: "unit-test",
    messageId: props.messageId || "m1",
    path: props.path || BASE_FILE,
    ...props,
  };

  switch (fullProps.kind) {
    case ChangeKind.CREATE:
      return {
        ...fullProps,
        after: fullProps.after ?? "",
        before: undefined,
      } as CreateChange;
    case ChangeKind.MODIFY:
      return {
        ...fullProps,
        before: fullProps.before ?? "",
        after: fullProps.after ?? "",
      } as ModifyChange;
    case ChangeKind.DELETE:
      return {
        ...fullProps,
        before: fullProps.before ?? "",
        after: undefined,
      } as DeleteChange;
    case ChangeKind.RENAME:
      return {
        ...fullProps,
        oldPath: fullProps.oldPath || BASE_FILE,
        path: fullProps.path || RENAMED_FILE,
        before: undefined,
        after: undefined,
      } as RenameChange;
    default:
      throw new Error(
        `Invalid change kind for makeChange: ${(fullProps as any).kind}`,
      );
  }
}

describe("ChangeAccumulator", () => {
  let acc: ChangeAccumulator;

  beforeEach(() => {
    acc = new ChangeAccumulator();
    changeIdCounter = 0;
  });

  it("stores first create and get returns it as composite", () => {
    const createOp = makeChange({ kind: ChangeKind.CREATE, after: "Hi" });
    acc.add(createOp);
    const composite = acc.get(BASE_FILE);
    expect(composite).toBeDefined();
    expect(composite?.kind).toBe(ChangeKind.CREATE);
    expect(composite?.after).toBe("Hi");
    expect(composite?.before).toBeUndefined();
    expect(composite?.path).toBe(BASE_FILE);
    expect(composite?.id).toBe(createOp.id);
  });

  it("merge create→modify results in CREATE composite with updated after", () => {
    const createOp = makeChange({
      kind: ChangeKind.CREATE,
      after: "Hi",
      messageId: "m1",
    });
    acc.add(createOp);
    const modifyOp = makeChange({
      kind: ChangeKind.MODIFY,
      before: "Hi",
      after: "Hello",
      messageId: "m2",
    });
    acc.add(modifyOp);

    const composite = acc.get(BASE_FILE)!;
    expect(composite.kind).toBe(ChangeKind.CREATE);
    expect(composite.before).toBeUndefined();
    expect(composite.after).toBe("Hello");
    expect(composite.path).toBe(BASE_FILE);
    expect(composite.id).toBe(modifyOp.id);
  });

  it("create followed by delete cancels entry, get returns null", () => {
    acc.add(makeChange({ kind: ChangeKind.CREATE, after: "Hi" }));
    acc.add(makeChange({ kind: ChangeKind.DELETE, before: "Hi" }));

    expect(acc.get(BASE_FILE)).toBeNull();
  });

  it("delete→create becomes MODIFY composite", () => {
    const deleteOp = makeChange({
      kind: ChangeKind.DELETE,
      before: "Initial content",
      messageId: "m1",
    });
    acc.add(deleteOp);
    const createOp = makeChange({
      kind: ChangeKind.CREATE,
      after: "Hello, world!",
      messageId: "m2",
    });
    acc.add(createOp);

    const composite = acc.get(BASE_FILE)!;
    expect(composite.kind).toBe(ChangeKind.MODIFY);
    expect(composite.before).toBe("Initial content");
    expect(composite.after).toBe("Hello, world!");
    expect(composite.id).toBe(createOp.id);
  });

  it("handles rename: get(newPath) returns composite, get(oldPath) is null", () => {
    const modifyOp = makeChange({
      kind: ChangeKind.MODIFY,
      before: "Old",
      after: "New",
      path: BASE_FILE,
    });
    acc.add(modifyOp);
    const renameOp = makeChange({
      kind: ChangeKind.RENAME,
      oldPath: BASE_FILE,
      path: RENAMED_FILE,
    });
    acc.add(renameOp);

    expect(acc.get(RENAMED_FILE)).not.toBeNull();
    expect(acc.get(BASE_FILE)).toBeNull();
    expect(acc.paths()).toEqual([RENAMED_FILE]);

    const composite = acc.get(RENAMED_FILE)!;
    expect(composite.kind).toBe(ChangeKind.MODIFY);
    expect(composite.path).toBe(RENAMED_FILE);
    expect(composite.renamedFrom).toBe(BASE_FILE);
    expect(composite.before).toBe("Old");
    expect(composite.after).toBe("New");
    expect(composite.id).toBe(renameOp.id);
  });

  it("sequence: create -> modify -> rename -> modify", () => {
    const c1 = makeChange({
      kind: ChangeKind.CREATE,
      after: "A",
      path: "file.txt",
      timestamp: 100,
    });
    const c2 = makeChange({
      kind: ChangeKind.MODIFY,
      path: "file.txt",
      before: "A",
      after: "B",
      timestamp: 200,
    });
    const c3 = makeChange({
      kind: ChangeKind.RENAME,
      path: "file_new.txt",
      oldPath: "file.txt",
      timestamp: 300,
    });
    const c4 = makeChange({
      kind: ChangeKind.MODIFY,
      path: "file_new.txt",
      before: "B",
      after: "C",
      timestamp: 400,
    });
    acc.add(c1);
    acc.add(c2);
    acc.add(c3);
    acc.add(c4);

    const composite = acc.get("file_new.txt")!;
    expect(composite.kind).toBe(ChangeKind.CREATE);
    expect(composite.before).toBeUndefined();
    expect(composite.after).toBe("C");
    expect(composite.path).toBe("file_new.txt");
    expect(composite.renamedFrom).toBe("file.txt");
    expect(composite.id).toBe(c4.id);
    expect(composite.timestamp).toBe(c4.timestamp);
  });

  describe("discard", () => {
    it("removes changes associated with a messageId, recalculates composite", () => {
      const c1 = makeChange({
        kind: ChangeKind.CREATE,
        after: "Content1",
        messageId: "msg1",
      });
      const c2 = makeChange({
        kind: ChangeKind.MODIFY,
        before: "Content1",
        after: "Content2",
        messageId: "msg2",
      });
      acc.add(c1);
      acc.add(c2);

      acc.discard("msg1"); // Discard CREATE

      const composite = acc.get(BASE_FILE);
      expect(composite).toBeDefined();
      // Only MODIFY from msg2 remains. Its 'before' was "Content1".
      expect(composite?.kind).toBe(ChangeKind.MODIFY);
      expect(composite?.before).toBe("Content1");
      expect(composite?.after).toBe("Content2");
      expect(composite?.id).toBe(c2.id);
    });

    it("recalculates composite after discarding an intermediate change", () => {
      const c1 = makeChange({
        kind: ChangeKind.CREATE,
        after: "A",
        messageId: "m1",
        timestamp: 100,
      });
      const c2 = makeChange({
        kind: ChangeKind.MODIFY,
        before: "A",
        after: "B",
        messageId: "m2",
        timestamp: 200,
      });
      const c3 = makeChange({
        kind: ChangeKind.MODIFY,
        before: "B",
        after: "C",
        messageId: "m3",
        timestamp: 300,
      });
      acc.add(c1);
      acc.add(c2);
      acc.add(c3);

      acc.discard("m2"); // Remove the A->B modification

      const composite = acc.get(BASE_FILE)!;
      // Remaining: Create "A" (m1), then Modify "B"->"C" (m3).
      // Composite should be: Create, before: undefined, after: "C" (from m3 applied to m1's state)
      expect(composite.kind).toBe(ChangeKind.CREATE);
      expect(composite.before).toBeUndefined();
      expect(composite.after).toBe("C");
      expect(composite.id).toBe(c3.id);
    });

    it("handles discarding a rename operation (simplified discard)", () => {
      // This test reflects the behavior of the current simpler discardByMessageId.
      // A more complex discard would move the path key if the RENAME was essential.
      const c1 = makeChange({
        kind: ChangeKind.CREATE,
        after: "Content",
        path: "original.txt",
        messageId: "m1",
        timestamp: 100,
      });
      const c2 = makeChange({
        kind: ChangeKind.RENAME,
        oldPath: "original.txt",
        path: "renamed.txt",
        messageId: "m2",
        timestamp: 200,
      });
      const c3 = makeChange({
        kind: ChangeKind.MODIFY,
        path: "renamed.txt",
        before: "Content",
        after: "New Content",
        messageId: "m3",
        timestamp: 300,
      });
      acc.add(c1);
      acc.add(c2); // Establishes "renamed.txt" as the key for [c1, c2]
      acc.add(c3); // Appends to list at "renamed.txt" -> [c1, c2, c3]

      acc.discard("m2"); // Discard the RENAME (c2)
      // List at "renamed.txt" is now [c1, c3] (c1 has path original.txt, c3 has path renamed.txt)

      expect(acc.get("original.txt")).toBeNull(); // Key "original.txt" was deleted by RENAME add.
      expect(acc.get("renamed.txt")).not.toBeNull(); // Key "renamed.txt" still exists with [c1, c3].

      const composite = acc.get("renamed.txt")!;
      // Sequence: c1 (Create@original.txt), c3 (Modify@renamed.txt)
      // `applyNextIndividualChange` will use c3's path for the composite.
      expect(composite.kind).toBe(ChangeKind.CREATE); // From c1
      expect(composite.path).toBe("renamed.txt"); // Path from c3
      expect(composite.before).toBeUndefined();
      expect(composite.after).toBe("New Content"); // After from c3
      expect(composite.id).toBe(c3.id);
      expect(composite.renamedFrom).toBeUndefined(); // The RENAME op (c2) is gone
    });

    it("removes changes associated with a specific message ID", () => {
      // Add a change with messageId "msgA"
      acc.add(
        makeChange({
          kind: ChangeKind.CREATE,
          after: "X",
          messageId: "msgA",
        }),
      );

      // Discard the message
      acc.discard("msgA");

      // The change should be removed
      expect(acc.get(BASE_FILE)).toBeNull();

      // Reset and test with multiple changes to the same file from different messages
      acc.reset();

      // First change from message A
      acc.add(
        makeChange({
          kind: ChangeKind.CREATE,
          after: "Initial content",
          messageId: "msgA",
        }),
      );

      // Second change from message B
      acc.add(
        makeChange({
          kind: ChangeKind.MODIFY,
          before: "Initial content",
          after: "Modified content",
          messageId: "msgB",
        }),
      );

      // Discard message B
      acc.discard("msgB");

      // The composite should reflect only the first change
      const composite = acc.get(BASE_FILE);
      expect(composite).not.toBeNull();
      expect(composite?.kind).toBe(ChangeKind.CREATE);
      expect(composite?.after).toBe("Initial content");
    });

    it("correctly handles discarding a change with a specific messageId", () => {
      const change = makeChange({
        kind: ChangeKind.CREATE,
        after: "Shared",
        messageId: "m2",
      });
      acc.add(change);

      acc.discard("m2"); // Discard the message

      // When the message is discarded, the change should be removed
      expect(acc.get(BASE_FILE)).toBeNull();
    });

    it("handles multiple changes from the same messageId correctly", () => {
      acc.add(
        makeChange({
          kind: ChangeKind.CREATE,
          path: "file1.txt",
          after: "F1",
          messageId: "m1",
        }),
      );
      acc.add(
        makeChange({
          kind: ChangeKind.CREATE,
          path: "file2.txt",
          after: "F2",
          messageId: "m1",
        }),
      );
      acc.add(
        makeChange({
          kind: ChangeKind.CREATE,
          path: "file3.txt",
          after: "F3",
          messageId: "m2",
        }),
      );

      acc.discard("m1");
      expect(acc.get("file1.txt")).toBeNull();
      expect(acc.get("file2.txt")).toBeNull();
      expect(acc.get("file3.txt")).not.toBeNull();
      expect(acc.paths()).toEqual(["file3.txt"]);
    });

    it("applies patches when before content doesn't match after discarding", () => {
      // Create a sequence where removing the middle change requires patching
      const c1 = makeChange({
        kind: ChangeKind.CREATE,
        after: "Hello, world!",
        messageId: "m1",
      });
      const c2 = makeChange({
        kind: ChangeKind.MODIFY,
        before: "Hello, world!",
        after: "Hello, Matt!",
        messageId: "m2",
      });
      const c3 = makeChange({
        kind: ChangeKind.MODIFY,
        before: "Hello, Matt!",
        after: "Goodbye, World!",
        messageId: "m3",
      });

      acc.add(c1);
      acc.add(c2);
      acc.add(c3);

      // Discard the middle change
      acc.discard("m2");

      // The composite should show patching was applied
      const composite = acc.get(BASE_FILE);
      expect(composite).not.toBeNull();
      expect(composite?.kind).toBe(ChangeKind.CREATE);
      expect(composite?.after).toBe("Goodbye, World!");
    });

    it("handles cases where patching fails", () => {
      // Create a sequence where patching would fail due to incompatible changes
      const c1 = makeChange({
        kind: ChangeKind.CREATE,
        after: "Completely different content",
        messageId: "m1",
      });
      const c2 = makeChange({
        kind: ChangeKind.MODIFY,
        before: "Completely different content",
        after: "Modified intermediate",
        messageId: "m2",
      });
      const c3 = makeChange({
        kind: ChangeKind.MODIFY,
        before: "Modified intermediate",
        after: "Final content",
        messageId: "m3",
      });

      acc.add(c1);
      acc.add(c2);
      acc.add(c3);

      // Discard the middle change - patching should fail due to incompatible content
      acc.discard("m2");

      // The composite force applies the after state
      const composite = acc.get(BASE_FILE);
      expect(composite).not.toBeNull();
      expect(composite?.kind).toBe(ChangeKind.CREATE);
      expect(composite?.after).toBe("Final content");
    });

    it("handles discarding a non-existent messageId gracefully", () => {
      const c1 = makeChange({
        kind: ChangeKind.CREATE,
        after: "Content",
        messageId: "m1",
      });
      acc.add(c1);

      // Initial state
      expect(acc.get(BASE_FILE)).not.toBeNull();

      // Discard a non-existent messageId
      acc.discard("non-existent");

      // Should not affect existing changes
      expect(acc.get(BASE_FILE)).not.toBeNull();
      expect(acc.get(BASE_FILE)?.after).toBe("Content");
    });

    it("handles discarding from an empty changes list", () => {
      // No changes added
      acc.discard("any-message");
      // Should not throw errors
      expect(acc.paths().length).toBe(0);
    });
  });
});
