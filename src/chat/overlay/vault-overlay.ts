import { App, TFile } from "obsidian";
import { diff_match_patch } from "diff-match-patch";
import { ChangeKind, type TrackedChange } from "./change.ts";
import { ChangeAccumulator } from "./change-accumulator.ts";

export interface ConflictBundle {
  conflict: true;
  reason: "text" | "deleted";
  disk: string | null; // null if file missing
  staged?: string; // "after" text when applicable
  base?: string | undefined;
}

interface ReadOpts {
  /** If true, bypass the overlay and read straight from disk */
  raw?: boolean;
}

/**
 * Lazy‑reconciling view of the vault that first checks the ChangeAccumulator
 * before hitting disk.  It transparently re‑bases pending edits onto the latest
 * on‑disk text whenever a caller invokes {@link readFile}.
 */
export class VaultOverlay {
  private dmp = new diff_match_patch();

  constructor(
    private app: App,
    private acc: ChangeAccumulator,
  ) {}

  async readFile(
    path: string,
    opts: ReadOpts = {},
  ): Promise<string | ConflictBundle | null> {
    if (opts.raw) {
      const file = this.app.vault.getFileByPath(path);
      return file ? this.app.vault.read(file) : null;
    }

    const entry = this.acc.get(path);
    const file = this.app.vault.getFileByPath(path);
    const disk = file ? await this.app.vault.read(file) : null;

    if (!entry) return disk;

    switch (entry.kind) {
      case ChangeKind.DELETE: {
        // File scheduled for deletion.
        if (disk === null) return null; // already gone, no conflict.
        return {
          conflict: true,
          reason: "deleted",
          disk,
          base: entry.before,
        } satisfies ConflictBundle;
      }

      case ChangeKind.CREATE:
      case ChangeKind.MODIFY: {
        // Fast path – still based on same snapshot.
        if (disk === entry.before || entry.before === undefined) {
          return entry.after;
        }

        // Try automatic re‑base.
        // todo: review and test this logic
        const patch = this.dmp.patch_make(entry.before ?? "", entry.after);
        const [merged, res] = this.dmp.patch_apply(patch, disk ?? "");
        const ok = res.every(Boolean);

        if (ok) {
          entry.before = disk ?? "";
          entry.after = merged;
          this.acc.update(path, entry);
          return merged;
        }

        return {
          conflict: true,
          reason: "text",
          disk,
          staged: entry.after,
          base: entry.before,
        } satisfies ConflictBundle;
      }

      case ChangeKind.RENAME:
        // Should not be reached under the *old* path. Under the new path there
        // will be a CREATE or MODIFY entry, so simply fall through.
        return disk;
    }
  }

  /**
   * Add a new write‑operation coming from a tool call. For now we just delegate
   * to the accumulator so the editor UI can pick it up.
   */
  writeChange(change: Omit<TrackedChange, "id">) {
    this.acc.add(change);
  }

  /**
   * Flushes selected paths to disk, respecting kind semantics and conflict
   * guards.  Minimal implementation – you can layer UI‑driven selection later.
   */
  async flush(paths?: string[]) {
    const target = paths ?? this.acc.paths();

    for (const p of target) {
      const ch = this.acc.get(p);
      if (!ch) continue;

      switch (ch.kind) {
        case ChangeKind.CREATE:
          await this.ensureParentExists(p);
          await this.app.vault.create(p, ch.after);
          break;
        case ChangeKind.MODIFY:
          const disk = await this.readDisk(p);
          if (disk !== ch.before) {
            throw new Error(`Conflict on ${p}: disk changed since snapshot.`);
          }
          await this.app.vault.modify(this.getFile(p), ch.after);
          break;
        case ChangeKind.DELETE:
          await this.app.vault.delete(this.getFile(p));
          break;
        case ChangeKind.RENAME:
          await this.app.vault.rename(this.getFile(ch.oldPath), ch.path);
          break;
      }

      this.acc.discard(ch.id);
    }
  }

  /*───────────────────── helpers ─────────────────────*/

  private tryPatch(before: string, after: string, live: string) {
    const patchList = this.dmp.patch_make(before, after);
    const [merged, results] = this.dmp.patch_apply(patchList, live);
    return {
      merged,
      ok: results.every(Boolean),
    };
  }

  private async readDisk(path: string): Promise<string> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return this.app.vault.cachedRead(file);
  }

  private getFile(path: string): TFile {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error(`Expected file at ${path}`);
    return file;
  }

  private async ensureParentExists(path: string) {
    const parts = path.split("/").slice(0, -1);
    if (parts.length === 0) return;
    let folderPath = "";
    for (const part of parts) {
      folderPath = folderPath ? `${folderPath}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(folderPath)) {
        await this.app.vault.createFolder(folderPath);
      }
    }
  }
}
