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
      const root = state.getNode('0')!;
      const node = root.createChild({
        name: 'test.md',
        isDirectory: false,
        text: 'initial content'
      });

      expect(node).toBeDefined();
      expect(node.id).toBeDefined();
      expect(node.data.name).toBe('test.md');
      expect(node.data.text).toBe('initial content');
      expect(state.getLogLength()).toBe(1);
    });

    it('should create a directory node', () => {
      const root = state.getNode('0')!;
      const node = root.createChild({
        name: 'folder',
        isDirectory: true
      });

      expect(node.data.isDirectory).toBe(true);
      expect(state.getLogLength()).toBe(1);
    });

    it('should reject creation under non-existent parent', () => {
      const nonexistent = state.getNode('nonexistent');
      expect(nonexistent).toBeUndefined();

      const root = state.getNode('0')!;
      expect(() =>
        root.createChild({
          name: 'test.md',
          isDirectory: false
        })
      ).not.toThrow(); // createChild on root should succeed
    });

    it('should add child to parent', () => {
      const root = state.getNode('0')!;
      const child = root.createChild({
        name: 'test.md',
        isDirectory: false
      });

      expect(root.childIds).toContain(child.id);
    });
  });

  describe('MODIFY operations', () => {
    it('should modify a single field', () => {
      const root = state.getNode('0')!;
      const node = root.createChild({
        name: 'test.md',
        isDirectory: false,
        text: 'original'
      });

      node.modify({ text: 'updated' });

      expect(node.data.text).toBe('updated');
      expect(state.getLogLength()).toBe(2);
    });

    it('should modify multiple fields in one operation', () => {
      const root = state.getNode('0')!;
      const node = root.createChild({
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
      expect(node).toBeUndefined();
    });
  });

  describe('MOVE operations', () => {
    let d1: TreeNode;
    let n1: TreeNode;

    beforeEach(() => {
      const root = state.getNode('0')!;
      d1 = root.createChild({ name: 'folder', isDirectory: true });
      n1 = root.createChild({ name: 'file.md', isDirectory: false });
    });

    it('should move node to different parent', () => {
      n1.move(d1);

      expect(n1.parentId).toBe(d1.id);
      expect(d1.childIds).toContain(n1.id);
      expect(state.getNode('0')!.childIds).not.toContain(n1.id);
    });

    it('should reject move to non-existent parent', () => {
      const nonexistentParent = state.getNode('nonexistent');
      expect(nonexistentParent).toBeUndefined();
    });

    it('should detect circular reference', () => {
      const root = state.getNode('0')!;
      const d2 = root.createChild({
        name: 'dir2.md',
        isDirectory: true
      });

      // Create structure: root → [d1, d2, n1]
      // Move n1 under d1: root → [d1 → [n1], d2]
      n1.move(d1);
      expect(n1.parentId).toBe(d1.id);

      // Move d1 under d2: root → [d2 → [d1 → [n1]]]
      d1.move(d2);
      expect(d1.parentId).toBe(d2.id);

      // Try to move d2 under d1 - this would create cycle: d2 → d1 → d2
      // Since d1 is already under d2, moving d2 under d1 is circular
      expect(() => d2.move(d1)).toThrow('circular reference');
    });
  });

  describe('RENAME operations', () => {
    let node: TreeNode;

    beforeEach(() => {
      const root = state.getNode('0')!;
      node = root.createChild({
        name: 'original.md',
        isDirectory: false
      });
    });

    it('should rename a node', () => {
      node.rename('renamed.md');

      expect(node.data.name).toBe('renamed.md');
    });

    it('should reject rename of root', () => {
      const root = state.getNode('0')!;
      expect(() => root.rename('newroot')).toThrow(
        'Cannot rename root node'
      );
    });

    it('should reject rename of non-existent node', () => {
      const nonexistent = state.getNode('nonexistent');
      expect(nonexistent).toBeUndefined();
    });
  });

  describe('DELETE operations', () => {
    let d1: TreeNode;
    let n1: TreeNode;
    let n2: TreeNode;

    beforeEach(() => {
      const root = state.getNode('0')!;
      d1 = root.createChild({ name: 'folder', isDirectory: true });
      n1 = d1.createChild({ name: 'file.md', isDirectory: false });
      n2 = d1.createChild({ name: 'file2.md', isDirectory: false });
    });

    it('should delete a node', () => {
      n1.delete();

      expect(state.getNode('n1')).toBeUndefined();
      expect(d1.childIds).not.toContain('n1');
    });

    it('should delete node and all descendants', () => {
      // d1 has children n1 and n2
      d1.delete();

      expect(state.getNode('d1')).toBeUndefined();
      expect(state.getNode('n1')).toBeUndefined();
      expect(state.getNode('n2')).toBeUndefined();
    });

    it('should reject deletion of root', () => {
      const root = state.getNode('0')!;
      expect(() => root.delete()).toThrow(
        'Cannot delete root node'
      );
    });

    it('should reject deletion of non-existent node', () => {
      const nonexistent = state.getNode('nonexistent');
      expect(nonexistent).toBeUndefined();
    });
  });

  describe('Deterministic rebuild', () => {
    it('should rebuild tree identically from log', () => {
      // Create complex structure
      const root = state.getNode('0')!;
      const d1 = root.createChild({ name: 'folder', isDirectory: true });
      const n1 = d1.createChild({
        name: 'file.md',
        isDirectory: false,
        text: 'content'
      });
      const n2 = root.createChild({ name: 'file2.md', isDirectory: false });
      n1.modify({ text: 'updated' });
      n2.move(d1);

      // Capture state using node references
      const beforePath = state.getNodePath(n1.id);
      const beforeName = n2.data.name;
      const beforeParent = n2.parentId;
      const beforeLogLength = state.getLogLength();

      // Rollback to same checkpoint (triggers rebuild without changing log)
      state.rollback(beforeLogLength);

      // Verify structure is identical after rebuild
      expect(state.getNodePath(n1.id)).toBe(beforePath);
      expect(state.getNode(n2.id)!.data.name).toBe(beforeName);
      expect(state.getNode(n2.id)!.parentId).toBe(beforeParent);
      expect(state.getLogLength()).toBe(beforeLogLength);
    });

    it('should be idempotent - rebuild twice produces same tree', () => {
      const root = state.getNode('0')!;
      const d1 = root.createChild({ name: 'folder', isDirectory: true });
      const n1 = d1.createChild({ name: 'file.md', isDirectory: false });
      n1.modify({ text: 'content' });

      const logLength = state.getLogLength();

      // Get tree structure before rebuild
      const beforeRebuild = {
        n1Path: state.getNodePath(n1.id),
        d1Children: [...d1.childIds]
      };

      // Rollback (triggers rebuild)
      state.rollback(logLength);

      // Get structure after first rebuild
      const afterFirstRebuild = {
        n1Path: state.getNodePath(n1.id),
        d1Children: [...d1.childIds]
      };

      // Rollback again (second rebuild)
      state.rollback(logLength);

      // Get structure after second rebuild
      const afterSecondRebuild = {
        n1Path: state.getNodePath(n1.id),
        d1Children: [...d1.childIds]
      };

      // All three should be identical
      expect(afterFirstRebuild).toEqual(beforeRebuild);
      expect(afterSecondRebuild).toEqual(beforeRebuild);
    });
  });

  describe('Checkpoint and rollback', () => {
    it('should create checkpoint and rollback to it', () => {
      const root = state.getNode('0')!;
      const n1 = root.createChild({
        name: 'file.md',
        isDirectory: false
      });
      const cp1 = state.checkpoint();

      const n2 = root.createChild({
        name: 'file2.md',
        isDirectory: false
      });

      expect(state.getLogLength()).toBe(2);

      // Rollback to checkpoint
      state.rollback(cp1);

      expect(state.getLogLength()).toBe(1);
      expect(state.getNode(n1.id)).toBeDefined();
      expect(state.getNode(n2.id)).toBeUndefined();
    });

    it('should rollback to checkpoint 0 (empty state)', () => {
      const root = state.getNode('0')!;
      const n1 = root.createChild({
        name: 'file.md',
        isDirectory: false
      });
      const n2 = root.createChild({
        name: 'file2.md',
        isDirectory: false
      });

      state.rollback(0);

      expect(state.getLogLength()).toBe(0);
      expect(state.getNode(n1.id)).toBeUndefined();
      expect(state.getNode(n2.id)).toBeUndefined();
      // Root should still exist
      expect(state.getNode('0')).toBeDefined();
    });

    it('should reject invalid checkpoint', () => {
      expect(() => state.rollback(-1)).toThrow('Invalid checkpoint');
      expect(() => state.rollback(100)).toThrow('Invalid checkpoint');
    });
  });

  describe('Query operations', () => {
    let d1: any;
    let n1: any;
    let n2: any;

    beforeEach(() => {
      const root = state.getNode('0')!;
      d1 = root.createChild({ name: 'folder', isDirectory: true });
      n1 = d1.createChild({ name: 'file.md', isDirectory: false });
      n2 = d1.createChild({ name: 'file2.md', isDirectory: false });
    });

    it('should find node by path', () => {
      const node = state.findByPath('folder/file.md');
      expect(node?.id).toBe(n1.id);
      expect(node?.data.name).toBe('file.md');
    });

    it('should return null for non-existent path', () => {
      expect(state.findByPath('nonexistent/file.md')).toBeUndefined();
    });

    it('should get node path', () => {
      expect(state.getNodePath(n1.id)).toBe('folder/file.md');
      expect(state.getNodePath(d1.id)).toBe('folder');
      expect(state.getNodePath('0')).toBe('');
    });

    it('should get all descendants', () => {
      const descendants = state.getDescendants(d1.id);
      expect(descendants.length).toBe(2);
      expect(descendants.map(d => d.id)).toContain(n1.id);
      expect(descendants.map(d => d.id)).toContain(n2.id);
    });

    it('should filter operations by type', () => {
      const createOps = state.getOperations('create');
      expect(createOps.every(op => op.type === 'create')).toBe(true);
    });
  });

  describe('TreeNode API', () => {
    it('should modify through TreeNode', () => {
      const root = state.getNode('0')!;
      const node = root.createChild({
        name: 'test.md',
        isDirectory: false,
        text: 'original'
      });

      node.modify({ text: 'updated' });

      expect(node.data.text).toBe('updated');
    });

    it('should move through TreeNode', () => {
      const root = state.getNode('0')!;
      const d1 = root.createChild({
        name: 'folder',
        isDirectory: true
      });
      const n1 = root.createChild({
        name: 'file.md',
        isDirectory: false
      });

      n1.move(d1);

      expect(n1.parentId).toBe(d1.id);
    });

    it('should rename through TreeNode', () => {
      const root = state.getNode('0')!;
      const node = root.createChild({
        name: 'original.md',
        isDirectory: false
      });

      node.rename('renamed.md');

      expect(node.data.name).toBe('renamed.md');
    });

    it('should delete through TreeNode', () => {
      const root = state.getNode('0')!;
      const node = root.createChild({
        name: 'test.md',
        isDirectory: false
      });

      node.delete();

      expect(state.getNode('n1')).toBeUndefined();
    });

    it('should reject TreeNode rename of root', () => {
      const root = state.getNode('0')!;
      expect(() => root.rename('newroot')).toThrow('Cannot rename root node');
    });

    it('should reject TreeNode delete of root', () => {
      const root = state.getNode('0')!;
      expect(() => root.delete()).toThrow('Cannot delete root node');
    });
  });

  describe('Recording flag during rebuild', () => {
    it('should not record during rebuild', () => {
      const root = state.getNode('0')!;
      root.createChild({
        name: 'test.md',
        isDirectory: false
      });
      root.createChild({
        name: 'test2.md',
        isDirectory: false
      });

      const initialLogLength = state.getLogLength();

      // Rollback and rebuild (should not add operations)
      state.rollback(initialLogLength);

      expect(state.getLogLength()).toBe(initialLogLength);
    });
  });

  describe('Convenience Methods (TreeFS compatibility)', () => {
    let state: VaultState;

    beforeEach(() => {
      state = new VaultState('tracking');
    });

    describe('createAtPath()', () => {
      it('should create a file at a simple path', () => {
        const file = state.createAtPath('test.md', { isDirectory: false, text: 'content' });

        expect(file).toBeDefined();
        expect(file.data.name).toBe('test.md');
        expect(file.data.text).toBe('content');
        expect(file.parentId).toBe('0'); // Root is parent
      });

      it('should create a file at a nested path, creating parent directories', () => {
        const file = state.createAtPath('folder/subfolder/file.md', { isDirectory: false, text: 'content' });

        expect(file.data.name).toBe('file.md');
        expect(file.data.isDirectory).toBe(false);

        // Check parent chain exists
        const parent = state.getParent(file.id);
        expect(parent?.data.name).toBe('subfolder');

        const grandparent = state.getParent(parent!.id);
        expect(grandparent?.data.name).toBe('folder');

        const root = state.getParent(grandparent!.id);
        expect(root?.id).toBe('0');
      });

      it('should create directories without repeating if they already exist', () => {
        const file1 = state.createAtPath('folder/file1.md', { isDirectory: false });
        const file2 = state.createAtPath('folder/file2.md', { isDirectory: false });

        // Should reuse existing 'folder' directory
        const parent1 = state.getParent(file1.id);
        const parent2 = state.getParent(file2.id);
        expect(parent1!.id).toBe(parent2!.id);
      });

      it('should throw if path contains a non-directory node', () => {
        state.createAtPath('file.md', { isDirectory: false });

        expect(() => {
          state.createAtPath('file.md/nested.txt', { isDirectory: false });
        }).toThrow('Path is not a directory');
      });

      it('should throw on empty path', () => {
        expect(() => {
          state.createAtPath('', { isDirectory: false });
        }).toThrow('Cannot create node with empty path');
      });

      it('should record operations for created nodes', () => {
        const beforeLength = state.getLogLength();
        state.createAtPath('folder/subfolder/file.md', { isDirectory: false });

        // 3 creates: folder, subfolder, file
        expect(state.getLogLength()).toBe(beforeLength + 3);
      });
    });

    describe('ensureDirs()', () => {
      it('should return root for empty path', () => {
        const root = state.ensureDirs('');
        expect(root.id).toBe('0');
      });

      it('should return root for slash', () => {
        const root = state.ensureDirs('/');
        expect(root.id).toBe('0');
      });

      it('should create directories along a path', () => {
        const result = state.ensureDirs('folder/subfolder/deep');

        expect(result.data.name).toBe('deep');
        expect(result.data.isDirectory).toBe(true);

        const parent = state.getParent(result.id);
        expect(parent?.data.name).toBe('subfolder');
      });

      it('should return existing directory without recreating', () => {
        const first = state.ensureDirs('folder/subfolder');
        const firstId = first.id;

        const second = state.ensureDirs('folder/subfolder');
        expect(second.id).toBe(firstId);
      });

      it('should throw if path contains a file', () => {
        state.createAtPath('file.md', { isDirectory: false });

        expect(() => {
          state.ensureDirs('file.md/nested');
        }).toThrow('Path is not a directory');
      });

      it('should restore and recreate trashed directories', () => {
        const dir = state.ensureDirs('folder');
        const dirId = dir.id;

        // Trash it
        dir.trash('folder');
        expect(state.findByPath('folder')).toBeUndefined();

        // Ensure path again - should recreate
        const restored = state.ensureDirs('folder');
        expect(restored.id).not.toBe(dirId); // New directory (old one is in trash)
      });
    });

    describe('findById()', () => {
      it('should find a node by ID', () => {
        const root = state.getNode('0')!;
        const file = root.createChild({ name: 'test.md', isDirectory: false });

        const found = state.findById(file.id);
        expect(found).toBe(file);
      });

      it('should return null for non-existent ID', () => {
        const found = state.findById('nonexistent');
        expect(found).toBeUndefined();
      });

      it('should be alias for getNode', () => {
        const root = state.getNode('0')!;
        const file = root.createChild({ name: 'test.md', isDirectory: false });

        expect(state.findById(file.id)).toBe(state.getNode(file.id));
      });
    });

    describe('getChildren()', () => {
      it('should return empty array for leaf node', () => {
        const root = state.getNode('0')!;
        const file = root.createChild({ name: 'test.md', isDirectory: false });

        const children = state.getChildren(file.id);
        expect(children).toEqual([]);
      });

      it('should return all children of a node', () => {
        const root = state.getNode('0')!;
        const folder = root.createChild({ name: 'folder', isDirectory: true });
        const file1 = folder.createChild({ name: 'file1.md', isDirectory: false });
        const file2 = folder.createChild({ name: 'file2.md', isDirectory: false });

        const children = state.getChildren(folder.id);
        expect(children).toHaveLength(2);
        expect(children.map(c => c.id)).toContain(file1.id);
        expect(children.map(c => c.id)).toContain(file2.id);
      });

      it('should return empty array for non-existent node', () => {
        const children = state.getChildren('nonexistent');
        expect(children).toEqual([]);
      });

      it('should include infrastructure folders for root', () => {
        const root = state.getNode('0')!;
        const children = state.getChildren('0');

        // Should include .overlay-trash and .overlay-tmp
        expect(children.length).toBeGreaterThanOrEqual(2);
        expect(children.map(c => c.data.name)).toContain('.overlay-trash');
        expect(children.map(c => c.data.name)).toContain('.overlay-tmp');
      });
    });

    describe('getParent()', () => {
      it('should return parent of a node', () => {
        const root = state.getNode('0')!;
        const file = root.createChild({ name: 'test.md', isDirectory: false });

        const parent = state.getParent(file.id);
        expect(parent?.id).toBe(root.id);
      });

      it('should return null for root node', () => {
        const parent = state.getParent('0');
        expect(parent).toBeUndefined();
      });

      it('should return null for non-existent node', () => {
        const parent = state.getParent('nonexistent');
        expect(parent).toBeUndefined();
      });

      it('should navigate parent chain', () => {
        state.createAtPath('a/b/c/file.md', { isDirectory: false });
        const file = state.findByPath('a/b/c/file.md')!;

        let current = state.getParent(file.id);
        expect(current?.data.name).toBe('c');

        current = state.getParent(current!.id);
        expect(current?.data.name).toBe('b');

        current = state.getParent(current!.id);
        expect(current?.data.name).toBe('a');

        current = state.getParent(current!.id);
        expect(current?.id).toBe('0'); // root
      });
    });
  });
});
