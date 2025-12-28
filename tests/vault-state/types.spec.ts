/**
 * Phase 1 Tests: Type definitions and operation structures
 *
 * These tests verify that all operation types and data structures are correctly defined.
 */

import { describe, it, expect } from 'vitest';
import type {
  NodeID,
  NodeData,
  FileStats,
  Operation,
  CreateOperation,
  DeleteOperation,
  ModifyOperation,
  MoveOperation,
  RenameOperation,
  SerializedState
} from '../../src/chat/vault-state';

describe('Type definitions', () => {
  describe('NodeID', () => {
    it('should accept string NodeIDs', () => {
      const id: NodeID = 'node-123';
      expect(typeof id).toBe('string');
    });
  });

  describe('FileStats', () => {
    it('should have mtime, ctime, and size', () => {
      const stats: FileStats = {
        mtime: Date.now(),
        ctime: Date.now(),
        size: 1024
      };
      expect(stats.mtime).toBeDefined();
      expect(stats.ctime).toBeDefined();
      expect(stats.size).toBeDefined();
    });
  });

  describe('NodeData', () => {
    it('should have required fields', () => {
      const data: NodeData = {
        name: 'test.md',
        isDirectory: false
      };
      expect(data.name).toBe('test.md');
      expect(data.isDirectory).toBe(false);
    });

    it('should support optional text field', () => {
      const data: NodeData = {
        name: 'test.md',
        isDirectory: false,
        text: 'content'
      };
      expect(data.text).toBe('content');
    });

    it('should support optional buffer field', () => {
      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const data: NodeData = {
        name: 'image.png',
        isDirectory: false,
        buffer
      };
      expect(new Uint8Array(data.buffer!)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('should support optional stat field', () => {
      const stat: FileStats = { mtime: Date.now(), ctime: Date.now(), size: 1024 };
      const data: NodeData = {
        name: 'test.md',
        isDirectory: false,
        stat
      };
      expect(data.stat).toEqual(stat);
    });

    it('should be extensible with custom fields', () => {
      const data: NodeData = {
        name: 'test.md',
        isDirectory: false,
        customField: 'custom value'
      };
      expect((data as any).customField).toBe('custom value');
    });
  });

  describe('Operation types', () => {
    describe('CreateOperation', () => {
      it('should have required fields', () => {
        const op: CreateOperation = {
          type: 'create',
          nodeId: '1',
          parentId: '0',
          data: {
            name: 'test.md',
            isDirectory: false
          }
        };
        expect(op.type).toBe('create');
        expect(op.nodeId).toBe('1');
        expect(op.parentId).toBe('0');
        expect(op.data.name).toBe('test.md');
        expect(op.data.isDirectory).toBe(false);
      });

      it('should support optional text in data', () => {
        const op: CreateOperation = {
          type: 'create',
          nodeId: '1',
          parentId: '0',
          data: {
            name: 'test.md',
            isDirectory: false,
            text: 'initial content'
          }
        };
        expect(op.data.text).toBe('initial content');
      });

      it('should support optional buffer in data', () => {
        const buffer = new Uint8Array([1, 2, 3]).buffer;
        const op: CreateOperation = {
          type: 'create',
          nodeId: '1',
          parentId: '0',
          data: {
            name: 'image.png',
            isDirectory: false,
            buffer
          }
        };
        expect(new Uint8Array(op.data.buffer!)).toEqual(new Uint8Array([1, 2, 3]));
      });

      it('should support optional stat in data', () => {
        const stat: FileStats = { mtime: Date.now(), ctime: Date.now(), size: 100 };
        const op: CreateOperation = {
          type: 'create',
          nodeId: '1',
          parentId: '0',
          data: {
            name: 'test.md',
            isDirectory: false,
            stat
          }
        };
        expect(op.data.stat).toEqual(stat);
      });
    });

    describe('DeleteOperation', () => {
      it('should have required fields', () => {
        const op: DeleteOperation = {
          type: 'delete',
          nodeId: 'n1'
        };
        expect(op.type).toBe('delete');
        expect(op.nodeId).toBe('n1');
      });
    });

    describe('ModifyOperation', () => {
      it('should have required fields', () => {
        const op: ModifyOperation = {
          type: 'modify',
          nodeId: 'n1',
          changes: {
            text: 'new'
          }
        };
        expect(op.type).toBe('modify');
        expect(op.nodeId).toBe('n1');
        expect(op.changes.text).toBe('new');
      });

      it('should support multiple changes', () => {
        const op: ModifyOperation = {
          type: 'modify',
          nodeId: 'n1',
          changes: {
            text: 'new content',
            mtime: 2000
          }
        };
        expect(op.changes.text).toBe('new content');
        expect(op.changes.mtime).toBe(2000);
      });

      it('should support any NodeData field', () => {
        const stat: FileStats = { ctime: 1000, mtime: 2000, size: 100 };
        const op: ModifyOperation = {
          type: 'modify',
          nodeId: 'n1',
          changes: {
            text: 'content',
            stat
          }
        };
        expect(op.changes.stat).toEqual(stat);
      });
    });

    describe('MoveOperation', () => {
      it('should have required fields', () => {
        const op: MoveOperation = {
          type: 'move',
          nodeId: 'n1',
          newParentId: 'parent2'
        };
        expect(op.type).toBe('move');
        expect(op.nodeId).toBe('n1');
        expect(op.newParentId).toBe('parent2');
      });
    });

    describe('RenameOperation', () => {
      it('should have required fields', () => {
        const op: RenameOperation = {
          type: 'rename',
          nodeId: 'n1',
          newName: 'new.md'
        };
        expect(op.type).toBe('rename');
        expect(op.nodeId).toBe('n1');
        expect(op.newName).toBe('new.md');
      });
    });
  });

  describe('SerializedState', () => {
    it('should have operationsLog', () => {
      const state: SerializedState = {
        operationsLog: []
      };
      expect(Array.isArray(state.operationsLog)).toBe(true);
    });

    it('should support modify operation in the log', () => {
      const op: SerializedState['operationsLog'][0] = {
        type: 'modify',
        nodeId: 'n1',
        changes: { text: 'new' }
      };
      const state: SerializedState = {
        operationsLog: [op]
      };
      expect(state.operationsLog).toHaveLength(1);
    });

    it('should support rename operation in the log', () => {
      const op: SerializedState['operationsLog'][0] = {
        type: 'rename',
        nodeId: 'n1',
        newName: 'new.md'
      };
      const state: SerializedState = {
        operationsLog: [op]
      };
      expect(state.operationsLog).toHaveLength(1);
    });
  });

  describe('Operation union type', () => {
    it('should accept CreateOperation', () => {
      const op: Operation = {
        type: 'create',
        nodeId: '1',
        parentId: '0',
        data: { name: 'test.md', isDirectory: false }
      };
      expect(op.type).toBe('create');
    });

    it('should accept DeleteOperation', () => {
      const op: Operation = {
        type: 'delete',
        nodeId: 'n1'
      };
      expect(op.type).toBe('delete');
    });

    it('should accept ModifyOperation', () => {
      const op: Operation = {
        type: 'modify',
        nodeId: 'n1',
        changes: { text: 'new' }
      };
      expect(op.type).toBe('modify');
    });

    it('should accept MoveOperation', () => {
      const op: Operation = {
        type: 'move',
        nodeId: 'n1',
        newParentId: 'parent2'
      };
      expect(op.type).toBe('move');
    });

    it('should accept RenameOperation', () => {
      const op: Operation = {
        type: 'rename',
        nodeId: 'n1',
        newName: 'new.md'
      };
      expect(op.type).toBe('rename');
    });
  });
});
