# Vault State Migration: Loro to Operations Log

## Overview

This document outlines the plan to migrate the vault tree/overlay system from Loro (CRDT) to a simpler operations log architecture with reversible operations.

**Motivation**: The current Loro implementation suffers from performance degradation when reverting multiple times, as Loro stores inverse operations as permanent history. An operations log approach allows O(1) rollback by simply truncating the log and rebuilding the tree, avoiding the exponential slowdown.

## Architecture: Operations Log + Object Model

### Design Philosophy

The architecture combines:
1. **Auto-generated Node IDs** - Simple, deterministic integer counters (as strings: "0", "1", "2", ...)
2. **Object-oriented API** (TreeNode) - Clean, intuitive mutations via method calls (like Loro)
3. **Standalone execute functions** - Pure functions that apply operations to the tree
4. **Operations log** - Append-only record of all mutations
5. **Recording flag** - Controls whether mutations are recorded (disabled during rebuild/replay)

### Node ID Generation

Node IDs are **auto-generated and not controlled by the caller**:
- TreeNode has static `nextId` counter starting at 0
- Each `new TreeNode(vaultState)` call increments the counter
- Root naturally gets ID "0" as the first node created
- IDs are simple integers (as strings): "0", "1", "2", etc.
- During tree rebuild, counter is reset via `TreeNode.resetIdCounter()` for deterministic replay

**Benefits**:
- Simple, readable IDs in operation logs
- No need to pass IDs as arguments - reduces API surface
- Deterministic: replaying operations in same order produces identical IDs
- Replay is idempotent: same log always produces same tree structure

### Data Flow

```
User Code
    ↓
TreeNode.createChild() → creates node with auto-generated ID
                      → validates
                      → calls executeCreate()
                      → records operation (without nodeId - ID auto-generated)

TreeNode.modify/move/rename/delete() → similar pattern, nodeId already known from `this.id`
    ↓
Execute functions apply to tree
    ↓
Operations recorded in log
    ↓
VaultState maintains state
```

### Root Node & Infrastructure Folders

The root node is a **literal** created in the VaultState constructor:
- Root is always ID "0"
- Root is never recorded as an operation
- Root cannot be deleted or renamed
- Root is recreated during rebuild (ID counter reset first)

Infrastructure folders (`.overlay-trash`, `.overlay-tmp`) are created via `createChild()`:
- Created with recording disabled so they don't appear in operations log
- Get auto-generated IDs naturally (usually "1" and "2" after root "0")
- Found by name lookup, not hardcoded ID
- Recreated during rebuild with same IDs due to deterministic counter

```typescript
constructor() {
  TreeNode.resetIdCounter();  // Ensure root gets "0"

  this.tree = new TreeNode(this);  // Gets ID "0"
  this.tree.data = { name: '', isDirectory: true };
  this.tree.parentId = null;
  this.nodeIndex.set(this.tree.id, this.tree);

  // Create infrastructure folders without recording
  this.recordingEnabled = false;
  try {
    this.tree.createChild({ name: TRASH_FOLDER, isDirectory: true });  // Gets ID "1"
    this.tree.createChild({ name: TMP_FOLDER, isDirectory: true });    // Gets ID "2"
  } finally {
    this.recordingEnabled = true;
  }
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

// CREATE: nodeId NOT stored - it's auto-generated during execution
interface CreateOperation {
  type: 'create';
  parentId: NodeID;                    // Only parent is needed
  data: NodeData;                      // Initial data for the new node
}

// DELETE: nodeId identifies which node to delete
interface DeleteOperation {
  type: 'delete';
  nodeId: NodeID;
}

// MODIFY: nodeId identifies which node, changes are the fields to update
interface ModifyOperation {
  type: 'modify';
  nodeId: NodeID;
  changes: Partial<NodeData>;
}

// MOVE: nodeId identifies which node, newParentId is destination
interface MoveOperation {
  type: 'move';
  nodeId: NodeID;
  newParentId: NodeID;
}

// RENAME: nodeId identifies which node, newName is the new basename
interface RenameOperation {
  type: 'rename';
  nodeId: NodeID;
  newName: string;
}
```

**Key insight**: CreateOperation does NOT include nodeId because it's auto-generated during execution. This simplifies the API and ensures deterministic replay—when you replay the same sequence of operations with the counter reset, you get identical node IDs.

#### 2. TreeNode Class (`/src/chat/vault-state/tree-node.ts`)

**Primary user-facing API** - Users interact with TreeNode methods exclusively.

```typescript
export class TreeNode {
  private static nextId: number = 0;  // Auto-increment counter
  readonly id: NodeID;                // Auto-generated during construction
  parentId: NodeID | null = null;
  childIds: NodeID[] = [];
  data: NodeData = { name: '', isDirectory: false };

  // Constructor creates node with next auto-generated ID
  constructor(private vaultState: VaultState) {
    this.id = String(TreeNode.nextId++);
  }

  // Reset counter for deterministic replay
  static resetIdCounter(): void {
    TreeNode.nextId = 0;
  }

  // Create child with auto-generated ID (no ID argument needed!)
  createChild(data: NodeData): TreeNode { ... }

  // Mutations (all delegate to execute functions)
  modify(changes: Partial<NodeData>): void { ... }
  move(newParentNode: TreeNode): void { ... }
  rename(newName: string): void { ... }
  delete(): void { ... }

  // Trash/restore (Phase 3)
  trash(originalPath: string): void { ... }
  restore(parentNode: TreeNode): void { ... }
  isTrashed(): boolean { ... }
}
```

**Key properties**:
- Constructor auto-generates ID—no ID argument needed
- `createChild()` returns the created child (intuitive API), no ID argument
- All mutations validate preconditions (e.g., circular reference check)
- All mutations delegate to execute functions (hidden from users)
- No null-based behavior control
- ID counter reset during tree rebuild ensures deterministic replay

#### 3. VaultState Class (`/src/chat/vault-state/vault-state.ts`)

**Data container and query interface** - Holds state, provides queries, manages operations log.

```typescript
export class VaultState {
  private tree: TreeNode;
  private nodeIndex: Map<NodeID, TreeNode> = new Map();
  private operationsLog: Operation[] = [];
  private recordingEnabled: boolean = true;

  constructor(private peerId: 'tracking' | 'proposed') {
    // Reset ID counter to ensure root gets ID "0"
    TreeNode.resetIdCounter();

    // Create root node (gets ID "0", not recorded)
    this.tree = new TreeNode(this);
    this.tree.data = { name: '', isDirectory: true };
    this.tree.parentId = null;
    this.nodeIndex.set(this.tree.id, this.tree);

    // Create infrastructure folders without recording
    this.recordingEnabled = false;
    try {
      this.tree.createChild({          // Gets ID "1"
        name: TRASH_FOLDER,
        isDirectory: true
      });
      this.tree.createChild({          // Gets ID "2"
        name: TMP_FOLDER,
        isDirectory: true
      });
    } finally {
      this.recordingEnabled = true;
    }
  }

  // Query API
  getNode(nodeId: NodeID): TreeNode | null { ... }
  findByPath(path: string): TreeNode | null { ... }
  getNodePath(nodeId: NodeID): string { ... }
  getDescendants(nodeId: NodeID): TreeNode[] { ... }
  getTrashFolder(): TreeNode { ... }           // Phase 3: Find by name
  findTrashed(originalPath: string): TreeNode | null { ... }  // Phase 3

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

**Key properties**:
- Constructor resets ID counter so root gets predictable ID "0"
- Infrastructure folders created via `createChild()` like user-created nodes
- Infrastructure folder creation happens with recording disabled
- Trash folder found by name lookup, not hardcoded ID
- ID counter reset during rebuild ensures identical IDs on replay

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

## Phase 3: Trash/Restore System ✅ COMPLETE (Updated with Auto-Generated IDs)

**Status**: Fully implemented with auto-generated node IDs (124 tests, 3 need updates)

### Design Philosophy: Auto-Generated Node IDs

This refactor introduces **auto-generated node IDs** (not user-controlled):
- TreeNode constructor automatically assigns incrementing IDs (0, 1, 2, ...)
- IDs are implementation details, not exposed in operations
- Root naturally receives ID "0" as first node created
- Enables deterministic replay: reset counter at rebuild start → same IDs in same order

### Key Architectural Changes

1. **Node ID Management**
   - `TreeNode.nextId` static counter: auto-increments on each node creation
   - `TreeNode.resetIdCounter()`: reset counter for deterministic rebuild
   - No nodeId parameter in TreeNode constructor
   - IDs are strings: "0", "1", "2", etc.

2. **CREATE Operation No Longer Stores nodeId**
   - Old: `{ type: 'create', nodeId: 'n1', parentId: 'root', data: {...} }`
   - New: `{ type: 'create', parentId: '0', data: {...} }`
   - NodeID is auto-generated during execution via TreeNode constructor
   - Rationale: ID is implementation detail, not part of logical operation
   - Determinism: ID counter reset during rebuild ensures replay produces identical IDs

3. **Infrastructure Folders Created via createChild()**
   - Removed direct TreeNode constructor calls
   - Both constructor and rebuildTreeFromLog use `root.createChild()`
   - Recording is disabled during infrastructure folder creation
   - Infrastructure folders get auto-generated IDs naturally (typically 1 and 2)
   - Found by name (TRASH_FOLDER, TMP_FOLDER) not hardcoded IDs

4. **getTrashFolder() Implementation Changed**
   - Old: Could lookup by hardcoded folder ID
   - New: Searches root's children by name (TRASH_FOLDER)
   - More flexible and doesn't depend on specific ID assignments

5. **Test Assertions Updated**
   - Assert root has ID "0" (not hardcoded, derived from counter starting at 0)
   - Tests should use node.id references rather than hardcoded IDs like 'n1', 'd1'
   - Avoid brittle ID assumptions in test assertions

6. **Sync vs Approval Are Distinct Workflows** (unchanged from earlier clarification)
   - **Sync**: Reconcile vault changes into proposed (external source of truth → tracking → proposed)
   - **Approval**: User approves/rejects AI changes

7. **RenameTracker Remains Independent** (unchanged)
   - Works with stable, auto-generated NodeIDs from operations log
   - No changes needed to RenameTracker implementation

### Implementation Tasks ✅ COMPLETE

**Auto-Generated ID System**
- ✅ `TreeNode.nextId` static counter (auto-increments)
- ✅ `TreeNode.resetIdCounter()` for deterministic rebuild
- ✅ No nodeId parameter in constructor
- ✅ Root naturally gets ID "0"

**CREATE Operation Updated**
- ✅ Removed nodeId from CreateOperation interface
- ✅ executeCreate() auto-generates ID via TreeNode constructor
- ✅ Deterministic replay: counter reset at rebuild start

**Infrastructure Folders via createChild()**
- ✅ VaultState constructor calls `root.createChild()` for trash and tmp folders
- ✅ Recording disabled during infrastructure folder creation
- ✅ rebuildTreeFromLog() mirrors constructor approach
- ✅ getTrashFolder() searches by name, not hardcoded ID

**TreeNode Soft-Delete Methods**
- ✅ `trash(originalPath: string): void` - MOVE to trash + set `deletedFrom` metadata
- ✅ `restore(parentNode: TreeNode): void` - Remove `deletedFrom` + MOVE to parent
- ✅ `isTrashed(): boolean` - Check for trashed status

**Test Coverage**
- ✅ 16 trash/restore tests added
- ⚠️ 3 tests need updates to use auto-generated IDs
  - Tests should assert root.id === "0"
  - Tests should use node.id references, not hardcoded IDs
  - getOperationsForNode method reference needs verification

### Deliverables ✅

**Auto-Generated ID System (Core Feature)**
- TreeNode auto-increments ID counter starting at "0" for root
- No user control over node IDs—purely implementation detail
- Deterministic rebuild: counter reset ensures replay produces identical IDs
- Enables stable node references across tree rebuilds

**Infrastructure Folders** (Created via createChild, not direct constructor)
- `.overlay-trash` folder for soft-deleted nodes
- `.overlay-tmp` folder for temporary staging
- Created in VaultState constructor AND rebuildTreeFromLog
- Recording disabled during creation (not added to operations log)
- Auto-generated IDs (typically "1" and "2", but not hardcoded)
- Found by name, not ID lookup

**TreeNode Methods**
- `trash(originalPath: string): void` - Moves node to trash, sets `deletedFrom` metadata
- `restore(parentNode: TreeNode): void` - Restores from trash, removes metadata
- `isTrashed(): boolean` - Helper to check if node is in trash

**VaultState Methods**
- `getTrashFolder(): TreeNode` - Searches root's children by TRASH_FOLDER name
- `findTrashed(originalPath: string): TreeNode | null` - Finds node in trash by original path

**Operations Recorded**
- CREATE: `{ type: 'create', parentId: '0', data: {...} }` (nodeId auto-generated)
- MOVE operation when node moves to/from trash
- MODIFY operation to set/unset `deletedFrom` metadata
- No special trash operations - keeps log simple and efficient

**Test Coverage**
- Infrastructure folder creation and properties
- Trashing files and directories
- Restoring from trash
- Preventing trash of infrastructure nodes
- Rollback and rebuild with trashed nodes
- Finding trashed nodes by original path
- Root node naturally gets ID "0"
- Auto-generated IDs stable through rebuild
- 124 tests passing (3 need minor updates for auto-generated IDs)

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

## Auto-Generated Node ID System (Phase 3 Refinement)

With the introduction of auto-generated node IDs, the architecture is now cleaner:

**Benefits**
- ✅ IDs are purely implementation details, not user-controlled
- ✅ Root always gets ID "0" naturally (no special handling)
- ✅ Deterministic replay: reset counter at rebuild start
- ✅ Simpler CREATE operation: no need to store nodeId
- ✅ Infrastructure folders created naturally via createChild

**Impact on Operations Log**
- CREATE operations no longer store nodeId
- Smaller operation log (fewer fields)
- More focused on logical structure, less on implementation details
- Still fully deterministic and reproducible

---

**Document Status**: Phases 1-3 ✅ COMPLETE (with Auto-Generated IDs)
**Next Phase**: Phase 4 (Method Migration - Single Backend Swap)
**Last Updated**: October 24, 2024

### Progress Summary

| Phase | Status | Tests | Key Feature |
|-------|--------|-------|-------------|
| 1 | ✅ Complete | Types, TreeNode | Foundation, auto-generated IDs |
| 2 | ✅ Complete | 107 tests (original) | Execute functions, rebuild, rollback |
| 3 | ✅ Complete | 124 tests | Trash/restore, infrastructure folders (createChild) |
| 4 | 📋 Planned | - | Direct backend swap, no dual-write |
| 5 | 📋 Planned | - | Workflow refactoring |
| 6 | 📋 Planned | - | JSON serialization |
| 7 | 📋 Planned | - | Cleanup & Loro removal |
| 8 | 📋 Planned | - | Performance optimization |

### Known Issues to Fix
- 3 tests need updates for auto-generated ID system:
  - Tests using hardcoded IDs like 'n1', 'd1' → use node.id references
  - Tests asserting empty root children → account for infrastructure folders
  - getOperationsForNode method → verify implementation or add if missing
