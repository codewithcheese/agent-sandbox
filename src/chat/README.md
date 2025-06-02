## Vault Overlay

Below is a structured "code-walk" of the **VaultOverlay** implementation, focusing on the main moving parts, how the overlay interleaves with an Obsidian `Vault`, and where open edges still exist.  (I'll use *tracking* = baseline vault contents and *proposed* = working edits terminology throughout.)

### 1. High-level architecture

| Layer                | Purpose                                                                                                                                        | Key types                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Underlying vault** | The real on-disk Obsidian vault.                                                                                                               | `Vault`, `TFile`, `TFolder`, `TAbstractFile` |
| **Tracking doc**     | *Accepted* state of the overlay, mirrored from disk plus any edits that have been explicitly "approved".                                       | `LoroDoc` (peerId = `1`)                     |
| **Proposed doc**     | *Working copy* that soaks up all user / AI edits before review.                                                                                | `LoroDoc` (peerId = `2`)                     |
| **TreeFS abstraction** | Path-based operations over Loro tree structure with caching and path resolution.                                                             | `TreeFS`                                     |
| **Overlay facade**   | Swaps in for the normal `Vault` so Obsidian code (or your plugin logic) can read/write *through* it without real disk mutation until approval. | `VaultOverlay implements Vault`              |

The overlay therefore gives you a **cheap, CRDT-based transaction layer**: calls such as `create`, `modify`, `rename`, `delete` operate only on the *proposed* tree; nothing touches disk until you run the `approve()` method (or write your own reconciler).

---

### 2. Data-model inside Loro

```
"LoroTree"  (key = "vault")
└── root  (name:"", isDirectory:true)
    ├── .overlay-trash  (isDirectory:true) - soft deletion storage
    ├── folder nodes    (isDirectory:true)
    │   └── child …
    └── file nodes      (isDirectory:false, text:<LoroText>|buffer:<ArrayBuffer>, stat:<FileStats>)
```

* Each path element is a separate **tree node**; folders carry `isDirectory:true`.
* Files embed a **`LoroText` container** for text content or `ArrayBuffer` for binary files, plus `FileStats`.
* Node identity (`id: TreeID`) is stable across renames, so the overlay can tell a rename from a delete + create.
* Deleted files are moved to `.overlay-trash` with `deletedFrom` metadata for soft deletion.

---

### 3. Lifecycle & sync flow

1. **Construction**

    * If snapshots are supplied: reload `trackingDoc`/`proposedDoc` from saved state.
    * Else: create empty tracking doc with root and trash nodes → clone snapshot into proposed (`this.proposedDoc = LoroDoc.fromSnapshot(trackingSnapshot)`).
    * Creates `TreeFS` wrappers for both docs and computes initial changes.

2. **Read path** (`getFileByPath`, `getFolderByPath`, …)

    * Check **proposed** first.

        * If node exists but in trash → treat as non-existent.
        * Else build a full `TFile`/`TFolder` wrapper with proper stat data and children enumeration.
    * Fall through to **tracking** for stale path checks (prevents reading files that were renamed in proposed).
    * Finally, fall back to the real vault, updating vault reference to overlay.

3. **Write-time ops** (`create`, `modify`, `rename`, `delete`)

    * Always mutate **proposed**; calls end with `this.proposedDoc.commit()` then `computeChanges()`.
    * Several guards prevent path traversal (`..`), duplicate dest paths, etc.
    * Text updates choose `updateByLine` once `length > 50 kB`, mirroring Loro's best-practice for large blobs.
    * Binary files supported via `createBinary`/`readBinary` with `ArrayBuffer` storage.
    * Deletion moves files to `.overlay-trash` folder with `deletedFrom` metadata.

4. **Review-time helpers**

    * `getFileChanges()` diff-scans *proposed* vs *tracking* and classifies into **added / deleted / modified**.
    * `approve(approvals)` takes an array of node IDs and optional content overrides, determines operation types (create/modify/delete/rename/move), applies them to tracking **and then** calls `syncDocs()` to pull tracking's new state back into proposed (so proposed becomes "clean").

5. **Disk synchronisation**

    * `syncPath()` – on demand, import the current on-disk content of a path into tracking, merge to proposed, and re-diff.
    * `syncDelete()` – handles vault file deletions by removing from tracking and syncing docs.
    * `syncVault()` placeholder – full bulk reconcile is "TODO".

---

### 4. Diff algorithm (`getFileChanges`)

1. Build a lookup of **all node ids** appearing in either tree.
2. For every node id:

    * **+id only in proposed** → `added`.
    * **id in both but `deletedFrom` flag** → `deleted`.
    * **id in both, same name/parent but `text` differs** → `modified`.
    * **name | parent moved** → also `modified`.
3. Root node is always skipped.
4. Results are placed in `this.changes` (declared as a reactive `$state<Change[]>` so a Svelte UI can watch it).

---

### 5. Integration gaps & caveats

| Category                      | Detail                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Un-implemented Vault APIs** | Many reading & event APIs (`getAllLoadedFiles`, `getAllFolders`, `getMarkdownFiles`, `getFiles`, `on`, `adapter`, …) still `throw`. Any plugin code that hits those will break.       |
| **Binary file limitations**   | `modifyBinary`, `append`, `process`, `copy` not implemented. Read/create binary works via ArrayBuffer storage.                                                                          |
| **Event system**              | No event bus implementation (`on`, `off`, `trigger`) - events are not propagated to listeners.                                                                                          |
| **Case sensitivity**          | No normalisation for case on case-insensitive file systems (macOS default/HFS+). Two files `foo.md` vs `Foo.md` could co-exist in the overlay even though the real FS wouldn't allow it. |
| **Concurrency / locking**     | No mutex around Loro commits; concurrent plugin reads + edits in different ticks could race.                                                                                             |
| **Large vault bootstrap**     | `syncVault()` still TODO. At present, you lazily pull files as soon as an operation touches them; first run against a big vault may cause "File not found" errors if you miss a path.    |

---

### 6. Strengths of this design

* **CRDT correctness** – by using Loro's causally-ordered ops, the overlay can accept simultaneous edits from multiple agents (user, AI, remote) without corruption.
* **Fast diffing** – change detection is O(#nodes), no disk I/O.
* **Transactional review** – nothing hits disk until you call `approve()`, so a UI can offer *git-style staging* for the user to accept/reject.
* **Rename safety** – stable node IDs let you tell true renames from delete + add even when the filename and parent both change.
* **Binary support** – handles both text and binary files with appropriate storage mechanisms.
* **Soft deletion** – deleted files preserved in trash system for potential recovery.

---

### 7. Immediate improvement opportunities

| Area                       | Suggestion                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vault API surface**      | Flesh out the read-only getters (`getAllLoadedFiles`, `getMarkdownFiles`, `getFiles`) and event bus (`on`, `trigger`) so other plugins don't crash.        |
| **Binary operations**      | Implement remaining binary operations (`modifyBinary`, `append`, `process`, `copy`) for full binary file support.                                           |
| **Case handling**          | Lower-case compare on create/rename when running on mac / Windows.                                                                                           |
| **Background vault sync**  | Finish `syncVault()` (walk disk → tracking) and maybe add FS watchers to keep tracking fresh without user action.                                           |
| **Event diff granularity** | Right now every change forces a full re-diff; for large trees you could incrementally flag changed nodes in the same commit loop.                            |
| **Event propagation**      | Implement event system so other plugins can listen to overlay changes.                                                                                       |

---

### 8. TL;DR

*VaultOverlay* is effectively a **two-phase commit layer** for Obsidian:

1. *proposed* collects edits in a Loro CRDT tree with TreeFS abstraction.
2. *tracking* shadows the real vault state.
3. A lightweight diff + atomic `approve()` API lets you materialise or discard changes at will.
4. Soft deletion via trash system preserves change history.
5. Binary file support for images/PDFs alongside text files.

The current implementation supports **text and binary file editing workflows** with proper folder enumeration and file stats, making it suitable for AI assistant integration, but you'll need to flesh out the remaining Vault APIs and event system before you can drop it into a full plugin that interacts with other plugins.