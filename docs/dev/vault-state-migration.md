# Vault State Migration: Loro to Operations Log

## Overview

This document outlines the plan to migrate the vault tree/overlay system from Loro (CRDT) to a simpler operations log architecture with reversible operations.

**Motivation**: The current Loro implementation suffers from performance degradation when reverting multiple times, as Loro stores inverse operations as permanent history. An operations log approach allows O(1) rollback by simply truncating the log and rebuilding the tree, avoiding the exponential slowdown.

## Architecture Comparison

### Current System (Loro)

```
VaultOverlay → TreeFS → Loro Tree (CRDT)
                ↓
            WASM boundary
            CRDT semantics
            revertTo() creates inverse ops
            Import/export updates
```

**Issues**:
- Rollback cost: O(n) per revert (inverse ops synced to both trees)
- History growth: Expands with every change + every revert
- Multiple reverts: Exponential slowdown
- Complex serialization: Binary WASM snapshots
- Change detection: O(n) full tree diff after every mutation

### New System (Operations Log)

```
VaultOverlay → VaultState → Operations Log
                ↓
            Pure TypeScript
            Simple tree mutations
            rollback() truncates log
            Serialize to JSON
```

**Benefits**:
- Rollback cost: O(n) single rebuild (where n = operations to replay)
- History growth: Linear (operations only, no reverts)
- Multiple reverts: Constant cost per rollback
- Simple serialization: JSON-serializable
- Change detection: O(m) diff of staged operations

## Phase Overview

```
Phase 1: Foundation (New Core Structures)
Phase 2: VaultState Implementation
Phase 3: Integration Scaffolding
Phase 4: Method Migration (Gradual, Dual-Write)
Phase 5: Workflow Refactoring
Phase 6: Persistence & Serialization
Phase 7: Cleanup & Removal
Phase 8: Optimization & Hardening
```

---

# Phase 1: Foundation (New Core Structures)

## Objectives

- Define operation type system and data structures
- Create TreeNode class skeleton
- Create VaultState class skeleton
- Establish testing infrastructure

## Tasks

### 1.1 Create `/src/chat/vault-state/types.ts`

Define all type definitions needed by the system:

**NodeID**: Stable, globally-unique identifier for tree nodes
- Used to detect renames (same node ID, different path)
- Persisted in operation log

**NodeData**: Immutable data structure for node properties
```typescript
export interface NodeData {
  name: string;                    // Filename/dirname
  isDirectory: boolean;            // Distinguishes files from folders
  text?: string;                   // Text file content
  buffer?: Uint8Array;             // Binary file data
  stat?: FileStats;                // Metadata: {mtime, ctime, size}
  [key: string]: unknown;          // Extensible for future fields
}
```

**Operation Types**: Union of all mutating operations
- `CreateOperation`: Node created with initial state
- `DeleteOperation`: Node deleted (captures entire subtree)
- `ModifyOperation`: Field changed (text, buffer, stat)
- `MoveOperation`: Node moved to different parent
- `RenameOperation`: Node name changed (path segment only)

Each operation stores complete state needed for reversal:
- `CreateOperation` captures initial data
- `DeleteOperation` captures deleted node's entire state + children IDs
- `ModifyOperation` captures both oldValue and newValue
- `MoveOperation` captures both oldParentId and newParentId
- `RenameOperation` captures both oldName and newName

**SerializedOperation**: JSON-safe variant of Operation
- Binary buffers encoded as base64 strings
- Used for chat snapshot persistence

**SerializedState**: Complete vault state snapshot
```typescript
export interface SerializedState {
  operationsLog: SerializedOperation[];
}
```

### 1.2 Create `/src/chat/vault-state/tree-node.ts`

TreeNode class structure (methods to be implemented in Phase 2):

```typescript
export class TreeNode {
  id: NodeID;
  parentId: NodeID | null = null;
  childIds: NodeID[] = [];
  data: NodeData = { name: '', isDirectory: false };

  constructor(id: NodeID, private vaultState: VaultState) { ... }

  // Mutation methods (Phase 2)
  modify(field: string, newValue: unknown): void { ... }
  move(newParentNode: TreeNode): void { ... }
  rename(newName: string): void { ... }
  delete(): void { ... }
}
```

Key design: All mutations implicitly record operations via vaultState.recordOperation()

### 1.3 Create `/src/chat/vault-state/vault-state.ts`

VaultState class skeleton (implementation in Phase 2):

```typescript
export class VaultState {
  private tree: TreeNode;
  private nodeIndex: Map<NodeID, TreeNode>;
  private operationsLog: Operation[] = [];
  private pathCache: Map<string, NodeID>;

  constructor(peerId: 'tracking' | 'proposed') { ... }

  // Phase 2 implementations
  private executeOperation(op: Operation): void { ... }
  private rebuildTreeFromLog(): void { ... }
  private recordOperation(op: Operation): void { ... }

  // Query API
  getNode(nodeId: NodeID): TreeNode | null { ... }
  findByPath(path: string): TreeNode | null { ... }
  getNodePath(nodeId: NodeID): string { ... }
  getDescendants(nodeId: NodeID): TreeNode[] { ... }

  // Checkpoint API
  checkpoint(): number { ... }
  rollback(checkpointIndex: number): void { ... }

  // Operations log API
  getOperations(type?: string): Operation[] { ... }
  getOperationsForNode(nodeId: NodeID): Operation[] { ... }
  getLogLength(): number { ... }

  // Persistence (Phase 6)
  serialize(): SerializedState { ... }
  static deserialize(data: SerializedState): VaultState { ... }
}
```

### 1.4 Create `/src/chat/vault-state/index.ts`

Central export file:

```typescript
export * from './types';
export { TreeNode } from './tree-node';
export { VaultState } from './vault-state';
```

### 1.5 Create `/tests/vault-state/` directory

Test infrastructure for new classes:
- `tree-node.spec.ts`
- `vault-state.spec.ts`
- `rebuild.spec.ts`
- `rollback.spec.ts`
- `path-cache.spec.ts`
- `edge-cases.spec.ts`

## Validation Checkpoints

- ✅ Type checking passes (`pnpm run sveltecheck`)
- ✅ Can import and instantiate TreeNode and VaultState
- ✅ No undefined method errors in test files

---

# Phase 2: VaultState Implementation

## Objectives

- Implement operation execution engine
- Implement deterministic tree rebuild from log
- Implement rollback mechanism
- Full test coverage for all operation types

## Design Decisions Made

Before implementation, the following key design decisions were made:

1. **Single Path with Recording Flag**: Rather than duplicate operation logic (normal vs. rebuild), use a `recordingEnabled` boolean flag that disables during rebuild. TreeNode methods call VaultState methods, which respect the flag.

2. **CREATE Operation Includes Initial Data**: CreateOperation captures the complete NodeData object at creation time, avoiding the need for separate MODIFY operations right after creation. This is more efficient and matches reality.

3. **Minimal Operation Format**: Operations are kept minimal to reduce log size:
   - DELETE: Only nodeId (no information loss—data is in history)
   - MODIFY: nodeId + changes object (batches multiple field updates atomically)
   - MOVE: nodeId + newParentId (old parent can be queried from current state)
   - RENAME: nodeId + newName (old name can be queried from previous tree state)

4. **Root Node Protection**: Both `delete()` and `rename()` methods validate and prevent operations on root node to maintain tree integrity.

5. **Circular Reference Detection**: `moveNode()` checks that the new parent is not a descendant of the node being moved, preventing circular parent-child relationships.

6. **Simple Path Traversal**: No path caching (was Loro optimization). Simple tree walk is fast enough in pure TypeScript. `findByPath()` splits on '/' and walks down. `getNodePath()` walks up parent chain.

7. **Rebuild with Try/Finally**: The `recordingEnabled` flag is guaranteed to be restored even if rebuild fails, using try/finally pattern.

## Implementation Summary

### VaultState Class (`/src/chat/vault-state/vault-state.ts`)

**Core State**:
- `tree: TreeNode` - Root node
- `nodeIndex: Map<NodeID, TreeNode>` - Fast node lookup
- `operationsLog: Operation[]` - Append-only operation log
- `recordingEnabled: boolean` - Flag to disable recording during rebuild

**Query Methods**:
- `getNode(nodeId)` - O(1) lookup
- `findByPath(path)` - O(depth) traversal
- `getNodePath(nodeId)` - Walk up parent chain
- `getDescendants(nodeId)` - Recursive traversal

**Mutation Methods** (record operations automatically):
- `createNode(nodeId, parentId, data)` - Create with initial data
- `deleteNode(nodeId)` - Delete node and descendants
- `modifyNode(nodeId, changes)` - Atomic multi-field update
- `moveNode(nodeId, newParentId)` - Move with circular ref check
- `renameNode(nodeId, newName)` - Rename with root protection

**Operation Log API**:
- `getOperations(type?)` - Get all ops, optionally filtered
- `getOperationsForNode(nodeId)` - Get ops for specific node
- `checkpoint()` - Record current log length
- `rollback(checkpointIndex)` - Truncate and rebuild
- `getLogLength()` - Get current log size
- `recordOperation(op)` - Internal: record if recording enabled

**Execution Engine** (private):
- `executeOperation(op)` - Dispatcher to execute*() methods
- `executeCreate(op)` - Create node from operation
- `executeDelete(op)` - Delete node and descendants
- `executeModify(op)` - Apply field changes
- `executeMove(op)` - Change parent
- `executeRename(op)` - Change name
- `deleteNodeAndChildren(nodeId)` - Recursive delete from index
- `rebuildTreeFromLog()` - Deterministic replay with flag control
- `executeAndRecord(op)` - Execute and record in one step (for workflows)

### TreeNode Class (`/src/chat/vault-state/tree-node.ts`)

Delegates all mutations to VaultState, ensuring all operations are recorded:

```typescript
modify(changes: Partial<NodeData>) → vaultState.modifyNode()
move(newParentNode: TreeNode) → vaultState.moveNode()
rename(newName: string) → vaultState.renameNode()
delete() → vaultState.deleteNode()
```

Both `rename()` and `delete()` include root node protection checks.

## Implementation Details

### Rebuild Algorithm

```typescript
rebuildTreeFromLog() {
  recordingEnabled = false;  // Prevent recording during replay
  try {
    nodeIndex.clear();
    create root node;
    for each operation in log {
      executeOperation(operation);
    }
  } finally {
    recordingEnabled = true;  // Guaranteed restoration
  }
}
```

**Properties**:
- Deterministic: Same log always produces same tree
- Idempotent: Multiple rebuilds produce identical trees
- Error reporting: Includes operation index on failure

### Circular Reference Check

In `moveNode()`:
```typescript
let current = newParent;
while (current) {
  if (current.id === nodeId) {
    throw Error("Circular reference");
  }
  current = current.parent;
}
```

Prevents a node from being moved under any of its descendants.

## Test Coverage

All Phase 1 tests continue to pass with new implementation. Phase 2 adds:

- Operation execution tests for each operation type
- Rebuild determinism tests
- Rollback functionality tests
- Circular reference detection
- Root node protection validation
- Path traversal and reconstruction tests

**Results**: 77 tests passing, 0 type errors

## Validation Checkpoints

- ✅ All 77 Phase 1 & 2 tests pass
- ✅ Type checking: 0 errors
- ✅ Rebuild is deterministic (same log → same tree)
- ✅ Rollback restores checkpoint state exactly
- ✅ Circular references detected and prevented
- ✅ Root node protected from rename/delete

## Implementation Complete ✅

All Phase 2 tasks have been implemented. See "Implementation Summary" above for details on:
- VaultState class with full API
- TreeNode class with mutation methods
- Operation execution engine (executeOperation + specific handlers)
- Deterministic tree rebuild with recording flag
- Rollback mechanism
- Comprehensive test coverage

```typescript
private executeOperation(op: Operation): void {
  switch (op.type) {
    case 'create': this.executeCreate(op); break;
    case 'delete': this.executeDelete(op); break;
    case 'modify': this.executeModify(op); break;
    case 'move': this.executeMove(op); break;
    case 'rename': this.executeRename(op); break;
  }
  // Invalidate path cache on structural changes
  if (op.type !== 'modify') {
    this.pathCache.clear();
  }
}
```

**executeCreate(op: CreateOperation)**
- Create new TreeNode with op.nodeId
- Set parent, name, isDirectory, text, buffer, stat
- Add to parent's childIds
- Add to nodeIndex

**executeDelete(op: DeleteOperation)**
- Remove node from parent's childIds
- Recursively delete all descendants from nodeIndex
- Nodes are removed, not preserved (unlike Loro trash)

**executeModify(op: ModifyOperation)**
- Update node.data[op.field] to op.newValue
- No cache invalidation (not a structural change)

**executeMove(op: MoveOperation)**
- Remove node from old parent's childIds
- Add node to new parent's childIds
- Update node.parentId

**executeRename(op: RenameOperation)**
- Update node.data.name to op.newName
- Invalidate cache (path changed)

### 2.2 Implement `rebuildTreeFromLog()`

Deterministic replay of entire operation history:

```typescript
private rebuildTreeFromLog(): void {
  this.nodeIndex.clear();
  this.pathCache.clear();

  // Create empty root
  const root = new TreeNode('root-id', this);
  root.data = { name: '', isDirectory: true };
  root.parentId = null;
  this.nodeIndex.set('root-id', root);
  this.tree = root;

  // Replay operations
  for (let i = 0; i < this.operationsLog.length; i++) {
    const op = this.operationsLog[i];
    try {
      this.executeOperation(op);
    } catch (e) {
      throw new Error(
        `Failed to replay operation ${op.type} at index ${i}: ${e.message}`
      );
    }
  }
}
```

**Properties**:
- Deterministic: Same log always produces same tree
- Idempotent: Rebuilding multiple times produces identical result
- Error reporting: Clear error messages with operation index

### 2.3 Implement Checkpoint API

```typescript
checkpoint(): number {
  return this.operationsLog.length;
}

rollback(checkpointIndex: number): void {
  if (checkpointIndex < 0 || checkpointIndex > this.operationsLog.length) {
    throw new Error(`Invalid checkpoint: ${checkpointIndex}`);
  }
  this.operationsLog = this.operationsLog.slice(0, checkpointIndex);
  this.rebuildTreeFromLog();
}
```

**Checkpoint semantics**:
- Checkpoints are indices in the operations log
- Rollback to checkpoint N restores state after N operations
- All operations after checkpoint are discarded

### 2.4 Implement TreeNode Mutation Methods

Each method captures state before mutation and records operation:

**modify(field: string, newValue: unknown)**
```typescript
modify(field: string, newValue: unknown) {
  const oldValue = this.data[field];
  this.data[field] = newValue;
  this.vaultState.recordOperation({
    type: 'modify',
    nodeId: this.id,
    field,
    oldValue,
    newValue
  });
}
```

**move(newParentNode: TreeNode)**
```typescript
move(newParentNode: TreeNode) {
  const oldParentId = this.parentId;
  if (this.parentId) {
    const oldParent = this.vaultState.getNode(this.parentId)!;
    oldParent.childIds = oldParent.childIds.filter(id => id !== this.id);
  }
  this.parentId = newParentNode.id;
  newParentNode.childIds.push(this.id);
  this.vaultState.recordOperation({
    type: 'move',
    nodeId: this.id,
    oldParentId,
    newParentId: newParentNode.id
  });
}
```

**rename(newName: string)**
```typescript
rename(newName: string) {
  const oldName = this.data.name;
  this.data.name = newName;
  this.vaultState.recordOperation({
    type: 'rename',
    nodeId: this.id,
    oldName,
    newName
  });
}
```

**delete()** - Key design decision

This implementation captures the entire deleted subtree in a single atomic operation:

```typescript
delete() {
  // Capture complete state before deletion
  const deleteOp: DeleteOperation = {
    type: 'delete',
    nodeId: this.id,
    parentId: this.parentId!,
    name: this.data.name,
    isDirectory: this.data.isDirectory,
    text: this.data.text,
    buffer: this.data.buffer,
    stat: this.data.stat,
    childIds: [...this.childIds]
  };

  // Remove from parent
  if (this.parentId) {
    const parent = this.vaultState.getNode(this.parentId)!;
    parent.childIds = parent.childIds.filter(id => id !== this.id);
  }

  // Recursively delete children from index (no separate operations)
  this.deleteDescendantsFromIndex();

  // Record single atomic delete operation
  this.vaultState.recordOperation(deleteOp);
}

private deleteDescendantsFromIndex() {
  for (const childId of this.childIds) {
    const child = this.vaultState.getNode(childId)!;
    child.deleteDescendantsFromIndex();
  }
  this.vaultState.deleteFromIndex(this.id);
}
```

**Rationale**: Deletion is atomic from the user's perspective. Recording one operation per deleted subtree preserves semantics while keeping the log clean.

### 2.5 Implement Path Caching

Cache maintains mapping: path string → NodeID

```typescript
private buildPathCache() {
  this.pathCache.clear();
  this.buildPathCacheForNode(this.tree, '');
}

private buildPathCacheForNode(node: TreeNode, parentPath: string) {
  const nodePath = parentPath === ''
    ? node.data.name
    : `${parentPath}/${node.data.name}`;

  if (nodePath !== '/') {  // Don't cache root
    this.pathCache.set(nodePath, node.id);
  }

  for (const childId of node.childIds) {
    const child = this.nodeIndex.get(childId)!;
    this.buildPathCacheForNode(child, nodePath);
  }
}

findByPath(path: string): TreeNode | null {
  if (!this.pathCacheValid) {
    this.buildPathCache();
    this.pathCacheValid = true;
  }
  const nodeId = this.pathCache.get(path);
  return nodeId ? this.nodeIndex.get(nodeId) ?? null : null;
}

private invalidatePathCache() {
  this.pathCacheValid = false;
}
```

### 2.6 Test Coverage

Create comprehensive test suite in `/tests/vault-state/`:

**tree-node.spec.ts**
- ✅ Create node, verify operation recorded
- ✅ Modify field, verify operation captures old/new values
- ✅ Move node between parents, verify childIds updated
- ✅ Rename node, verify path cache invalidated
- ✅ Delete node, verify descendants deleted atomically
- ✅ Delete with empty children list, verify operation recorded

**rebuild.spec.ts**
- ✅ Rebuild from empty log produces root only
- ✅ Rebuild from single CREATE matches initial state
- ✅ Rebuild deterministic: same log always produces same tree
- ✅ Rebuild idempotent: rebuilding twice produces same tree
- ✅ Rebuild complex sequence: creates, moves, renames, deletes
- ✅ Error handling: invalid operation reports index

**rollback.spec.ts**
- ✅ Rollback to start (index 0) restores empty tree
- ✅ Rollback after CREATE removes created node
- ✅ Rollback after DELETE restores deleted node
- ✅ Rollback after MODIFY restores old value
- ✅ Multiple rollbacks: rollback multiple times produces consistent state
- ✅ Error: rollback with invalid index throws

**path-cache.spec.ts**
- ✅ findByPath returns node after cache valid
- ✅ Cache invalidates on structural change
- ✅ Cache rebuilds on next access
- ✅ getNodePath reconstructs path from node

**edge-cases.spec.ts**
- ✅ Modify non-existent field creates it
- ✅ Move node to same parent is no-op (still records)
- ✅ Delete root node throws error
- ✅ Delete already-deleted node throws error
- ✅ Deep nesting: 100-level directory tree builds and rolls back

## Validation Checkpoints

- ✅ All tests in `/tests/vault-state/` pass
- ✅ Deterministic rebuild verified (hash tree state after rebuild)
- ✅ Rollback restores checkpoint state exactly
- ✅ Path cache consistency validated

---

# Phase 3: Integration Scaffolding

## Objectives

- Create parallel VaultState instances in VaultOverlay
- Enable dual initialization from snapshots
- Prepare for Phase 4 dual-write architecture
- Validate that both backends produce identical queries

## Tasks

### 3.1 Parallel VaultState Instances

Add to `/src/chat/vault-overlay.svelte.ts`:

```typescript
class VaultOverlay implements Vault {
  // Existing Loro infrastructure
  private trackingDoc: LoroDoc;
  private proposedDoc: LoroDoc;

  // New VaultState infrastructure (Phase 3)
  private trackingState: VaultState;
  private proposedState: VaultState;

  constructor(snapshots?: SnapshotData) {
    if (snapshots) {
      // Restore from saved state
      this.trackingDoc = LoroDoc.fromSnapshot(snapshots.tracking);
      this.proposedDoc = LoroDoc.fromSnapshot(snapshots.proposed);

      // Initialize VaultState from operations log (Phase 6)
      if (snapshots.operationsLog) {
        this.trackingState = VaultState.deserialize(snapshots.trackingOps);
        this.proposedState = VaultState.deserialize(snapshots.proposedOps);
      } else {
        // Convert from Loro tree (Phase 3)
        this.initializeStatesFromLoro();
      }
    } else {
      // Create fresh instances
      this.trackingDoc = new LoroDoc();
      this.proposedDoc = new LoroDoc();
      this.trackingState = new VaultState('tracking');
      this.proposedState = new VaultState('proposed');
    }
  }

  private initializeStatesFromLoro() {
    // Traverse Loro tree and create corresponding VaultState
    // This is temporary (Phase 3 only) for testing dual backends
  }
}
```

### 3.2 Query Methods Consistency

Implement validation method to ensure both backends produce identical results:

```typescript
private validateStatesMatch(): boolean {
  // Compare node counts
  if (this.trackingState.getLogLength() !== this.trackingDoc.getTree('vault').size()) {
    console.warn('Node count mismatch between VaultState and Loro');
    return false;
  }

  // Compare sample paths
  const paths = ['/', '/vault', '/documents/notes.md'];
  for (const path of paths) {
    const loroNode = this.findByPathLoro(path);
    const stateNode = this.trackingState.findByPath(path);

    if ((loroNode === null) !== (stateNode === null)) {
      console.warn(`Path mismatch: ${path}`);
      return false;
    }

    if (loroNode && stateNode) {
      if (loroNode.data.text !== stateNode.data.text) {
        console.warn(`Content mismatch at: ${path}`);
        return false;
      }
    }
  }

  return true;
}
```

### 3.3 Test Coverage

Create `/tests/vault-overlay/integration-phase3.spec.ts`:

- ✅ Initialize VaultOverlay with both Loro and VaultState
- ✅ validateStatesMatch returns true after initialization
- ✅ Query methods produce consistent results from both backends
- ✅ findByPath returns same node from both backends
- ✅ Path caching works consistently

## Validation Checkpoints

- ✅ VaultState and Loro are independently initialized
- ✅ Both backends accessible from VaultOverlay
- ✅ validateStatesMatch() passes
- ✅ Existing VaultOverlay tests still pass (no behavior change yet)

---

# Phase 4: Method Migration (Gradual, Dual-Write)

## Objectives

- Migrate write methods one at a time
- Implement dual-write to both Loro and VaultState
- Validate consistency at each step
- Maintain all existing test passes

## Strategy

For each method: create → modify → delete → rename/move (in order of complexity)

After each method migration:
1. Run full test suite
2. Verify validateStatesMatch() passes
3. Code review before proceeding to next method

### 4.1 Step: Migrate `create()`

Update `/src/chat/vault-overlay.svelte.ts`:

```typescript
async create(path: string, content: string, options?: DataWriteOptions): Promise<TFile> {
  const nodeId = generateNodeId();
  const parentPath = dirname(path);
  const parentId = await this.ensureParentExists(parentPath);
  const name = basename(path);

  // 1. Write to Loro (existing code)
  const loroParent = /* find parent node in Loro */;
  const loroNode = loroParent.insert(0, { /* data */ });
  this.proposedDoc.commit();

  // 2. Write to VaultState (new code)
  const stateParent = this.proposedState.getNode(parentId);
  this.proposedState.createNode(nodeId, parentId, name, {
    isDirectory: false,
    text: content,
    stat: { size: content.length, mtime: Date.now(), ctime: Date.now() }
  });

  // 3. Validate consistency
  if (!this.validateStatesMatch()) {
    throw new Error('State mismatch after create');
  }

  return this.proposedState.findByPath(path) as TFile;
}
```

### 4.2 Step: Migrate `modify()`

```typescript
async modify(file: TFile, text: string, options?: DataWriteOptions): Promise<void> {
  const node = this.proposedState.findByPath(file.path);
  if (!node) throw new Error(`File not found: ${file.path}`);

  // 1. Write to Loro
  const loroNode = /* find in Loro */;
  loroNode.data.set('text', text);
  loroNode.data.set('mtime', Date.now());
  this.proposedDoc.commit();

  // 2. Write to VaultState
  node.modify('text', text);
  node.modify('mtime', Date.now());

  // 3. Validate
  if (!this.validateStatesMatch()) {
    throw new Error('State mismatch after modify');
  }
}
```

### 4.3 Step: Migrate `delete()`

```typescript
async delete(path: string): Promise<void> {
  const node = this.proposedState.findByPath(path);
  if (!node) return;

  // 1. Write to Loro
  const loroNode = /* find in Loro */;
  loroNode.delete();
  this.proposedDoc.commit();

  // 2. Write to VaultState
  node.delete();

  // 3. Validate
  if (!this.validateStatesMatch()) {
    throw new Error('State mismatch after delete');
  }
}
```

### 4.4 Step: Migrate `rename()` and `move()`

```typescript
async rename(oldPath: string, newPath: string): Promise<void> {
  const node = this.proposedState.findByPath(oldPath);
  if (!node) throw new Error(`File not found: ${oldPath}`);

  const newParentPath = dirname(newPath);
  const newParent = this.proposedState.findByPath(newParentPath);
  const newName = basename(newPath);

  // 1. Write to Loro
  const loroNode = /* find in Loro */;
  loroNode.data.set('name', newName);
  loroNode.move(loroNewParent);
  this.proposedDoc.commit();

  // 2. Write to VaultState
  node.move(newParent);
  node.rename(newName);

  // 3. Validate
  if (!this.validateStatesMatch()) {
    throw new Error('State mismatch after rename');
  }
}
```

### 4.5 Test Coverage

- Run existing test suite after each method migration
- Add dual-write validation tests: `vault-state-dual-write.spec.ts`
  - ✅ Create both backends, operations match
  - ✅ Modify both backends, operations match
  - ✅ Delete both backends, operations match
  - ✅ All existing operations tests still pass

## Validation Checkpoints

After each method:
- ✅ Existing test suite passes (`npm test`)
- ✅ validateStatesMatch() returns true
- ✅ No performance regression

---

# Phase 5: Workflow Refactoring

## Objectives

- Add three-way merge support for intelligent text conflict resolution
- Rewrite high-level workflows to use VaultState
- Replace Loro document merging with operation-based workflows
- Improve performance metrics (especially change detection)

## Dependencies

Before starting Phase 5, add `node-diff3` to the project:

```bash
npm install node-diff3
npm install --save-dev @types/diff3  # TypeScript support
```

## Tasks

### 5.1 Rewrite `getFileChanges()`

Current implementation: O(n) tree diff comparing tracking vs. proposed

New implementation: O(m) operation log diff

```typescript
getFileChanges(): ProposedChange[] {
  // Get staged operations (only in proposed, not in tracking)
  const trackingOps = this.trackingState.getOperations();
  const proposedOps = this.proposedState.getOperations();
  const numTrackedOps = trackingOps.length;

  const changes: ProposedChange[] = [];
  const seenPaths = new Set<string>();

  for (const op of proposedOps.slice(numTrackedOps)) {
    const nodeId = op.nodeId;
    const node = this.proposedState.getNode(nodeId);
    if (!node) continue;

    const path = this.proposedState.getNodePath(nodeId);
    const isDirectory = node.data.isDirectory;

    switch (op.type) {
      case 'create':
        if (!seenPaths.has(path)) {
          changes.push({
            type: 'create',
            path,
            info: { isDirectory }
          });
          seenPaths.add(path);
        }
        break;

      case 'delete':
        changes.push({
          type: 'delete',
          path,
          info: { isDirectory }
        });
        seenPaths.delete(path);
        break;

      case 'modify':
        if (!seenPaths.has(path)) {
          changes.push({
            type: 'modify',
            path,
            info: { isDirectory }
          });
          seenPaths.add(path);
        }
        break;

      case 'move':
      case 'rename':
        // Reconstruct old path from reverse operation
        const reverseOp = createReverseOp(op);
        const oldPath = this.reconstructPathFromOperation(reverseOp);
        changes.push({
          type: 'rename',
          path,
          info: { oldPath, isDirectory }
        });
        seenPaths.delete(oldPath);
        seenPaths.add(path);
        break;
    }
  }

  return changes;
}
```

**Performance**: O(m) where m = staged operations, not O(n) total nodes

### 5.2 Rewrite `approve()` Workflow

Current: Copies content from proposed to tracking via Loro update merge

New: Copies operations from proposed log to tracking log

```typescript
async approve(ops: ApprovedChange[]): Promise<void> {
  const trackingCheckpoint = this.trackingState.checkpoint();

  try {
    for (const change of ops) {
      // Find operations in proposed log that match this approved change
      const matchingOps = this.findOperationsForChange(change);

      // Copy to tracking state
      for (const op of matchingOps) {
        this.trackingState.executeAndRecord(op);
      }
    }

    // Sync: rollback proposed to match tracking
    // This discards all unapproved changes
    this.proposedState.rollback(this.trackingState.checkpoint());

    // Persist approved changes to vault
    await this.persistApprovalToVault(ops);

  } catch (e) {
    // On error, rollback tracking to checkpoint
    this.trackingState.rollback(trackingCheckpoint);
    throw e;
  }
}

private findOperationsForChange(change: ProposedChange): Operation[] {
  // Given a change description, find which operations produced it
  const ops: Operation[] = [];
  const node = this.proposedState.findByPath(change.path);

  if (!node) return ops;

  // Get all operations affecting this node
  const nodeOps = this.proposedState.getOperationsForNode(node.id);

  // Filter to only operations after tracking checkpoint
  const trackingOps = this.trackingState.getOperations();
  const startIdx = trackingOps.length;

  return nodeOps.filter(op =>
    this.proposedState.getOperations().indexOf(op) >= startIdx
  );
}

private async persistApprovalToVault(ops: ApprovedChange[]): Promise<void> {
  // Write approved changes to actual vault files
  for (const change of ops) {
    const node = this.trackingState.findByPath(change.path);
    if (!node) continue;

    switch (change.type) {
      case 'create':
        await this.vault.create(change.path, node.data.text ?? '');
        break;
      case 'delete':
        await this.vault.delete(change.path);
        break;
      case 'modify':
        await this.vault.modify(
          this.vault.getAbstractFileByPath(change.path) as TFile,
          node.data.text ?? ''
        );
        break;
      case 'rename':
        await this.vault.rename(
          this.vault.getAbstractFileByPath(change.info.oldPath),
          change.path
        );
        break;
    }
  }
}
```

**Key simplification**: No more Loro document merging—just operations log copying

### 5.3 Rewrite `rejectAll()` Workflow

Current: Complex revert using Loro frontiers

New: Simple rollback

```typescript
rejectAll(): void {
  // Discard all proposed changes by rolling back to tracking checkpoint
  this.proposedState.rollback(this.trackingState.checkpoint());
}
```

### 5.4 Rewrite `syncPath()` Workflow with Three-Way Merge

Current: Read from vault, merge into Loro tree

New: Read from vault, perform **three-way merge** if file has staged changes

**Key behavior**: When vault changes and file has staged edits:
1. Merge external (vault) changes with proposed (staged) changes
2. Keep non-conflicting edits from both sides
3. Detect conflicts where both sides edited the same region
4. Update tracking with vault version (source of truth)
5. Update proposed with merged result

**Example**:
```
tracking:  "# Notes\n\nSection A: Original\n\nSection B: Original"
proposed:  "# Notes\n\nSection A: AI modified\n\nSection B: Original"  (staged)
external:  "# Notes\n\nSection A: Original\n\nSection B: Human modified"  (vault)

Result:    "# Notes\n\nSection A: AI modified\n\nSection B: Human modified"
           (Both AI and human edits preserved)
```

**Implementation**:

```typescript
private async syncPath(path: string): Promise<void> {
  const abstractFile = this.vault.getAbstractFileByPath(path);
  if (!abstractFile) return;

  // Read current content from vault
  const vaultContent = abstractFile instanceof TFile
    ? await this.vault.read(abstractFile as TFile)
    : undefined;

  // Get current nodes (if they exist)
  const trackingNode = this.trackingState.findByPath(path);
  const proposedNode = this.proposedState.findByPath(path);

  // Case 1: New file from vault
  if (!trackingNode && vaultContent !== undefined) {
    const nodeId = generateNodeId();
    const parentPath = dirname(path);
    const name = basename(path);
    const parentNode = this.trackingState.findByPath(parentPath);

    this.trackingState.createNode(
      nodeId,
      parentNode?.id ?? 'root',
      name,
      {
        isDirectory: false,
        text: vaultContent,
        stat: {
          mtime: abstractFile.stat?.mtime ?? Date.now(),
          ctime: abstractFile.stat?.ctime ?? Date.now(),
          size: vaultContent?.length ?? 0
        }
      }
    );

    // If not already staged, copy to proposed
    if (!proposedNode) {
      const newProposedNode = this.proposedState.createNode(
        nodeId,
        parentNode?.id ?? 'root',
        name,
        {
          isDirectory: false,
          text: vaultContent,
          stat: { ... }
        }
      );
    }
    return;
  }

  // Case 2: File deleted from vault
  if (trackingNode && vaultContent === undefined) {
    trackingNode.delete();
    if (proposedNode) {
      proposedNode.delete();
    }
    return;
  }

  // Case 3: File modified in vault (and possibly in proposed)
  if (trackingNode && vaultContent !== undefined) {
    const trackingText = trackingNode.data.text ?? '';
    const proposedText = proposedNode?.data.text ?? trackingText;
    const externalText = vaultContent;

    // Perform three-way merge
    const mergeResult = mergeText(trackingText, proposedText, externalText);

    // Update tracking with vault version (source of truth)
    trackingNode.modify('text', externalText);
    trackingNode.modify('mtime', abstractFile.stat?.mtime ?? Date.now());

    if (isMergeSuccess(mergeResult)) {
      // No conflicts: update proposed with merged result
      if (proposedNode) {
        proposedNode.modify('text', mergeResult.content);
        proposedNode.modify('mtime', abstractFile.stat?.mtime ?? Date.now());
      } else {
        // Not staged, just copy tracking
        this.proposedState.modifyNode(proposedNode!.id, 'text', externalText);
      }
    } else {
      // Conflict detected: leave conflict markers in proposed
      if (proposedNode) {
        proposedNode.modify('text', mergeResult.conflict);
        // Could log or report conflict: mergeResult.conflict contains markers
      }
    }
  }
}

// Import merge function in VaultOverlay
import { mergeText, isMergeSuccess, type MergeOutcome } from '../vault-state/merge';
```

**Three-Way Merge Library**: Uses `node-diff3` package
- Split text into lines
- Find common sections, additions, deletions
- Merge cleanly if edits don't overlap
- Include conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) if both sides edited same region

**Conflict resolution**:
- Conflict markers left in file content
- User can manually resolve or reject the staged changes
- Could enhance in future to provide UI for conflict resolution

### 5.5 Create Merge Utility Module

Before rewriting syncPath, create `/src/chat/vault-state/merge.ts` to encapsulate three-way merge logic:

```typescript
import { diff3Merge } from 'node-diff3';

export interface MergeResult {
  success: true;
  content: string;
}

export interface MergeConflict {
  success: false;
  conflict: string;  // Content with conflict markers
  proposed: string;
  external: string;
  tracking: string;
}

export type MergeOutcome = MergeResult | MergeConflict;

/**
 * Merge text changes from two sources against a common original.
 *
 * Three versions:
 * - tracking: Original state (LCA - Lowest Common Ancestor)
 * - proposed: Staged changes (AI edits)
 * - external: Vault changes (Human edits)
 *
 * Returns:
 * - If no conflicts: merged text with both sets of changes
 * - If conflicts: content with conflict markers, caller must resolve
 */
export function mergeText(
  tracking: string,
  proposed: string,
  external: string
): MergeOutcome {
  const trackingLines = tracking.split('\n');
  const proposedLines = proposed.split('\n');
  const externalLines = external.split('\n');

  const merged = diff3Merge(proposedLines, trackingLines, externalLines, {
    excludeFalseConflicts: true
  });

  const mergedText = merged.join('\n');
  const hasConflicts = mergedText.includes('<<<<<<<');

  if (hasConflicts) {
    return {
      success: false,
      conflict: mergedText,
      proposed,
      external,
      tracking
    };
  }

  return {
    success: true,
    content: mergedText
  };
}

export function isMergeSuccess(result: MergeOutcome): result is MergeResult {
  return result.success === true;
}

export function isMergeConflict(result: MergeOutcome): result is MergeConflict {
  return result.success === false;
}
```

Add to `/src/chat/vault-state/index.ts` exports.

### 5.6 Test Coverage

Run all existing workflow tests:
- ✅ `approve.test.ts`: Approval mechanism with partial overrides
- ✅ `reject.test.ts`: Rejection of all staged changes
- ✅ `sync.test.ts`: Sync operations (create, modify, delete from vault)
- ✅ `sync-rename.test.ts`: Rename detection
- ✅ `changes.test.ts`: Change detection algorithm

Add new tests:
- `changes-performance.spec.ts`: Verify O(m) change detection
- `approval-operations.spec.ts`: Operations log correctness during approval
- `merge.spec.ts`: Three-way merge logic
  - ✅ Non-overlapping edits merge cleanly
  - ✅ Overlapping edits produce conflict markers
  - ✅ Identical changes on both sides don't create false conflicts
  - ✅ Empty, single-line, and multi-line files merge correctly
- `sync-merge.spec.ts`: syncPath integration with merge
  - ✅ Vault change + staged AI change in different sections merge
  - ✅ Conflicting changes produce conflict markers
  - ✅ New files from vault sync correctly
  - ✅ Deleted files sync correctly

## Validation Checkpoints

- ✅ All workflow tests pass
- ✅ Change detection performance improves (measured)
- ✅ Approval/rejection/sync workflows work correctly
- ✅ No Loro merge operations needed

---

# Phase 6: Persistence & Serialization

## Objectives

- Implement JSON serialization of operations log
- Replace Loro binary snapshots with JSON format
- Support chat snapshot save/restore cycle
- Plan migration path for existing Loro snapshots

## Tasks

### 6.1 Create `/src/chat/vault-state/serialization.ts`

Serialize and deserialize VaultState:

```typescript
export function serializeVaultState(state: VaultState): SerializedState {
  const ops = state.getOperations();
  const serialized: SerializedOperation[] = ops.map(op => {
    // Convert Uint8Array buffers to base64
    if (op.type === 'create' && op.buffer) {
      return {
        ...op,
        buffer: btoa(String.fromCharCode(...op.buffer))
      };
    }
    if (op.type === 'delete' && op.buffer) {
      return {
        ...op,
        buffer: btoa(String.fromCharCode(...op.buffer))
      };
    }
    return op;
  });

  return { operationsLog: serialized };
}

export function deserializeVaultState(data: SerializedState): VaultState {
  const state = new VaultState('restored');

  for (const serialized of data.operationsLog) {
    // Decode base64 buffers to Uint8Array
    let op: Operation = { ...serialized };

    if (op.buffer && typeof op.buffer === 'string') {
      op.buffer = new Uint8Array(
        atob(op.buffer).split('').map(c => c.charCodeAt(0))
      );
    }

    state.executeAndRecord(op);
  }

  return state;
}
```

### 6.2 Update `/src/chat/chat-serializer.ts`

Replace Loro snapshot export with operations log:

```typescript
stringify(chat: Chat): string {
  const snapshot = {
    // ... existing fields ...
    vault: {
      tracking: chat.vault.tracking.serialize(),
      proposed: chat.vault.proposed.serialize()
    }
  };
  return JSON.stringify(snapshot);
}

parse(json: string): Chat {
  const snapshot = JSON.parse(json);
  const vault = VaultOverlay.fromSerialized({
    tracking: snapshot.vault.tracking,
    proposed: snapshot.vault.proposed
  });

  return new Chat({
    // ... existing fields ...
    vault
  });
}
```

### 6.3 Implement VaultOverlay.fromSerialized()

```typescript
static fromSerialized(data: {
  tracking: SerializedState;
  proposed: SerializedState;
}): VaultOverlay {
  const overlay = new VaultOverlay();
  overlay.trackingState = deserializeVaultState(data.tracking);
  overlay.proposedState = deserializeVaultState(data.proposed);
  return overlay;
}
```

### 6.4 Migration Path for Existing Loro Snapshots

Two options:

**Option A: Discard old snapshots**
- Simplest approach
- On first load with new code, old chats will have empty vault
- Trade-off: Lose vault history for existing chats

**Option B: Convert Loro → Operations Log**
- More complex but preserves history
- Traverse final Loro tree state and reconstruct operation sequence
- Create synthetic "import" operations for existing files

Implementation for Option B:

```typescript
private initializeStatesFromLoro() {
  // Traverse Loro tree and create corresponding operations
  const loroRoot = this.trackingDoc.getTree('vault').root();

  this.trackingState = new VaultState('tracking');
  this.reconstructOperationsFromLoroNode(
    loroRoot,
    this.trackingState,
    'root'
  );

  // Clone to proposed
  const proposedSnapshot = this.trackingState.serialize();
  this.proposedState = deserializeVaultState(proposedSnapshot);
}

private reconstructOperationsFromLoroNode(
  loroNode: LoroTreeNode,
  state: VaultState,
  parentId: NodeID
) {
  const nodeId = generateNodeId();
  const name = loroNode.data.get('name') as string;
  const isDirectory = loroNode.data.get('isDirectory') as boolean;
  const text = loroNode.data.get('text') as string | undefined;
  const buffer = loroNode.data.get('buffer') as Uint8Array | undefined;
  const stat = loroNode.data.get('stat') as FileStats | undefined;

  // Create synthetic operation for existing node
  state.createNode(nodeId, parentId, name, {
    isDirectory,
    text,
    buffer,
    stat
  });

  // Recursively process children
  for (const child of loroNode.children) {
    this.reconstructOperationsFromLoroNode(child, state, nodeId);
  }
}
```

### 6.5 Test Coverage

Create `/tests/vault-overlay/serialization.spec.ts`:

- ✅ Serialize VaultState to JSON
- ✅ Deserialize JSON back to VaultState
- ✅ Round-trip: serialize → deserialize produces identical state
- ✅ Binary buffers encoded/decoded correctly
- ✅ Large files (>1MB) serialize without truncation
- ✅ Chat snapshot save/restore cycle works
- ✅ Old Loro snapshots can be converted (if Option B)

## Validation Checkpoints

- ✅ Chat snapshots save successfully
- ✅ Chat snapshots restore correctly
- ✅ Serialized format is human-readable JSON
- ✅ Migration from Loro snapshots works (if implemented)

---

# Phase 7: Cleanup & Removal

## Objectives

- Remove Loro dependencies completely
- Delete temporary dual-write code
- Simplify VaultOverlay to use only VaultState
- Remove validateStatesMatch() and other Phase 3/4 scaffolding

## Tasks

### 7.1 Remove Dual-Write from All Methods

Update `/src/chat/vault-overlay.svelte.ts`:

```typescript
async create(path: string, content: string): Promise<TFile> {
  // Remove Loro code, keep only VaultState
  const nodeId = generateNodeId();
  const parentNode = this.proposedState.findByPath(dirname(path));

  this.proposedState.createNode(nodeId, parentNode?.id ?? 'root', basename(path), {
    isDirectory: false,
    text: content,
    stat: { size: content.length, mtime: Date.now(), ctime: Date.now() }
  });

  return this.proposedState.findByPath(path) as TFile;
}

async modify(file: TFile, text: string): Promise<void> {
  const node = this.proposedState.findByPath(file.path);
  if (node) {
    node.modify('text', text);
    node.modify('mtime', Date.now());
  }
}

async delete(path: string): Promise<void> {
  const node = this.proposedState.findByPath(path);
  if (node) {
    node.delete();
  }
}

async rename(oldPath: string, newPath: string): Promise<void> {
  const node = this.proposedState.findByPath(oldPath);
  if (!node) return;

  const newParent = this.proposedState.findByPath(dirname(newPath));
  node.move(newParent!);
  node.rename(basename(newPath));
}
```

### 7.2 Remove Loro Infrastructure

From `/src/chat/vault-overlay.svelte.ts`:
- Delete `trackingDoc` and `proposedDoc` fields
- Delete `LoroDoc` import
- Delete all Loro-related initialization code
- Delete `validateStatesMatch()` method
- Delete `initializeStatesFromLoro()` (if not keeping for migration)

### 7.3 Delete Loro Utility Files

Remove:
- `/src/chat/tree-fs.ts`
- `/src/lib/utils/loro.ts`
- Any imports of these files

Update imports across codebase:
- Replace `TreeFS` usage with `VaultState` methods
- Replace Loro utility imports with VaultState methods

### 7.4 Update Package Dependencies

Remove Loro from `/package.json`:
```bash
npm uninstall loro
```

Or if Loro used elsewhere:
```bash
# Check other usages
grep -r "loro" src/ --include="*.ts" --include="*.svelte"
```

### 7.5 Full Test Suite

Run comprehensive regression tests:

```bash
npm test                          # All tests
pnpm run sveltecheck             # Type checking
npm run build                    # Build succeeds
```

### 7.6 Code Cleanup

- Remove dead code comments referencing Loro
- Update type signatures to remove LoroDoc/LoroTree references
- Simplify method implementations (no fallback to Loro)
- Add JSDoc comments to public methods

## Validation Checkpoints

- ✅ All tests pass (`npm test`)
- ✅ Type checking clean (`pnpm run sveltecheck`)
- ✅ Build succeeds (`npm run build`)
- ✅ No Loro imports remain in codebase
- ✅ Bundle size decreases (Loro removed)
- ✅ No console warnings about missing dependencies

---

# Phase 8: Optimization & Hardening

## Objectives

- Validate performance improvements
- Stress test the system
- Document architecture
- Add optional compression (if needed)

## Tasks

### 8.1 Performance Profiling

Create `/tests/vault-state/performance.spec.ts`:

Benchmark key operations:
- Tree rebuild from 1000 operations
- Tree rebuild from 10000 operations
- Rollback latency
- Change detection (O(m) vs old O(n))
- Path cache performance

Compare against Loro (from Phase 1):
```
Operation           | Loro Cost | Operations Log Cost | Improvement
Rollback x1         | O(n)      | O(n) rebuild        | ~same
Rollback x10        | O(10n)    | O(n) rebuild        | 10x faster
Rollback x100       | O(100n)   | O(n) rebuild        | 100x faster
Change detection    | O(n)      | O(m)                | 100x+ faster (for small m)
Serialization       | WASM      | JSON                | Simpler
```

### 8.2 Stress Testing

- Create/delete/modify 10,000 files
- Verify tree integrity
- Measure memory usage growth
- Checkpoint and rollback at various points
- Verify determinism (rebuild produces same tree)

### 8.3 Operation Compression (Optional)

If operation log becomes too large, implement:

```typescript
class VaultState {
  compress(threshold: number = 1000): void {
    // Merge consecutive MODIFYs on same node
    // Remove CREATE + DELETE pairs (net no-op)
    // Create checkpoint snapshot to avoid replaying huge history

    // Algorithm:
    // 1. Snapshot current tree state
    // 2. Truncate operation log
    // 3. Replace with single "import" operation
  }
}
```

Rationale: Avoid exponential history growth if user performs many edits

### 8.4 Documentation

Create or update `/docs/dev/vault-state.md`:

**Sections**:
- Architecture overview with diagrams
- Operation types and semantics
- VaultState API documentation
- Checkpoint/rollback mechanism
- Performance characteristics
- Recovery procedures
- Debugging guide (reading operation log)

**Example operations from logs**:
```typescript
// CREATE operation
{ type: 'create', nodeId: 'n1', parentId: 'root', name: 'notes.md',
  isDirectory: false, text: '# My Notes' }

// MODIFY operation
{ type: 'modify', nodeId: 'n1', field: 'text',
  oldValue: '# My Notes', newValue: '# My Updated Notes' }

// DELETE operation (atomic, captures subtree)
{ type: 'delete', nodeId: 'n2', parentId: 'root', name: 'archive',
  isDirectory: true, childIds: ['n3', 'n4'] }
```

### 8.5 Test Coverage

- ✅ Performance benchmarks meet expectations
- ✅ Stress test completes without errors
- ✅ Memory usage stays within bounds
- ✅ Documentation is accurate and complete

## Validation Checkpoints

- ✅ Performance improvements measured and documented
- ✅ Stress tests pass
- ✅ Architecture documentation complete
- ✅ System ready for production

---

# Key Decision Points

Before implementation, confirm answers to:

### 1. Delete Atomicity

**Question**: Should deleting a directory be one operation capturing entire subtree, or separate operations per node?

**Recommendation**: One atomic DELETE operation per deleted subtree
- Simpler operation log
- Clearer semantics
- Single checkpoint required for undo

### 2. Rename Detection

**Question**: How to detect renames vs. delete+create?

**Current approach**: Node IDs are stable
- Same nodeID with different path → rename
- Different nodeID → delete + create

**Recommended approach**: Keep stable node IDs, record both MOVE and RENAME operations
- Preserves rename semantics
- Clear operation log

### 3. Backward Compatibility

**Question**: Should old Loro chats be migrated or discarded?

**Options**:
- **Option A (Discard)**: Simple, lose history on old chats
- **Option B (Migrate)**: Convert Loro tree to operation sequence

**Recommendation**: **Option B**
- Traverse final Loro tree state
- Create synthetic CREATE operations for all existing files
- Preserves user data
- One-time conversion cost

### 4. Phase 4 Granularity

**Question**: Should dual-write be per-method, per-PR, or all at once?

**Recommendation**: Per-method, one PR each
- Easier to review
- Easier to debug if issue arises
- Smaller changeset per commit

### 5. Text Merge Strategy

**Question**: When vault changes externally and file has staged edits, how should conflicts be handled?

**Options**:
- **Last-Write-Wins**: External vault wins, discard staged edits
- **Three-Way Merge**: Intelligently merge edits, preserve non-conflicting changes
- **Force Conflict**: Require user to explicitly resolve before proceeding

**Recommendation**: **Three-Way Merge** using `node-diff3`
- Preserves AI edits in different sections when human edits vault
- Example: AI edits Section A, human edits Section B → both preserved
- Detects real conflicts (same region edited by both) with conflict markers
- User can manually resolve conflicts by editing the markers
- Implemented in Phase 5 as part of `syncPath()` rewrite

### 6. Performance Threshold

**Question**: At what operation count should compression be implemented?

**Recommendation**: Phase 8 (optional)
- Profile first to see if needed
- Likely not needed unless users edit thousands of files per session
- Can add lazily if benchmarks show need

---

# File Structure After Migration

```
src/chat/
├── vault-overlay.svelte.ts        (refactored: VaultState only)
├── chat-serializer.ts             (updated: JSON serialization)
├── metadata-cache-overlay.ts       (unchanged)
├── vault-state/                   (NEW)
│   ├── index.ts                   (exports)
│   ├── types.ts                   (Operation, NodeData, etc.)
│   ├── tree-node.ts               (TreeNode class)
│   ├── vault-state.ts             (VaultState class)
│   ├── merge.ts                   (three-way merge using node-diff3)
│   └── serialization.ts           (serialize/deserialize)
└── (removed: tree-fs.ts, loro.ts)

tests/vault-overlay/               (updated to use VaultState)
├── approve.test.ts
├── reject.test.ts
├── sync.test.ts
├── sync-rename.test.ts
├── changes.test.ts
├── operations.test.ts
└── ...

tests/vault-state/                 (NEW)
├── tree-node.spec.ts
├── vault-state.spec.ts
├── rebuild.spec.ts
├── rollback.spec.ts
├── path-cache.spec.ts
├── edge-cases.spec.ts
├── serialization.spec.ts
├── integration.spec.ts
└── performance.spec.ts

docs/dev/
├── vault-state.md                 (NEW: architecture documentation)
└── ...
```

---

# Risk Analysis

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Serialization format incompatible with old chats | High | Design serialization first (Phase 6), test round-trip, plan migration path (Option B) |
| Performance regression on tree rebuild | High | Benchmark early (Phase 2), profile rebuild algorithm, stress test (Phase 8) |
| Subtle differences in delete behavior | Medium | Phase 4 dual-write catches inconsistencies, comprehensive tests |
| Rename detection becomes complex | Medium | Test rename operations thoroughly (Phase 4), verify rename semantics |
| Existing tests depend on Loro internals | Medium | Update tests incrementally in Phase 4, gradually remove Loro assertions |
| Concurrent modifications break invariants | Low | VaultState is single-threaded, no concurrency needed |
| Operation log grows unbounded | Low | Implement compression in Phase 8 if benchmarks show need |

---

# Success Criteria

Before declaring migration complete, verify:

- ✅ All existing tests pass (`npm test`)
- ✅ Type checking clean (`pnpm run sveltecheck`)
- ✅ Build succeeds (`npm run build`)
- ✅ Rollback performance improves (measured benchmarks)
- ✅ Change detection is O(m) operations, not O(n) nodes
- ✅ Serialization to JSON (human-readable, not binary)
- ✅ Operation log is human-readable (aids debugging)
- ✅ No Loro dependencies remain
- ✅ Bundle size decreases (Loro removed)
- ✅ Architecture documentation complete and accurate
- ✅ Stress tests pass (10k+ files)
- ✅ Old Loro chats migrated or handled gracefully

---

# Appendix: Quick Reference

## Phase 1-8 Summary

| Phase | Duration | Files Created | Deliverable |
|-------|----------|--------------|-------------|
| 1 | ~1 week | 5 files | Types, TreeNode, VaultState skeleton |
| 2 | ~2 weeks | 0 new (implement) | executeOperation, rebuild, rollback |
| 3 | ~1 week | 0 new (add to existing) | Parallel instances, validation |
| 4 | ~4 weeks | 0 new (migrate methods) | Dual-write, all methods migrated |
| 5 | ~2 weeks | 0 new (refactor workflows) | getFileChanges, approve, reject, sync |
| 6 | ~1 week | 1 file | Serialization, snapshot restore |
| 7 | ~1 week | 0 (removal) | Loro code removed, tests pass |
| 8 | ~1 week | 1 file | Benchmarks, documentation |

**Total**: ~12-14 weeks if done sequentially, or 6-8 weeks with parallelization

## Key Files by Phase

**Phase 1**: `/src/chat/vault-state/{types,tree-node,vault-state}.ts`
**Phase 2**: Implement methods in Phase 1 files
**Phase 3**: Modify `/src/chat/vault-overlay.svelte.ts`
**Phase 4**: Modify `/src/chat/vault-overlay.svelte.ts` methods
**Phase 5**: Refactor workflows in `/src/chat/vault-overlay.svelte.ts`
**Phase 6**: Create `/src/chat/vault-state/serialization.ts`, update `/src/chat/chat-serializer.ts`
**Phase 7**: Delete `/src/chat/{tree-fs,loro}.ts`
**Phase 8**: Create `/docs/dev/vault-state.md`, benchmark files

---

**Document Version**: 1.0
**Last Updated**: 2025-10-22
**Status**: Planning Complete - Ready for Implementation
