# Chat System

The chat system provides an AI-powered interface for working with Obsidian vaults. The core architectural feature is the **VaultOverlay** - a transactional layer that allows AI modifications to be staged, reviewed, and approved before being written to disk.

## VaultOverlay Architecture

### Two-State Model

VaultOverlay maintains two parallel tree states:

| State | Purpose | Source of Truth |
|-------|---------|-----------------|
| **tracking** | Mirrors vault (what's on disk) | Obsidian vault |
| **proposed** | tracking + AI modifications | AI tool calls |

```
AI Tools ──► proposed state ──► user review ──► approve() ──► tracking state ──► disk
                                     │
                                     └──► reject() ──► rollback proposed
```

Both states are instances of `VaultState` (`vault-state/vault-state.ts`), which represents files and folders as a tree with an operations log.

### Operations Log

All mutations are recorded as operations (CREATE, DELETE, MODIFY, MOVE, RENAME). This enables:

- **Rollback**: Truncate log and rebuild tree from remaining operations
- **Persistence**: Serialize operations as JSON for chat file storage
- **Change Detection**: Compare tracking vs proposed to identify changes

### Key Components

| Component | Path | Purpose |
|-----------|------|---------|
| VaultOverlay | `vault-overlay.svelte.ts` | Main orchestrator, implements `Vault` interface |
| VaultState | `vault-state/vault-state.ts` | Tree + operations log |
| TreeNode | `vault-state/tree-node.ts` | Node mutation API |
| MetadataCacheOverlay | `metadata-cache-overlay.ts` | Link resolution against proposed state |
| RenameTracker | `rename-tracker.ts` | Global vault rename event log |

### Sync and Merge

When the vault changes externally (user edits outside of AI):

- `syncPath()` updates tracking to match vault
- `mergeDocs()` propagates tracking changes to proposed
- Three-way merge resolves conflicts when both AI and vault modified same file

See `docs/dev/three-way-merge-in-mergedocs.md` for merge implementation details.

### ID Consistency

Nodes have stable IDs that are shared between tracking and proposed. This enables:

- Detecting renames (same ID, different path)
- Correlating nodes across states during sync

When creating nodes in tracking that already exist in proposed, the proposed node's ID is used.

See `docs/dev/vault-state-id-reconciliation.md` for the ID matching strategy.

### Soft Delete

Deleted files are moved to `.overlay-trash` with `deletedFrom` metadata recording the original path. This enables:

- Change detection (tracking exists, proposed is trashed = delete)
- Potential restore during reject

## Integration

### Chat System (`chat.svelte.ts`)

- Creates VaultOverlay instance for each chat session
- Provides overlay as the vault for AI tools
- Creates checkpoints before AI turns for revert capability
- Serializes vault state in `.chat` files via `chat-serializer.ts`

### AI Tools

Tools receive VaultOverlay as their vault. When they call `vault.create()`, `vault.modify()`, etc., changes go to proposed state only.

### UI

`ChangesList.svelte` displays proposed changes. Users can approve (write to disk) or reject (rollback proposed).
