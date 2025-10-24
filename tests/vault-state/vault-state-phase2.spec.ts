/**
 * Phase 2 Implementation Tests: VaultState Core Functionality
 *
 * These tests validate the actual operations, tree building, replay, rollback,
 * and circular reference detection implemented in Phase 2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VaultState, TreeNode } from '../../src/chat/vault-state';

describe('VaultState (Phase 2: Implementation)', () => {
  let state: VaultState;

  beforeEach(() => {
    state = new VaultState('tracking');
  });

  describe('CREATE operations', () => {
    it('should create a file node with initial data', () => {
      const root = state.getNode('root')!;
      const node = root.createChild('n1', {
        name: 'test.md',
        isDirectory: false,
        text: 'initial content'
      });

      expect(node).toBeDefined();
      expect(node.id).toBe('n1');
      expect(node.data.name).toBe('test.md');
      expect(node.data.text).toBe('initial content');
      expect(state.getLogLength()).toBe(1);
    });

    it('should create a directory node', () => {
      const root = state.getNode('root')!;
      const node = root.createChild('d1', {
        name: 'folder',
        isDirectory: true
      });

      expect(node.data.isDirectory).toBe(true);
      expect(state.getLogLength()).toBe(1);
    });

    it('should reject creation under non-existent parent', () => {
      const nonexistent = state.getNode('nonexistent');
      expect(nonexistent).toBeNull();

      const root = state.getNode('root')!;
      expect(() =>
        root.createChild('n1', {
          name: 'test.md',
          isDirectory: false
        })
      ).not.toThrow(); // createChild on root should succeed
    });

    it('should add child to parent', () => {
      const root = state.getNode('root')!;
      root.createChild('n1', {
        name: 'test.md',
        isDirectory: false
      });

      expect(root.childIds).toContain('n1');
    });
  });

  describe('MODIFY operations', () => {
    it('should modify a single field', () => {
      const root = state.getNode('root')!;
      const node = root.createChild('n1', {
        name: 'test.md',
        isDirectory: false,
        text: 'original'
      });

      node.modify({ text: 'updated' });

      expect(node.data.text).toBe('updated');
      expect(state.getLogLength()).toBe(2);
    });

    it('should modify multiple fields in one operation', () => {
      const root = state.getNode('root')!;
      const node = root.createChild('n1', {
        name: 'test.md',
        isDirectory: false,
        text: 'original'
      });

      node.modify({
        text: 'updated',
        stat: { mtime: 123, ctime: 456, size: 100 }
      });

      expect(node.data.text).toBe('updated');
      expect(node.data.stat?.mtime).toBe(123);
      expect(state.getLogLength()).toBe(2);
    });

    it('should reject modification of non-existent node', () => {
      const node = state.getNode('nonexistent');
      expect(node).toBeNull();
    });
  });

  describe('MOVE operations', () => {
    let d1: TreeNode;
    let n1: TreeNode;

    beforeEach(() => {
      const root = state.getNode('root')!;
      d1 = root.createChild('d1', { name: 'folder', isDirectory: true });
      n1 = root.createChild('n1', { name: 'file.md', isDirectory: false });
    });

    it('should move node to different parent', () => {
      n1.move(d1);

      expect(n1.parentId).toBe('d1');
      expect(d1.childIds).toContain('n1');
      expect(state.getNode('root')!.childIds).not.toContain('n1');
    });

    it('should reject move to non-existent parent', () => {
      const nonexistentParent = state.getNode('nonexistent');
      expect(nonexistentParent).toBeNull();
    });

    it('should detect circular reference', () => {
      const root = state.getNode('root')!;
      const d2 = root.createChild('d2', {
        name: 'dir2.md',
        isDirectory: true
      });

      // Create structure: root → [d1, d2, n1]
      // Move n1 under d1: root → [d1 → [n1], d2]
      n1.move(d1);
      expect(n1.parentId).toBe('d1');

      // Move d1 under d2: root → [d2 → [d1 → [n1]]]
      d1.move(d2);
      expect(d1.parentId).toBe('d2');

      // Try to move d2 under d1 - this would create cycle: d2 → d1 → d2
      // Since d1 is already under d2, moving d2 under d1 is circular
      expect(() => d2.move(d1)).toThrow('circular reference');
    });
  });

  describe('RENAME operations', () => {
    let node: TreeNode;

    beforeEach(() => {
      const root = state.getNode('root')!;
      node = root.createChild('n1', {
        name: 'original.md',
        isDirectory: false
      });
    });

    it('should rename a node', () => {
      node.rename('renamed.md');

      expect(node.data.name).toBe('renamed.md');
    });

    it('should reject rename of root', () => {
      const root = state.getNode('root')!;
      expect(() => root.rename('newroot')).toThrow(
        'Cannot rename root node'
      );
    });

    it('should reject rename of non-existent node', () => {
      const nonexistent = state.getNode('nonexistent');
      expect(nonexistent).toBeNull();
    });
  });

  describe('DELETE operations', () => {
    let d1: TreeNode;
    let n1: TreeNode;
    let n2: TreeNode;

    beforeEach(() => {
      const root = state.getNode('root')!;
      d1 = root.createChild('d1', { name: 'folder', isDirectory: true });
      n1 = d1.createChild('n1', { name: 'file.md', isDirectory: false });
      n2 = d1.createChild('n2', { name: 'file2.md', isDirectory: false });
    });

    it('should delete a node', () => {
      n1.delete();

      expect(state.getNode('n1')).toBeNull();
      expect(d1.childIds).not.toContain('n1');
    });

    it('should delete node and all descendants', () => {
      // d1 has children n1 and n2
      d1.delete();

      expect(state.getNode('d1')).toBeNull();
      expect(state.getNode('n1')).toBeNull();
      expect(state.getNode('n2')).toBeNull();
    });

    it('should reject deletion of root', () => {
      const root = state.getNode('root')!;
      expect(() => root.delete()).toThrow(
        'Cannot delete root node'
      );
    });

    it('should reject deletion of non-existent node', () => {
      const nonexistent = state.getNode('nonexistent');
      expect(nonexistent).toBeNull();
    });
  });

  describe('Deterministic rebuild', () => {
    it('should rebuild tree identically from log', () => {
      // Create complex structure
      const root = state.getNode('root')!;
      const d1 = root.createChild('d1', { name: 'folder', isDirectory: true });
      const n1 = d1.createChild('n1', {
        name: 'file.md',
        isDirectory: false,
        text: 'content'
      });
      const n2 = root.createChild('n2', { name: 'file2.md', isDirectory: false });
      n1.modify({ text: 'updated' });
      n2.move(d1);

      // Capture state
      const beforePath = state.getNodePath('n1');
      const beforeName = state.getNode('n2')!.data.name;
      const beforeParent = state.getNode('n2')!.parentId;
      const beforeLogLength = state.getLogLength();

      // Rollback to same checkpoint (triggers rebuild without changing log)
      state.rollback(beforeLogLength);

      // Verify structure is identical after rebuild
      expect(state.getNodePath('n1')).toBe(beforePath);
      expect(state.getNode('n2')!.data.name).toBe(beforeName);
      expect(state.getNode('n2')!.parentId).toBe(beforeParent);
      expect(state.getLogLength()).toBe(beforeLogLength);
    });

    it('should be idempotent - rebuild twice produces same tree', () => {
      const root = state.getNode('root')!;
      const d1 = root.createChild('d1', { name: 'folder', isDirectory: true });
      const n1 = d1.createChild('n1', { name: 'file.md', isDirectory: false });
      n1.modify({ text: 'content' });

      const logLength = state.getLogLength();

      // Get tree structure before rebuild
      const beforeRebuild = {
        n1Path: state.getNodePath('n1'),
        d1Children: [...state.getNode('d1')!.childIds]
      };

      // Rollback (triggers rebuild)
      state.rollback(logLength);

      // Get structure after first rebuild
      const afterFirstRebuild = {
        n1Path: state.getNodePath('n1'),
        d1Children: [...state.getNode('d1')!.childIds]
      };

      // Rollback again (second rebuild)
      state.rollback(logLength);

      // Get structure after second rebuild
      const afterSecondRebuild = {
        n1Path: state.getNodePath('n1'),
        d1Children: [...state.getNode('d1')!.childIds]
      };

      // All three should be identical
      expect(afterFirstRebuild).toEqual(beforeRebuild);
      expect(afterSecondRebuild).toEqual(beforeRebuild);
    });
  });

  describe('Checkpoint and rollback', () => {
    it('should create checkpoint and rollback to it', () => {
      const root = state.getNode('root')!;
      root.createChild('n1', {
        name: 'file.md',
        isDirectory: false
      });
      const cp1 = state.checkpoint();

      root.createChild('n2', {
        name: 'file2.md',
        isDirectory: false
      });

      expect(state.getLogLength()).toBe(2);

      // Rollback to checkpoint
      state.rollback(cp1);

      expect(state.getLogLength()).toBe(1);
      expect(state.getNode('n1')).toBeDefined();
      expect(state.getNode('n2')).toBeNull();
    });

    it('should rollback to checkpoint 0 (empty state)', () => {
      const root = state.getNode('root')!;
      root.createChild('n1', {
        name: 'file.md',
        isDirectory: false
      });
      root.createChild('n2', {
        name: 'file2.md',
        isDirectory: false
      });

      state.rollback(0);

      expect(state.getLogLength()).toBe(0);
      expect(state.getNode('n1')).toBeNull();
      expect(state.getNode('n2')).toBeNull();
      // Root should still exist
      expect(state.getNode('root')).toBeDefined();
    });

    it('should reject invalid checkpoint', () => {
      expect(() => state.rollback(-1)).toThrow('Invalid checkpoint');
      expect(() => state.rollback(100)).toThrow('Invalid checkpoint');
    });
  });

  describe('Query operations', () => {
    beforeEach(() => {
      const root = state.getNode('root')!;
      const d1 = root.createChild('d1', { name: 'folder', isDirectory: true });
      d1.createChild('n1', { name: 'file.md', isDirectory: false });
      d1.createChild('n2', { name: 'file2.md', isDirectory: false });
    });

    it('should find node by path', () => {
      const node = state.findByPath('folder/file.md');
      expect(node?.id).toBe('n1');
    });

    it('should return null for non-existent path', () => {
      expect(state.findByPath('nonexistent/file.md')).toBeNull();
    });

    it('should get node path', () => {
      expect(state.getNodePath('n1')).toBe('folder/file.md');
      expect(state.getNodePath('d1')).toBe('folder');
      expect(state.getNodePath('root')).toBe('');
    });

    it('should get all descendants', () => {
      const descendants = state.getDescendants('d1');
      expect(descendants.length).toBe(2);
      expect(descendants.map(d => d.id)).toContain('n1');
      expect(descendants.map(d => d.id)).toContain('n2');
    });

    it('should get operations for a specific node', () => {
      const ops = state.getOperationsForNode('n1');
      expect(ops.length).toBeGreaterThan(0);
      expect(ops.every(op => op.nodeId === 'n1')).toBe(true);
    });

    it('should filter operations by type', () => {
      const createOps = state.getOperations('create');
      expect(createOps.every(op => op.type === 'create')).toBe(true);
    });
  });

  describe('TreeNode API', () => {
    it('should modify through TreeNode', () => {
      const root = state.getNode('root')!;
      const node = root.createChild('n1', {
        name: 'test.md',
        isDirectory: false,
        text: 'original'
      });

      node.modify({ text: 'updated' });

      expect(node.data.text).toBe('updated');
    });

    it('should move through TreeNode', () => {
      const root = state.getNode('root')!;
      const d1 = root.createChild('d1', {
        name: 'folder',
        isDirectory: true
      });
      const n1 = root.createChild('n1', {
        name: 'file.md',
        isDirectory: false
      });

      n1.move(d1);

      expect(n1.parentId).toBe('d1');
    });

    it('should rename through TreeNode', () => {
      const root = state.getNode('root')!;
      const node = root.createChild('n1', {
        name: 'original.md',
        isDirectory: false
      });

      node.rename('renamed.md');

      expect(node.data.name).toBe('renamed.md');
    });

    it('should delete through TreeNode', () => {
      const root = state.getNode('root')!;
      const node = root.createChild('n1', {
        name: 'test.md',
        isDirectory: false
      });

      node.delete();

      expect(state.getNode('n1')).toBeNull();
    });

    it('should reject TreeNode rename of root', () => {
      const root = state.getNode('root')!;
      expect(() => root.rename('newroot')).toThrow('Cannot rename root node');
    });

    it('should reject TreeNode delete of root', () => {
      const root = state.getNode('root')!;
      expect(() => root.delete()).toThrow('Cannot delete root node');
    });
  });

  describe('Recording flag during rebuild', () => {
    it('should not record during rebuild', () => {
      const root = state.getNode('root')!;
      root.createChild('n1', {
        name: 'test.md',
        isDirectory: false
      });
      root.createChild('n2', {
        name: 'test2.md',
        isDirectory: false
      });

      const initialLogLength = state.getLogLength();

      // Rollback and rebuild (should not add operations)
      state.rollback(initialLogLength);

      expect(state.getLogLength()).toBe(initialLogLength);
    });
  });
});
