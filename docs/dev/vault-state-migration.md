# Vault State Migration: Loro to Operations Log

## Overview

This document outlines the plan to migrate the vault tree/overlay system from Loro (CRDT) to a simpler operations log architecture with reversible operations.

**Motivation**: The current Loro implementation suffers from performance degradation when reverting multiple times, as Loro stores inverse operations as permanent history. An operations log approach allows O(1) rollback by simply truncating the log and rebuilding the tree, avoiding the exponential slowdown.

## Architecture: Operations Log + Object Model

### Design Philosophy

The architecture combines:
1. **Object-oriented API** (TreeNode) - Clean, intuitive mutations via method calls (like Loro)
2. **Standalone execute functions** - Pure functions that apply operations to the tree
3. **Operations log** - Append-only record of all mutations
4. **Recording flag** - Controls whether mutations are recorded (disabled during rebuild/replay)

### Data Flow

```
User Code
    ↓
TreeNode.createChild() → validates → calls executeCreate() → records operation
TreeNode.modify() → validates → calls executeModify() → records operation
TreeNode.move() → validates → calls executeMove() → records operation
TreeNode.rename() → validates → calls executeRename() → records operation
TreeNode.delete() → validates → calls executeDelete() → records operation
    ↓
Execute functions apply to tree
    ↓
Operations recorded in log
    ↓
VaultState maintains state
```

### Root Node: Infrastructure, Not Data

The root node is a **literal** created in the VaultState constructor, not through operations:
- Root is always present
- Root is never recorded as an operation
- Root cannot be deleted or renamed
- Root is recreated during rebuild

```typescript
constructor() {
  const root = new TreeNode('root', this);  // Literal, not recorded
  root.data = { name: '', isDirectory: true };
  root.parentId = null;
  this.nodeIndex.set('root', root);
  this.tree = root;
}
```

## Phase 1: Foundation ✅ COMPLETE

### Objectives

- Define operation type system
- Create TreeNode class (user-facing API)
- Create VaultState class (data container)
- Establish testing infrastructure

### Deliverables

#### 1. Operation Types (`/src/chat/vault-state/types.ts`)

```typescript
type Operation = CreateOperation | DeleteOperation | ModifyOperation | MoveOperation | RenameOperation;

interface CreateOperation {
  type: 'create';
  nodeId: NodeID;
  parentId: NodeID;
  data: NodeData;
}

interface DeleteOperation {
  type: 'delete';
  nodeId: NodeID;
}

interface ModifyOperation {
  type: 'modify';
  nodeId: NodeID;
  changes: Partial<NodeData>;
}

interface MoveOperation {
  type: 'move';
  nodeId: NodeID;
  newParentId: NodeID;
}

interface RenameOperation {
  type: 'rename';
  nodeId: NodeID;
  newName: string;
}
```

#### 2. TreeNode Class (`/src/chat/vault-state/tree-node.ts`)

**Primary user-facing API** - Users interact with TreeNode methods exclusively.

```typescript
export class TreeNode {
  id: NodeID;
  parentId: NodeID | null = null;
  childIds: NodeID[] = [];
  data: NodeData = { name: '', isDirectory: false };

  constructor(id: NodeID, private vaultState: VaultState) { ... }

  // Create child (like Loro: parent.createNode())
  createChild(nodeId: NodeID, data: NodeData): TreeNode { ... }

  // Mutations
  modify(changes: Partial<NodeData>): void { ... }
  move(newParentNode: TreeNode): void { ... }
  rename(newName: string): void { ... }
  delete(): void { ... }
}
```

**Key properties**:
- Simple constructor: just creates bare node
- `createChild()` returns the created child (intuitive API)
- All mutations validate preconditions (e.g., circular reference check)
- All mutations delegate to execute functions (hidden from users)
- No null-based behavior control

#### 3. VaultState Class (`/src/chat/vault-state/vault-state.ts`)

**Data container and query interface** - Holds state, provides queries, manages operations log.

```typescript
export class VaultState {
  private tree: TreeNode;
  private nodeIndex: Map<NodeID, TreeNode> = new Map();
  private operationsLog: Operation[] = [];
  private recordingEnabled: boolean = true;

  constructor(private peerId: 'tracking' | 'proposed') {
    // Root node is a literal, not an operation
    const root = new TreeNode('root', this);
    root.data = { name: '', isDirectory: true };
    root.parentId = null;
    this.nodeIndex.set('root', root);
    this.tree = root;
  }

  // Query API
  getNode(nodeId: NodeID): TreeNode | null { ... }
  findByPath(path: string): TreeNode | null { ... }
  getNodePath(nodeId: NodeID): string { ... }
  getDescendants(nodeId: NodeID): TreeNode[] { ... }

  // Operation Log API
  getOperations(type?: string): Operation[] { ... }
  getOperationsForNode(nodeId: NodeID): Operation[] { ... }
  checkpoint(): number { ... }
  rollback(checkpointIndex: number): void { ... }
  getLogLength(): number { ... }

  // Internal (for execute functions)
  recordOperation(op: Operation): void { ... }
  addNode(node: TreeNode): void { ... }
  removeNode(nodeId: NodeID): void { ... }
}
```

#### 4. Test Helpers (`/tests/vault-state/test-helpers.ts`)

Simple, clean test API:

```typescript
const root = state.getNode('root')!;
const file = root.createChild('n1', { name: 'test.md', isDirectory: false });
file.modify({ text: 'content' });
expect(state.getLogLength()).toBe(2);  // 1 create + 1 modify
```

### Validation Checkpoints ✅

- ✅ Type checking passes
- ✅ TreeNode constructor is simple (no magic)
- ✅ VaultState stores root as literal
- ✅ All types properly defined
- ✅ Test infrastructure ready

---

## Phase 2: Implementation ✅ COMPLETE

### Objectives

- Implement standalone execute functions
- Implement TreeNode mutations
- Implement VaultState data management
- Implement deterministic rebuild
- Full test coverage

### Key Design Decisions

#### 1. Execute Functions Record Themselves

**Pattern**: Each execute function is responsible for its own recording.

```typescript
export function executeCreate(state: VaultState, op: CreateOperation): void {
  const parent = state.getNode(op.parentId);
  if (!parent) throw new Error(`Parent not found: ${op.parentId}`);

  const newNode = new TreeNode(op.nodeId, state);
  newNode.parentId = op.parentId;
  newNode.data = { ...op.data };

  parent.childIds.push(op.nodeId);
  state.addNode(newNode);

  // Record operation (respects recordingEnabled flag)
  state.recordOperation(op);
}
```

**Advantages**:
- No wrapper functions needed
- Recording logic colocated with operation logic
- `recordingEnabled` flag prevents duplicate recording during rebuild
- Single code path for mutations and replay

#### 2. TreeNode Mutations Delegate to Execute Functions

**Pattern**: TreeNode methods validate, then call execute functions.

```typescript
export class TreeNode {
  createChild(nodeId: NodeID, data: NodeData): TreeNode {
    executeCreate(this.vaultState, {
      type: 'create',
      nodeId,
      parentId: this.id,
      data
    });
    return this.vaultState.getNode(nodeId)!;
  }

  modify(changes: Partial<NodeData>): void {
    executeModify(this.vaultState, {
      type: 'modify',
      nodeId: this.id,
      changes
    });
  }

  move(newParentNode: TreeNode): void {
    // Validate circular reference
    let current: TreeNode | null = newParentNode;
    while (current) {
      if (current.id === this.id) {
        throw new Error(`Cannot move node under its own descendant`);
      }
      current = current.parentId ? this.vaultState.getNode(current.parentId) : null;
    }

    executeMove(this.vaultState, {
      type: 'move',
      nodeId: this.id,
      newParentId: newParentNode.id
    });
  }

  rename(newName: string): void {
    if (this.id === 'root') throw new Error('Cannot rename root');

    executeRename(this.vaultState, {
      type: 'rename',
      nodeId: this.id,
      newName
    });
  }

  delete(): void {
    if (this.id === 'root') throw new Error('Cannot delete root');

    executeDelete(this.vaultState, {
      type: 'delete',
      nodeId: this.id
    });
  }
}
```

#### 3. Deterministic Tree Rebuild

**Pattern**: Rebuild disables recording, replays all operations.

```typescript
private rebuildTreeFromLog(): void {
  this.recordingEnabled = false;  // Prevent double-recording

  try {
    this.nodeIndex.clear();

    // Create root as literal
    const root = new TreeNode('root', this);
    root.data = { name: '', isDirectory: true };
    root.parentId = null;
    this.nodeIndex.set('root', root);
    this.tree = root;

    // Replay all operations
    for (let i = 0; i < this.operationsLog.length; i++) {
      const op = this.operationsLog[i];
      try {
        executeOperation(this, op);  // Execute functions respects recordingEnabled
      } catch (e) {
        throw new Error(`Failed to replay operation #${i} (${op.type}): ${e.message}`);
      }
    }
  } finally {
    this.recordingEnabled = true;  // Always restore
  }
}
```

**Properties**:
- Deterministic: Same log always produces same tree
- Idempotent: Multiple rebuilds produce identical trees
- Safe: try/finally guarantees flag restoration
- Efficient: Single-pass replay

### Test Coverage

**107 tests passing**, all focusing on the TreeNode API and operations behavior.

Examples:

```typescript
// Creating nodes
const root = state.getNode('root')!;
const file = root.createChild('n1', { name: 'test.md', isDirectory: false });
expect(state.getLogLength()).toBe(1);

// Modifying
file.modify({ text: 'content' });
expect(file.data.text).toBe('content');
expect(state.getLogLength()).toBe(2);

// Moving
const folder = root.createChild('d1', { name: 'folder', isDirectory: true });
file.move(folder);
expect(file.parentId).toBe('d1');
expect(state.getLogLength()).toBe(4);

// Circular reference prevention
expect(() => folder.move(file)).toThrow('circular reference');

// Rollback
const checkpoint = state.checkpoint();
root.createChild('n2', { name: 'temp.md', isDirectory: false });
state.rollback(checkpoint);
expect(state.getNode('n2')).toBeNull();
```

### Validation Checkpoints ✅

- ✅ All 107 tests pass
- ✅ Root node is literal
- ✅ TreeNode API is Loro-like
- ✅ Execute functions record themselves
- ✅ Rebuild is deterministic and idempotent
- ✅ Rollback works correctly
- ✅ Circular references detected
- ✅ No null-based behavior control

---

## Phase 3: Trash/Restore System ✅ COMPLETE

**Status**: Fully implemented with 16 new tests passing (123 total)

### Design Philosophy

This phase minimizes deviations from the original Loro-based implementation. We replicate the soft-delete mechanism using simple operations without adding special trash operation types.

### Key Clarifications

1. **Infrastructure Folders as Literals**
   - `.overlay-trash` and `.overlay-tmp` are created as literal nodes in VaultState constructor
   - Mirrors the original implementation (tree-fs.ts lines 101-106)
   - These are infrastructure, not user-created nodes

2. **No Special Trash Operations**
   - Soft-delete = MOVE operation to trash + MODIFY operation to set `deletedFrom` metadata
   - Keep the operations log simple; optimize later if needed
   - Trash behavior is identical to original: node data preserved, metadata added

3. **Sync vs Approval Are Distinct Workflows**
   - **Sync**: Reconcile vault changes into proposed (external source of truth → tracking → proposed)
     - Reads from vault file system
     - Updates tracking (the source of truth)
     - Imports tracking updates into proposed to reconcile changes
     - Uses Loro's LoroText edit-based merging (Phase 4 will handle differently)
   - **Approval**: User approves/rejects AI changes
     - User selects which proposed changes to approve
     - Approved changes move from proposed to tracking
     - Both sync and approval update cache state

4. **RenameTracker Remains Independent**
   - RenameTracker is not Loro-dependent
   - Works with stable NodeIDs from operations log
   - Will continue to function unchanged through public TreeNode API

5. **This Is a Refactor, Not a Redesign**
   - No behavior changes
   - Serialization format should be identical to Loro snapshots
   - All edge cases and features from original must be preserved

### Implementation Tasks

1. **Create Infrastructure Folders as Literals**
   - Add `.overlay-trash` folder to VaultState constructor
   - Add `.overlay-tmp` folder to VaultState constructor
   - Both created with isDirectory=true, never recorded as operations

2. **Implement TreeNode Helper Methods**
   - `trash(originalPath: string): void` - MOVE to trash + set `deletedFrom` metadata
   - `restore(parentNode: TreeNode): void` - Remove `deletedFrom` + MOVE to parent

3. **Update Operation Types (If Needed)**
   - Verify NodeData can carry `deletedFrom` as metadata
   - MODIFY operation already supports arbitrary field changes

4. **Add Tests**
   - Trash a file, verify it's in trash and `deletedFrom` is set
   - Restore a trashed file to its original location
   - Restore to different parent (moving while restoring)
   - Verify trashed nodes are not part of normal tree traversal

### Deliverables ✅

**Infrastructure Folders** (Created as literals in constructor)
- `.overlay-trash` folder for soft-deleted nodes
- `.overlay-tmp` folder for temporary staging
- Both created as literals, never recorded as operations

**TreeNode Methods**
- `trash(originalPath: string): void` - Moves node to trash, sets `deletedFrom` metadata
- `restore(parentNode: TreeNode): void` - Restores from trash, removes metadata
- `isTrashed(): boolean` - Helper to check if node is in trash

**VaultState Methods**
- `getTrashFolder(): TreeNode` - Returns trash folder infrastructure node
- `findTrashed(originalPath: string): TreeNode | null` - Finds node in trash by original path

**Operations Recorded**
- MOVE operation when node moves to/from trash
- MODIFY operation to set/unset `deletedFrom` metadata
- No special trash operations - keeps log simple

**Test Coverage**
- Infrastructure folder creation and properties
- Trashing files and directories
- Restoring from trash
- Preventing trash of infrastructure nodes
- Rollback and rebuild with trashed nodes
- Finding trashed nodes by original path
- All tests pass (123 total)

### Important Notes for Phase 4/5

**Text Merging**: Loro's LoroText provides edit-based CRDT merging. When syncing, Loro automatically merges concurrent edits from vault and proposed. In Phase 4, when integrating VaultState with vault sync:
- Need to implement three-way merge for text content
- Compare (vault baseline, tracking current, proposed desired)
- Cannot rely on Loro's automatic CRDT merging

---

## Phase 4: Method Migration (Single Backend Swap)

**Status**: Planned

### Key Changes from Original Plan

**No dual-write approach** - The tests are comprehensive enough that we can:
1. Replace Loro calls with VaultState calls in VaultOverlay
2. Run tests to validate behavior equivalence
3. Fix any issues that arise during testing

This is simpler than dual-write because:
- Tests catch inconsistencies immediately
- No wrapper logic to maintain
- Cleaner code path

### Implementation Strategy

1. Replace VaultOverlay methods one at a time
2. Run vault-overlay test suite after each method
3. Keep RenameTracker (existing, not refactored)
4. Ensure all operations flow through TreeNode API

---

## File Structure

```
src/chat/vault-state/
├── index.ts                  (exports)
├── types.ts                  (Operation, NodeData, NodeID, etc.)
├── tree-node.ts              (TreeNode class - user API)
├── vault-state.ts            (VaultState class - data container)
└── operations.ts             (executeCreate, executeDelete, etc.)

tests/vault-state/
├── types.spec.ts             (type definitions)
├── tree-node.spec.ts         (TreeNode API tests)
├── vault-state.spec.ts       (VaultState tests)
└── vault-state-phase2.spec.ts (Phase 2 tests - rebuild, rollback, etc.)
```

---

## Key Insights

### Why This Design Works

1. **No null-based behavior** - TreeNode constructor is always simple; behavior not hidden in conditions
2. **Single code path** - Execute functions used for both mutations and rebuild; recordingEnabled flag prevents duplication
3. **Standalone functions** - Execute functions are pure; no state coupling makes testing and debugging easy
4. **Clear separation** - TreeNode validates and delegates; execute functions apply; VaultState manages storage
5. **Loro-compatible API** - TreeNode.createChild() mirrors Loro's parent.createNode(); less refactor friction
6. **Recording is automatic** - No need for wrapper methods or helper functions; execute functions handle recording

### Performance Characteristics

| Operation | Cost | Notes |
|-----------|------|-------|
| createChild | O(1) | Add to parent, add to index |
| modify | O(1) | Update node data |
| move | O(1) | Update parent references |
| rename | O(1) | Update name field |
| delete | O(d) | d = descendants to remove |
| findByPath | O(depth) | Tree traversal |
| rollback | O(n) | n = operations to replay |
| rebuild | O(n) | Full operation replay |

---

---

**Document Status**: Phases 1-3 ✅ COMPLETE
**Next Phase**: Phase 4 (Method Migration - Single Backend Swap)
**Last Updated**: October 24, 2024

### Progress Summary

| Phase | Status | Tests | Notes |
|-------|--------|-------|-------|
| 1 | ✅ Complete | Types, TreeNode structure | Foundation |
| 2 | ✅ Complete | 107 tests | Execute functions, rebuild, rollback |
| 3 | ✅ Complete | 123 tests | Trash/restore, infrastructure folders |
| 4 | 📋 Planned | - | Direct backend swap, no dual-write |
| 5 | 📋 Planned | - | Workflow refactoring |
| 6 | 📋 Planned | - | JSON serialization |
| 7 | 📋 Planned | - | Cleanup & Loro removal |
| 8 | 📋 Planned | - | Performance optimization |
