# VaultState ID Reconciliation

This document describes an issue discovered during the Loro → VaultState migration, the investigation process, and the proposed solution.

## Background: Tracking and Proposed

The VaultOverlay maintains two tree structures:

- **Tracking**: Represents the vault state (what's on disk)
- **Proposed**: Represents tracking + AI modifications (what AI wants)

When AI creates or modifies files, changes go to proposed. When the vault changes externally, sync operations update tracking and merge to proposed.

## The Issue: Node ID Mismatch

### How It Manifested

Test `should handle mixed scenarios with overlays, vault files, and deletions` was failing:

```typescript
// Create files in vault
helpers.addFile("folder/vault-file1.md", "vault 1");

// Create files in overlay (AI)
await overlay.create("folder/overlay-file1.md", "overlay 1");

// Modify a vault file through overlay
const vaultFile2 = overlay.getFileByPath("folder/vault-file2.md");
await overlay.modify(vaultFile2, "modified vault 2");

// Expected: folder.children has 4 files
// Actual: "Cannot delete file not found" error
```

### Root Cause

When AI creates "folder/overlay-file.md":
- `proposedFS.ensureDirs("folder")` creates the directory in proposed
- Directory gets ID `3` (from proposed's ID counter)

When vault sync creates "folder/vault-file.md":
- `trackingFS.createNode("folder/vault-file.md")` creates "folder" in tracking
- Directory gets ID `5` (from tracking's ID counter)

After `mergeDocs()`:
- Proposed has TWO "folder" nodes: ID `3` (AI's) and ID `5` (tracking's)
- Files are split between them
- Path lookups find one folder, but some files are under the other

## How Loro Handled This

With Loro CRDT:
- Node IDs included peer ID: tracking nodes like `1:5`, proposed nodes like `2:3`
- `mergeDocs()` used `proposedDoc.import(trackingDoc.export())` which preserved IDs
- When tracking created a node, after merge, proposed had that exact node with the same ID

The original code expected matching IDs:
```typescript
const proposedNode = this.proposedFS.findById(trackingNode.id);
invariant(proposedNode, `...tracking node exists but proposed node not found`);
```

## Investigation: Where ensureDirs Is Called

We traced where directories are created:

| Location | Calls | Creates In |
|----------|-------|------------|
| `_create` (AI creates file) | `proposedFS.ensureDirs()` | Proposed |
| `_modify` (AI modifies file) | `proposedFS.ensureDirs()` | Proposed |
| `rename` (AI renames file) | `proposedFS.ensureDirs()` | Proposed |
| `syncRename` (vault rename) | `trackingFS.ensureDirs()` | Tracking |

The problem: AI operations create directories in proposed first. Vault sync creates directories in tracking later. They get different IDs.

## Key Insight: Directory Structure Should Come From Tracking

Directories are structural - they define the file system hierarchy. The principle:

- **Implicit directories** (created via `ensureDirs` to support a file path): Should be consistent between tracking and proposed
- **Explicit directories** (AI calls `createFolder`): Are proposed changes with `wasCreatedKey`

When sync runs, if a directory already exists in proposed, tracking should adopt proposed's ID rather than creating a new one.

## Implemented Solution: syncDirectory in syncPath

Rather than a two-pass approach in `syncAll`, the solution integrates directory reconciliation directly into `syncPath`. This ensures ID reconciliation happens regardless of how sync is triggered (via `syncAll`, `delete`, `modify`, etc.).

### TreeNode.createChildWithId

Added to `TreeNode` (`src/chat/vault-state/tree-node.ts:106`):

```typescript
createChildWithId(data: NodeData, nodeId: NodeID): TreeNode {
  return executeCreate(this.vaultState, {
    type: 'create',
    nodeId,
    parentId: this.id,
    data
  });
}
```

This follows the existing pattern where `TreeNode` methods construct operations and delegate to execute functions.

### syncDirectory Helper

Added to `VaultOverlay` (`src/chat/vault-overlay.svelte.ts:805`):

```typescript
private syncDirectory(filePath: string): void {
  const trackingState = this.trackingDoc as VaultState;
  const dirPath = dirname(filePath);

  if (dirPath === "." || dirPath === "") return;

  const parts = dirPath.split("/");
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    // Skip if already exists in tracking
    if (trackingState.findByPath(currentPath)) continue;

    // Find parent
    const parentPath = dirname(currentPath);
    const parent = parentPath === "." || parentPath === ""
      ? trackingState.getNode("0")
      : trackingState.findByPath(parentPath);

    if (!parent) continue;

    // Check if proposed has this directory - use its ID for reconciliation
    const proposedNode = this.proposedFS.findByPath(currentPath);

    if (proposedNode) {
      parent.createChildWithId({ name: part, isDirectory: true }, proposedNode.id);
    } else {
      parent.createChild({ name: part, isDirectory: true });
    }
  }
}
```

### Integration into syncPath

`syncPath` calls `syncDirectory` before processing the file:

```typescript
async syncPath(path: string): Promise<any> {
  // ...
  // Sync parent directories with ID reconciliation before syncing the file
  this.syncDirectory(path);
  // ... rest of syncPath
}
```

### Why This Works

Trace through the problematic scenario:

**Step 1: AI creates "folder/overlay-file.md"**
- proposed: `folder(3) → overlay-file.md(4)`

**Step 2: User deletes "folder/vault-file3.md" through overlay**
- `delete()` calls `syncPath("folder/vault-file3.md")`
- `syncPath` calls `syncDirectory("folder/vault-file3.md")`
- `syncDirectory` finds "folder" exists in proposed with ID `3`
- Creates "folder" in tracking with ID `3` using `createChildWithId`
- File sync proceeds with parent directories having matching IDs

**Result:**
- proposed: `folder(3) → [overlay-file.md(4), ...]`
- tracking: `folder(3) → [...]`
- All files under same folder node

## Implementation Summary

- `TreeNode.createChildWithId(data, nodeId)` - creates child with explicit ID
- `VaultOverlay.syncDirectory(filePath)` - syncs parent directories with ID reconciliation
- `syncPath` calls `syncDirectory` before processing files

## Edge Cases

| Case | Handling |
|------|----------|
| Directory in vault, not in proposed | Create with new ID, merge adds to proposed |
| Directory in proposed, not in vault | Untouched (AI-only change, has `wasCreatedKey`) |
| Nested directories | `syncDirectory` iterates from root down, creating parents before children |
| File exists in proposed but not tracking | `syncCreate` handles this (existing logic) |

## Related: The `wasCreatedKey` Flag

Directories have a `wasCreatedKey` flag:
- Set when AI explicitly creates a folder via `createFolder`
- NOT set when directory is created implicitly via `ensureDirs`
- Used in `getFileChanges` to determine which directories are proposed changes
- Directories without this flag are structural and not reported as changes

## Appendix: Original Loro mergeDocs

```typescript
mergeDocs() {
  this.proposedDoc.import(
    this.trackingDoc.export({
      mode: "update",
      from: this.proposedDoc.version(),
    }),
  );
  this.proposedFS.invalidateCache();
}
```

Loro's CRDT import preserved node IDs from tracking. Our VaultState `mergeDocs` replays operations, which now includes the `nodeId` for creates, achieving similar behavior.
