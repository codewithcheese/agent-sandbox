# Three-Way Merge Integration into mergeDocs

This document describes integrating three-way merge logic into `mergeDocs()` by storing previous text in MODIFY operations.

## Background

With Loro CRDT, merge happened inside `proposedDoc.import(trackingDoc.export(...))`. The CRDT automatically merged concurrent character-level edits.

With VaultState's operations log, `mergeDocs()` replays whole-text MODIFY operations. Currently, when both AI and vault have modified a file, the three-way merge result is overwritten by the subsequent `mergeDocs()` replay.

## Solution: Store Previous Text in MODIFY Operations

Store the previous text value in the MODIFY operation itself, enabling three-way merge during replay.

### Modified MODIFY Operation

```typescript
interface ModifyOperation {
  type: 'modify';
  nodeId: NodeID;
  changes: Partial<NodeData>;
  previousText?: string;  // What text was before this MODIFY (for text changes only)
}
```

### Three-Way Merge in mergeDocs

When replaying a MODIFY operation with text changes:

```typescript
if (op.type === 'modify' && 'text' in op.changes && op.previousText !== undefined) {
  const proposedNode = proposedState.findById(op.nodeId);
  const proposedText = proposedNode?.data.text;

  // If proposed differs from base, three-way merge is needed
  if (proposedText !== undefined && proposedText !== op.previousText) {
    const mergedText = performThreeWayMerge(
      op.previousText,      // base
      proposedText,         // proposed (AI changes)
      op.changes.text       // vault (new content)
    );
    proposedState.replayOperation({
      ...op,
      changes: { ...op.changes, text: mergedText }
    });
  } else {
    // No divergence, apply directly
    proposedState.replayOperation(op);
  }
}
```

### Recording MODIFY with Previous Text

In `TreeNode.modify()` or the recording logic:

```typescript
// When recording a text modification
if ('text' in changes) {
  const previousText = this.data.text;
  recordOperation({
    type: 'modify',
    nodeId: this.id,
    changes,
    previousText
  });
}
```

## Efficiency Considerations

Storing full previous text for every MODIFY can be expensive for large files with frequent changes.

### Unoptimized Approach

Store `previousText` for every text MODIFY operation.

**Pros:**
- Simple implementation
- Always have data needed for three-way merge
- Supports rollback to any point

**Cons:**
- Storage grows with each modification
- Large files duplicate content many times

### Optimized Approaches

#### Option 1: Text-Only Storage

Only store `previousText` for text file modifications, not binary.

```typescript
if ('text' in changes && typeof this.data.text === 'string') {
  op.previousText = this.data.text;
}
// Binary changes: no previousText, use last-write-wins during merge
```

**Rationale:** Binary files can't be three-way merged anyway; they use last-write-wins semantics.

#### Option 2: Delta Storage

Instead of full previous text, store a diff/patch.

```typescript
interface ModifyOperation {
  type: 'modify';
  nodeId: NodeID;
  changes: Partial<NodeData>;
  textDelta?: string;  // Patch to reconstruct previous from current
}
```

**Pros:** Much smaller for large files with small changes
**Cons:** More complex to compute and apply; may be larger for complete rewrites

#### Option 3: Pruning After Merge

After successful `mergeDocs()`, prune `previousText` from operations that are safely merged.

```typescript
// After mergeDocs completes successfully
for (const op of operationsSincePrunePoint) {
  if (op.type === 'modify') {
    delete op.previousText;
  }
}
this.prunePoint = this.operationsLog.length;
```

**Constraint:** Cannot rollback past the prune point. Suitable if rollback is bounded (e.g., only within current session).

#### Option 4: Content-Addressable Storage

Store text content separately, reference by hash.

```typescript
interface ModifyOperation {
  type: 'modify';
  nodeId: NodeID;
  changes: { textRef?: string; /* hash */ };
  previousTextRef?: string;  // hash
}

// Separate content store
contentStore: Map<string, string>  // hash → content
```

**Pros:** Deduplication when same content appears multiple times
**Cons:** More complex architecture; need garbage collection for unused content

## Recommended Approach

Start with **Option 1 (Text-Only Storage)** as the baseline:
- Simple to implement
- Handles the common case (text files)
- Binary files already use last-write-wins

Consider **Option 3 (Pruning)** if storage becomes a concern:
- Add after basic implementation is working
- Define a safe prune point (e.g., after user approves changes)

## Implementation Steps

- Add `previousText?: string` to `ModifyOperation` type
- Update `executeModify` to capture previous text before applying changes
- Update serialization/deserialization to handle `previousText`
- Modify `mergeDocs()` to perform three-way merge when `previousText` exists and proposed differs
- Remove direct `performThreeWayMerge` call from `syncPath()`
- Update tests

## Edge Cases

| Case | Handling |
|------|----------|
| Binary files | No `previousText`, last-write-wins during merge |
| New file (no previous) | `previousText` is undefined, apply directly |
| Proposed unchanged | `proposedText === previousText`, apply directly |
| Text deleted | `changes.text` is undefined, apply directly |
| Conflicts in merge | diff3 includes conflict markers in result |
