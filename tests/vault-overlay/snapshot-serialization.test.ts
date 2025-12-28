import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultOverlay } from "../../src/chat/vault-overlay.svelte.ts";
import { VaultState } from "../../src/chat/vault-state/vault-state.ts";
import { helpers, vault } from "../mocks/obsidian.ts";
import type { TFile } from "obsidian";

/**
 * Helper to compare two VaultState instances for equivalence.
 * Checks paths, content, IDs, and metadata.
 */
function assertStatesEqual(actual: VaultState, expected: VaultState) {
  // Compare operations log length
  expect(actual.getLogLength()).toBe(expected.getLogLength());

  // Collect all paths from both states (excluding infrastructure)
  const actualPaths = collectPaths(actual);
  const expectedPaths = collectPaths(expected);

  expect(actualPaths.sort()).toEqual(expectedPaths.sort());

  // Compare each node
  for (const path of actualPaths) {
    const actualNode = actual.findByPath(path);
    const expectedNode = expected.findByPath(path);

    expect(actualNode, `Node at ${path} should exist in actual`).toBeTruthy();
    expect(expectedNode, `Node at ${path} should exist in expected`).toBeTruthy();

    // Compare IDs
    expect(actualNode!.id).toBe(expectedNode!.id);

    // Compare data
    expect(actualNode!.data.name).toBe(expectedNode!.data.name);
    expect(actualNode!.data.isDirectory).toBe(expectedNode!.data.isDirectory);
    expect(actualNode!.text).toBe(expectedNode!.text);

    // Compare binary content
    if (expectedNode!.buffer) {
      expect(actualNode!.buffer).toBeTruthy();
      expect(
        new Uint8Array(actualNode!.buffer!)
      ).toEqual(
        new Uint8Array(expectedNode!.buffer!)
      );
    }

    // Compare stats
    if (expectedNode!.stat) {
      expect(actualNode!.stat).toEqual(expectedNode!.stat);
    }

    // Compare metadata
    expect(actualNode!.deletedFrom).toBe(expectedNode!.deletedFrom);
  }
}

function collectPaths(state: VaultState): string[] {
  const paths: string[] = [];
  const root = state.getNode("0");
  if (root) {
    collectPathsRecursive(state, root, "", paths);
  }
  return paths.filter(p =>
    p !== "" &&
    !p.startsWith(".overlay-trash") &&
    !p.startsWith(".overlay-tmp")
  );
}

function collectPathsRecursive(
  state: VaultState,
  node: ReturnType<VaultState["getNode"]>,
  parentPath: string,
  paths: string[]
) {
  if (!node) return;
  const path = parentPath ? `${parentPath}/${node.data.name}` : node.data.name;
  if (path) paths.push(path);
  for (const childId of node.childIds) {
    const child = state.getNode(childId);
    collectPathsRecursive(state, child, path, paths);
  }
}

describe("snapshot serialization", () => {
  describe("VaultState round-trip", () => {
    describe("GIVEN empty state", () => {
      it("SHOULD serialize and deserialize to equivalent state", () => {
        const original = new VaultState("proposed");

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        expect(restored.getLogLength()).toBe(0);
        expect(restored.findByPath(".overlay-trash")).toBeTruthy();
        expect(restored.findByPath(".overlay-tmp")).toBeTruthy();
      });
    });

    describe("GIVEN text files", () => {
      it("SHOULD preserve text content through round-trip", () => {
        const original = new VaultState("proposed");
        original.createAtPath("simple.md", { isDirectory: false, text: "Hello world" });
        original.createAtPath("unicode.md", { isDirectory: false, text: "Hello 🌍 世界 مرحبا" });
        original.createAtPath("empty.md", { isDirectory: false, text: "" });
        original.createAtPath("multiline.md", {
          isDirectory: false,
          text: "Line 1\nLine 2\nLine 3"
        });

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        assertStatesEqual(restored, original);
      });
    });

    describe("GIVEN binary files", () => {
      it("SHOULD preserve binary content through round-trip", () => {
        const original = new VaultState("proposed");

        // Create binary content
        const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
        const buffer = bytes.buffer;

        original.createAtPath("binary.bin", { isDirectory: false, buffer });

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        const restoredNode = restored.findByPath("binary.bin")!;
        expect(restoredNode.buffer).toBeTruthy();
        expect(new Uint8Array(restoredNode.buffer!)).toEqual(bytes);
      });
    });

    describe("GIVEN file with stats", () => {
      it("SHOULD preserve mtime, ctime, size through round-trip", () => {
        const original = new VaultState("proposed");
        const stat = { mtime: 1704067200000, ctime: 1704067100000, size: 42 };
        original.createAtPath("with-stat.md", { isDirectory: false, text: "content", stat });

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        const restoredNode = restored.findByPath("with-stat.md")!;
        expect(restoredNode.stat).toEqual(stat);
      });
    });

    describe("GIVEN nested directory structure", () => {
      it("SHOULD preserve tree hierarchy through round-trip", () => {
        const original = new VaultState("proposed");
        original.createAtPath("a/b/c/deep.md", { isDirectory: false, text: "deep file" });
        original.createAtPath("a/sibling.md", { isDirectory: false, text: "sibling" });
        original.createAtPath("root.md", { isDirectory: false, text: "root level" });

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        assertStatesEqual(restored, original);

        // Verify parent relationships
        const deepNode = restored.findByPath("a/b/c/deep.md")!;
        const cFolder = restored.findByPath("a/b/c")!;
        expect(deepNode.parentId).toBe(cFolder.id);
      });
    });

    describe("GIVEN all operation types", () => {
      it("SHOULD preserve operations through round-trip", () => {
        const original = new VaultState("proposed");

        // CREATE
        original.createAtPath("file1.md", { isDirectory: false, text: "original" });
        original.createAtPath("folder", { isDirectory: true });

        // MODIFY
        const file1 = original.findByPath("file1.md")!;
        file1.text = "modified";

        // RENAME
        file1.rename("renamed.md");

        // MOVE
        const folder = original.findByPath("folder")!;
        file1.move(folder);

        // Verify state before serialization
        expect(original.findByPath("folder/renamed.md")).toBeTruthy();
        expect(original.findByPath("folder/renamed.md")!.text).toBe("modified");

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        // Verify same state after deserialization
        expect(restored.findByPath("folder/renamed.md")).toBeTruthy();
        expect(restored.findByPath("folder/renamed.md")!.text).toBe("modified");
        assertStatesEqual(restored, original);
      });
    });

    describe("GIVEN trashed files", () => {
      it("SHOULD preserve deletedFrom metadata through round-trip", () => {
        const original = new VaultState("proposed");
        original.createAtPath("to-delete.md", { isDirectory: false, text: "will be trashed" });

        const node = original.findByPath("to-delete.md")!;
        node.trash("to-delete.md");

        expect(original.findTrashed("to-delete.md")).toBeTruthy();

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        const trashedNode = restored.findTrashed("to-delete.md");
        expect(trashedNode).toBeTruthy();
        expect(trashedNode!.deletedFrom).toBe("to-delete.md");
        expect(trashedNode!.text).toBe("will be trashed");
      });
    });

    describe("GIVEN MODIFY with previousText", () => {
      it("SHOULD preserve previousText for three-way merge", () => {
        const original = new VaultState("proposed");
        original.createAtPath("file.md", { isDirectory: false, text: "base text" });

        const node = original.findByPath("file.md")!;
        node.text = "modified text";

        const serialized = original.serialize();

        // Check that previousText is in the serialized operations
        const modifyOp = serialized.operationsLog.find(
          op => op.type === "modify" && "text" in (op as any).changes
        );
        expect(modifyOp).toBeTruthy();
        expect((modifyOp as any).previousText).toBe("base text");

        // Verify round-trip
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        expect(restored.findByPath("file.md")!.text).toBe("modified text");
      });
    });

    describe("GIVEN node IDs", () => {
      it("SHOULD preserve exact node IDs through round-trip", () => {
        const original = new VaultState("proposed");
        original.createAtPath("file1.md", { isDirectory: false, text: "one" });
        original.createAtPath("file2.md", { isDirectory: false, text: "two" });
        original.createAtPath("folder/file3.md", { isDirectory: false, text: "three" });

        const originalIds = {
          file1: original.findByPath("file1.md")!.id,
          file2: original.findByPath("file2.md")!.id,
          file3: original.findByPath("folder/file3.md")!.id,
          folder: original.findByPath("folder")!.id,
        };

        const serialized = original.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        expect(restored.findByPath("file1.md")!.id).toBe(originalIds.file1);
        expect(restored.findByPath("file2.md")!.id).toBe(originalIds.file2);
        expect(restored.findByPath("folder/file3.md")!.id).toBe(originalIds.file3);
        expect(restored.findByPath("folder")!.id).toBe(originalIds.folder);
      });
    });
  });

  describe("JSON serialization", () => {
    describe("GIVEN complex state", () => {
      it("SHOULD be valid JSON (no circular references)", () => {
        const state = new VaultState("proposed");
        state.createAtPath("a/b/c.md", { isDirectory: false, text: "nested" });
        state.createAtPath("binary.bin", {
          isDirectory: false,
          buffer: new Uint8Array([1, 2, 3]).buffer
        });

        const serialized = state.serialize();

        // Should not throw
        const json = JSON.stringify(serialized);
        expect(typeof json).toBe("string");

        // Should parse back
        const parsed = JSON.parse(json);
        expect(parsed.operationsLog).toBeTruthy();
      });

      it("SHOULD be idempotent (serialize twice produces same result)", () => {
        const state = new VaultState("proposed");
        state.createAtPath("file.md", { isDirectory: false, text: "content" });
        const node = state.findByPath("file.md")!;
        node.text = "modified";

        const json1 = JSON.stringify(state.serialize());

        // Deserialize and serialize again
        const restored = VaultState.deserialize("proposed", JSON.parse(json1));
        const json2 = JSON.stringify(restored.serialize());

        expect(json2).toBe(json1);
      });
    });
  });

  describe("VaultOverlay integration", () => {
    let overlay: VaultOverlay;

    beforeEach(() => {
      overlay = new VaultOverlay(vault);
    });

    afterEach(async () => {
      await helpers.reset();
    });

    describe("GIVEN overlay with AI modifications", () => {
      beforeEach(async () => {
        // Vault file
        const existingFile = helpers.addFile("existing.md", "vault content");
        await overlay.modify(existingFile, "AI modified");

        // AI created file
        await overlay.create("ai-created.md", "AI content");

        // AI renamed file
        const toRename = helpers.addFile("old-name.md", "rename me");
        await overlay.modify(toRename, "rename me"); // sync first
        await overlay.rename(overlay.getFileByPath("old-name.md"), "new-name.md");
      });

      it("SHOULD preserve both tracking and proposed through round-trip", () => {
        const snapshot = overlay.snapshot();
        const json = JSON.stringify(snapshot);
        const parsed = JSON.parse(json);

        // Create new overlay from snapshot
        const restored = new VaultOverlay(vault, parsed);

        // Tracking should have vault content
        expect(restored.trackingDoc.findByPath("existing.md")!.text).toBe("vault content");
        expect(restored.trackingDoc.findByPath("old-name.md")!.text).toBe("rename me");

        // Proposed should have AI modifications
        expect(restored.proposedDoc.findByPath("existing.md")!.text).toBe("AI modified");
        expect(restored.proposedDoc.findByPath("ai-created.md")!.text).toBe("AI content");
        expect(restored.proposedDoc.findByPath("new-name.md")!.text).toBe("rename me");
        expect(restored.proposedDoc.findByPath("old-name.md")).toBeUndefined();
      });

      it("SHOULD detect same changes after round-trip", () => {
        const changesBefore = overlay.getFileChanges();

        const snapshot = overlay.snapshot();
        const json = JSON.stringify(snapshot);
        const parsed = JSON.parse(json);
        const restored = new VaultOverlay(vault, parsed);

        const changesAfter = restored.getFileChanges();

        // Same number of changes
        expect(changesAfter.length).toBe(changesBefore.length);

        // Same change types and paths
        const sortChanges = (c: typeof changesBefore) =>
          [...c].sort((a, b) => a.path.localeCompare(b.path));

        expect(sortChanges(changesAfter)).toEqual(sortChanges(changesBefore));
      });
    });

    describe("GIVEN overlay with trashed files", () => {
      beforeEach(async () => {
        const file = helpers.addFile("to-delete.md", "delete me");
        await overlay.modify(file, "delete me"); // sync
        await overlay.delete(file);
      });

      it("SHOULD preserve delete change after round-trip", () => {
        const snapshot = overlay.snapshot();
        const json = JSON.stringify(snapshot);
        const parsed = JSON.parse(json);
        const restored = new VaultOverlay(vault, parsed);

        const changes = restored.getFileChanges();
        expect(changes.length).toBe(1);
        expect(changes[0].type).toBe("delete");
        expect(changes[0].path).toBe("to-delete.md");
      });
    });

    describe("GIVEN empty overlay", () => {
      it("SHOULD serialize and restore with no changes", () => {
        const snapshot = overlay.snapshot();
        const json = JSON.stringify(snapshot);
        const parsed = JSON.parse(json);
        const restored = new VaultOverlay(vault, parsed);

        expect(restored.getFileChanges().length).toBe(0);
      });
    });
  });

  describe("Edge cases", () => {
    describe("GIVEN binary content with null bytes", () => {
      it("SHOULD preserve all byte values including 0x00", () => {
        const state = new VaultState("proposed");
        const bytes = new Uint8Array([0x00, 0x00, 0xFF, 0x00, 0x7F]);
        state.createAtPath("nulls.bin", { isDirectory: false, buffer: bytes.buffer });

        const serialized = state.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        const restoredBytes = new Uint8Array(restored.findByPath("nulls.bin")!.buffer!);
        expect(restoredBytes).toEqual(bytes);
      });
    });

    describe("GIVEN special characters in file names", () => {
      it("SHOULD preserve names with spaces and unicode", () => {
        const state = new VaultState("proposed");
        state.createAtPath("file with spaces.md", { isDirectory: false, text: "a" });
        state.createAtPath("文件.md", { isDirectory: false, text: "b" });
        state.createAtPath("emoji 🎉.md", { isDirectory: false, text: "c" });

        const serialized = state.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        expect(restored.findByPath("file with spaces.md")).toBeTruthy();
        expect(restored.findByPath("文件.md")).toBeTruthy();
        expect(restored.findByPath("emoji 🎉.md")).toBeTruthy();
      });
    });

    describe("GIVEN large binary file", () => {
      it("SHOULD handle larger buffers", () => {
        const state = new VaultState("proposed");
        // 64KB of data
        const bytes = new Uint8Array(65536);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = i % 256;
        }
        state.createAtPath("large.bin", { isDirectory: false, buffer: bytes.buffer });

        const serialized = state.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = VaultState.deserialize("proposed", parsed);

        const restoredBytes = new Uint8Array(restored.findByPath("large.bin")!.buffer!);
        expect(restoredBytes.length).toBe(65536);
        expect(restoredBytes).toEqual(bytes);
      });
    });
  });
});
