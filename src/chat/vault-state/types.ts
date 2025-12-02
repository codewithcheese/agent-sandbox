/**
 * Type definitions for the VaultState system.
 *
 * VaultState uses an operations log architecture where each mutation is recorded
 * as an Operation. This enables efficient rollback (truncate + rebuild) and
 * human-readable debugging compared to the previous Loro CRDT approach.
 */

/**
 * Stable, globally-unique identifier for a tree node.
 * Used to detect renames (same nodeID, different path).
 * Persisted in the operation log.
 */
export type NodeID = string;

/**
 * Infrastructure folder paths - special folders created as literals, not operations.
 * These are infrastructure for managing soft-deletes and temporary files.
 */
export const TRASH_FOLDER = '.overlay-trash' as const;
export const TMP_FOLDER = '.overlay-tmp' as const;

/**
 * Metadata key for soft-deleted nodes.
 * When a node is moved to trash, this field stores the original path for restoration.
 */
export const DELETED_FROM_KEY = 'deletedFrom' as const;

/**
 * File metadata (modification time, creation time, size).
 * Mirrors Obsidian's TAbstractFile.stat interface.
 */
export interface FileStats {
  mtime: number;  // Modification time (milliseconds since epoch)
  ctime: number;  // Creation time (milliseconds since epoch)
  size: number;   // File size in bytes
}

/**
 * Data structure for a tree node (file or directory).
 * Immutable except through operations that record changes.
 */
export interface NodeData {
  name: string;                    // Filename or directory name (path segment, not full path)
  isDirectory: boolean;            // True for directories, false for files
  text?: string;                   // Text file content (only set for text files)
  buffer?: Uint8Array;             // Binary file data (only set for binary files)
  stat?: FileStats;                // File metadata (mtime, ctime, size)
  [key: string]: unknown;          // Extensible for future fields
}

/**
 * Union type of all possible operations.
 * Each operation is a plain data object (not a class) for JSON serialization.
 */
export type Operation =
  | CreateOperation
  | DeleteOperation
  | ModifyOperation
  | MoveOperation
  | RenameOperation;

/**
 * CREATE operation: A node is created with initial data.
 *
 * The nodeId is auto-generated at creation time and recorded in the operation.
 * This enables:
 * - Deterministic replay: operations contain the exact nodeId to use
 * - Cross-state merging: operations can be copied between states with preserved IDs
 *
 * Example:
 *   { type: 'create', nodeId: '3', parentId: '0',
 *     data: { name: 'notes.md', isDirectory: false, text: 'initial content' } }
 */
export interface CreateOperation {
  type: 'create';
  nodeId: NodeID;                  // Auto-generated ID, recorded for replay/merge
  parentId: NodeID;                // ID of the parent directory
  data: NodeData;                  // Full node data including name, isDirectory, text, buffer, stat, etc.
}

/**
 * DELETE operation: A node and its entire subtree are deleted.
 * Recorded as a single atomic operation (not one per descendant).
 *
 * No information is lost—the full node state was captured in earlier CREATE and MODIFY
 * operations. If you want to know what was deleted, rebuild the tree up to before this
 * operation in the log.
 *
 * Example:
 *   { type: 'delete', nodeId: 'n2' }
 */
export interface DeleteOperation {
  type: 'delete';
  nodeId: NodeID;                  // ID of the deleted node
}

/**
 * MODIFY operation: Multiple fields on a node are changed atomically.
 *
 * All changes to a node are captured in a single operation for efficiency.
 * Multiple calls to node.modify() with different fields are automatically batched
 * in the operation log.
 *
 * Example:
 *   { type: 'modify', nodeId: 'n1', changes: {
 *       text: 'new content',
 *       mtime: 1234567890,
 *       stat: { ctime: 1234567890, mtime: 1234567890, size: 12 }
 *     } }
 */
export interface ModifyOperation {
  type: 'modify';
  nodeId: NodeID;                  // ID of the modified node
  changes: Partial<NodeData>;      // Fields that changed (any NodeData field)
}

/**
 * MOVE operation: A node is moved to a different parent directory.
 * Separate from RENAME (which changes the name).
 *
 * The old parent is not recorded—it's available from the node's current parentId field.
 *
 * Example:
 *   { type: 'move', nodeId: 'n1', newParentId: 'n3' }
 */
export interface MoveOperation {
  type: 'move';
  nodeId: NodeID;                  // ID of the moved node
  newParentId: NodeID;             // ID of the new parent
}

/**
 * RENAME operation: A node's name (path segment) is changed.
 * Separate from MOVE (which changes the parent).
 *
 * The old name is not recorded—it's available from the node's current data.name field
 * in the tree before this operation was applied.
 *
 * Example:
 *   { type: 'rename', nodeId: 'n1', newName: 'new.md' }
 */
export interface RenameOperation {
  type: 'rename';
  nodeId: NodeID;                  // ID of the renamed node
  newName: string;                 // New basename
}

/**
 * Serialized NodeData for JSON storage.
 * Binary Uint8Array buffers are encoded as base64 strings.
 * Encoding/decoding handled in Phase 6 serialization/deserialization.
 */
type SerializedNodeData = Omit<NodeData, 'buffer'> & { buffer?: string };

/**
 * Serialized variant of Operation for JSON storage.
 * Binary buffers in NodeData are encoded as base64 strings for JSON compatibility.
 *
 * Encoding is handled in Phase 6 (VaultState.serialize()).
 * Decoding is handled in Phase 6 (VaultState.deserialize()).
 */
export type SerializedOperation =
  | {
      type: 'create';
      nodeId: NodeID;
      parentId: NodeID;
      data: SerializedNodeData;
    }
  | DeleteOperation
  | {
      type: 'modify';
      nodeId: NodeID;
      changes: Omit<Partial<NodeData>, 'buffer'> & { buffer?: string };
    }
  | MoveOperation
  | RenameOperation;

/**
 * Complete serialized state of a VaultState instance.
 * Used for chat snapshot persistence.
 *
 * The operationsLog is the source of truth. To restore:
 * 1. Create empty VaultState
 * 2. Replay each operation in order
 * 3. State matches the snapshotted state
 */
export interface SerializedState {
  operationsLog: SerializedOperation[];
}
