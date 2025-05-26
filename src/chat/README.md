## Vault Overlay

Below is a structured “code-walk” of the **VaultOverlay** implementation, focusing on the main moving parts, how the overlay interleaves with an Obsidian `Vault`, and where open edges still exist.  (I’ll use *master* = baseline vault contents and *staging* = proposed edits terminology throughout.)

### 1. High-level architecture

| Layer                | Purpose                                                                                                                                        | Key types                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Underlying vault** | The real on-disk Obsidian vault.                                                                                                               | `Vault`, `TFile`, `TFolder`, `TAbstractFile` |
| **Master doc**       | *Accepted* state of the overlay, mirrored from disk plus any edits that have been explicitly “approved”.                                       | `LoroDoc` (peerId = `1`)                     |
| **Staging doc**      | *Working copy* that soaks up all user / AI edits before review.                                                                                | `LoroDoc` (peerId = `2`)                     |
| **Overlay facade**   | Swaps in for the normal `Vault` so Obsidian code (or your plugin logic) can read/write *through* it without real disk mutation until approval. | `VaultOverlay implements Vault`              |

The overlay therefore gives you a **cheap, CRDT-based transaction layer**: calls such as `create`, `modify`, `rename`, `delete` operate only on the *staging* tree; nothing touches disk until you run one of the `approve*` helpers (or write your own reconciler).

---

### 2. Data-model inside Loro

```
"LoroTree"  (key = "vault")
└── root  (name:"", isDirectory:true)
    ├── folder nodes   (isDirectory:true)
    │   └── child …
    └── file nodes     (isDirectory:false, text:<LoroText container>)
```

* Each path element is a separate **tree node**; folders live by convention (ending “/”) and carry `isDirectory`.
* Files embed a **`LoroText` container** for line-granular CRDT editing.
* Node identity (`id: TreeID`) is stable across renames, so the overlay can tell a rename from a delete + create.

---

### 3. Lifecycle & sync flow

1. **Construction**

    * If snapshots are supplied: reload `masterDoc`/`stagingDoc`.
    * Else: create empty master → clone snapshot into staging (`this.stagingDoc = LoroDoc.fromSnapshot(masterSnapshot)`).

2. **Read path** (`getFileByPath`, `getFolderByPath`, …)

    * Check **staging** first.

        * If node exists but `isDeleted` → treat as non-existent.
        * Else build a *minimal* `TFile`/`TFolder` wrapper so downstream code can act as if the file exists.
    * Fall through to **master** for stale path checks (prevents reading files that were renamed in staging).
    * Finally, fall back to the real vault.

3. **Write-time ops** (`create`, `modify`, `rename`, `delete`)

    * Always mutate **staging**; calls end with `this.stagingDoc.commit()` then `computeChanges()`.
    * Several guards prevent path traversal (`..`), duplicate dest paths, delete-non-empty-folder, etc.
    * Text updates choose `updateByLine` once `length > 50 kB`, mirroring Loro’s best-practice for large blobs.

4. **Review-time helpers**

    * `getFileChanges()` diff-scans *staging* vs *master* and classifies into **added / deleted / modified**.
    * `approveModify` / `approveDelete` / `approveRename` *apply* a change to master **and then** call `syncDocs()` to pull master’s new state back into staging (so staging becomes “clean”).

5. **Disk synchronisation**

    * `syncPath()` – on demand, import the current on-disk content of a path into master, merge to staging, and re-diff.
    * `syncVault()` placeholder – full bulk reconcile is “TODO”.

---

### 4. Diff algorithm (`getFileChanges`)

1. Build a lookup of **all node ids** appearing in either tree.
2. For every node id:

    * **+id only in staging** → `added`.
    * **id in both but `isDeleted` flag** → `deleted`.
    * **id in both, same name/parent but `text` differs** → `modified`.
    * **name | parent moved** → also `modified`.
3. Root node is always skipped.
4. Results are placed in `this.changes` (declared as a reactive `$state<Change[]>` so a Svelte UI can watch it).

---

### 5. Integration gaps & caveats

| Category                      | Detail                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Un-implemented Vault APIs** | Many reading & event APIs (`getAllFiles`, `on`, `adapter`, …) still `throw`. Any plugin code that hits those will break.                                                                 |
| **Binary files**              | `createBinary`, `modifyBinary`, `readBinary` all `throw`. Overlay is markdown-only today.                                                                                                |
| **`TFile` / `TFolder` stubs** | Returned objects are *minimal* (e.g., no `stat`, `children` list always empty). Some Obsidian core code relies on these fields.                                                          |
| **Deletion semantics**        | Deleting marks `isDeleted` but **keeps the node parked at its old path**, which blocks re-use of the same path until deletion is approved. (Comment in code notes this tension.)         |
| **Case sensitivity**          | No normalisation for case on case-insensitive file systems (macOS default/HFS+). Two files `foo.md` vs `Foo.md` could co-exist in the overlay even though the real FS wouldn’t allow it. |
| **Concurrency / locking**     | No mutex around Loro commits; concurrent plugin reads + edits in different ticks could race.                                                                                             |
| **Large vault bootstrap**     | `syncVault()` still TODO. At present, you lazily pull files as soon as an operation touches them; first run against a big vault may cause “File not found” errors if you miss a path.    |

---

### 6. Strengths of this design

* **CRDT correctness** – by using Loro’s causally-ordered ops, the overlay can accept simultaneous edits from multiple agents (user, AI, remote) without corruption.
* **Fast diffing** – change detection is O(#nodes), no disk I/O.
* **Transactional review** – nothing hits disk until you call an `approve*`, so a UI can offer *git-style staging* for the user to accept/reject.
* **Rename safety** – stable node IDs let you tell true renames from delete + add even when the filename and parent both change.

---

### 7. Immediate improvement opportunities

| Area                       | Suggestion                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vault API surface**      | Flesh out at least the read-only getters (`getAllLoadedFiles`, `getMarkdownFiles`, `getFiles`) and event bus (`on`, `trigger`) so other plugins don’t crash. |
| **Binary object support**  | Attach a `LoroBinary` container (or store blobs in `node.data`) to unblock images/PDFs.                                                                      |
| **Folder children**        | Populate `TFolder.children` from staging tree so Obsidian’s explorer view can iterate.                                                                       |
| **Case handling**          | Lower-case compare on create/rename when running on mac / Windows.                                                                                           |
| **Background vault sync**  | Finish `syncVault()` (walk disk → master) and maybe add FS watchers to keep master fresh without user action.                                                |
| **Event diff granularity** | Right now every change forces a full re-diff; for large trees you could incrementally flag changed nodes in the same commit loop.                            |
| **Deletion parking**       | Consider moving deleted nodes to a hidden “graveyard” branch so the original path immediately becomes free again.                                            |

---

### 8. TL;DR

*VaultOverlay* is effectively a **two-phase commit layer** for Obsidian:

1. *staging* collects edits in a Loro CRDT tree.
2. *master* shadows the real vault.
3. A lightweight diff + explicit `approve*` APIs let you materialise or discard each change at will.

The current skeleton is already good enough for **text-only, per-file editing workflows** (e.g., an AI assistant rewriting markdown), but you’ll need to flesh out binary handling, folder listings, and the remaining Vault APIs before you can drop it into a full plugin.
