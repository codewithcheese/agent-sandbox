import { ChangeKind, type RenameChange, type TrackedChange } from "./change.ts";
import { nanoid } from "nanoid";

export class ChangeAccumulator {
  private byPath = new Map<string, TrackedChange>();

  reset() {
    this.byPath.clear();
  }

  has(path: string) {
    return this.byPath.has(path);
  }

  get(path: string) {
    return this.byPath.get(path);
  }

  paths(): readonly string[] {
    return Array.from(this.byPath.keys());
  }

  add(newChange: Omit<TrackedChange, "id">): TrackedChange | null {
    const change = { id: nanoid(), ...newChange } as TrackedChange;

    // Rename needs special handling: we must re‑key the Map to the *old* path
    // first, so we can find a prior change, then store under the new path.
    if (change.kind === ChangeKind.RENAME) {
      return this.handleRename(change);
    }

    const prev = this.byPath.get(change.path);
    if (!prev) {
      this.byPath.set(change.path, change);
      return change;
    }

    const merged = this.merge(prev, change);
    if (merged) {
      this.byPath.set(merged.path, merged);
    } else {
      this.byPath.delete(prev.path);
    }
    return merged;
  }

  update(path: string, change: TrackedChange) {
    this.byPath.set(path, change);
  }

  discard(id: string) {
    for (const [path, ch] of this.byPath) {
      if (ch.id === id) {
        this.byPath.delete(path);
        break;
      }
    }
  }

  /*───────────────────────────────────────────────────────────────────────────*/
  /*  Internal helpers                                                       */
  /*───────────────────────────────────────────────────────────────────────────*/

  private handleRename(
    change: TrackedChange & RenameChange,
  ): TrackedChange | null {
    // If there was a pending change on the OLD path, merge it first.
    const prev = this.byPath.get(change.oldPath);
    if (prev) {
      this.byPath.delete(change.oldPath);
      const merged = { ...prev, ...change } as TrackedChange;
      this.byPath.set(change.path, merged);
      return merged;
    }
    // No previous edits – store under the new path.
    this.byPath.set(change.path, change);
    return change;
  }

  /**
   * Merge two non‑rename changes that share the same path.
   * Returns null if they cancel out.
   */
  private merge(a: TrackedChange, b: TrackedChange): TrackedChange | null {
    // create ▸ delete  or  delete ▸ create
    if (a.kind === ChangeKind.CREATE && b.kind === ChangeKind.DELETE)
      return null;
    if (a.kind === ChangeKind.DELETE && b.kind === ChangeKind.CREATE) {
      return {
        ...b,
        kind: ChangeKind.MODIFY,
        before: a.before, // `before` is defined on DELETE
      } as TrackedChange;
    }

    // create ▸ modify  → still CREATE (update the after text only)
    if (a.kind === ChangeKind.CREATE && b.kind === ChangeKind.MODIFY) {
      return {
        ...a, // keeps kind: CREATE and original before (undefined)
        ...b, // takes newer after / metadata
        kind: ChangeKind.CREATE,
        before: undefined, // stays undefined
      } as TrackedChange;
    }

    // Generic merge – preserve oldest before; overwrite after/meta.
    const before = "before" in a ? (a as any).before : undefined;
    return {
      ...a,
      ...b,
      before,
    } as TrackedChange;
  }
}
