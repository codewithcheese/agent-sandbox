/**
 * Phase 3: Trash/Restore System Tests
 *
 * These tests validate soft-delete (trash) and restore functionality
 * at the VaultState level. Higher-level integration tests exist in the
 * vault-overlay test suite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VaultState, TreeNode } from '../../src/chat/vault-state';
import { TRASH_FOLDER, TMP_FOLDER, DELETED_FROM_KEY } from '../../src/chat/vault-state/types';

describe('VaultState Trash/Restore (Phase 3)', () => {
  let state: VaultState;

  beforeEach(() => {
    state = new VaultState('tracking');
  });

  describe('Infrastructure folders', () => {
    it('should create trash folder as literal', () => {
      const trash = state.getTrashFolder();
      expect(trash).toBeDefined();
      expect(trash.data.name).toBe(TRASH_FOLDER);
      expect(trash.data.isDirectory).toBe(true);
    });

    it('should create tmp folder as literal', () => {
      const tmp = state.findByPath(TMP_FOLDER);
      expect(tmp).toBeDefined();
      expect(tmp!.data.name).toBe(TMP_FOLDER);
      expect(tmp!.data.isDirectory).toBe(true);
    });

    it('should not record infrastructure folders as operations', () => {
      expect(state.getLogLength()).toBe(0);
    });
  });

  describe('TreeNode.trash()', () => {
    it('should move node to trash and set deletedFrom metadata', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({
        name: 'test.md',
        isDirectory: false,
        text: 'content'
      });

      const checkpoint = state.checkpoint();
      file.trash('test.md');

      // Node should be moved to trash
      const trash = state.getTrashFolder();
      expect(file.parentId).toBe(trash.id);
      expect(trash.childIds).toContain(file.id);

      // Node should have deletedFrom metadata
      expect(file.data[DELETED_FROM_KEY]).toBe('test.md');

      // Two operations should be recorded: MOVE and MODIFY
      expect(state.getLogLength()).toBe(checkpoint + 2);
    });

    it('should preserve node content when trashing', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({
        name: 'test.md',
        isDirectory: false,
        text: 'original content'
      });

      file.trash('test.md');

      expect(file.data.text).toBe('original content');
      expect(file.data.name).toBe('test.md');
    });

    it('should reject trashing root node', () => {
      const root = state.getNode('0')!;
      expect(() => root.trash('/')).toThrow('Cannot trash root or infrastructure nodes');
    });

    it('should reject trashing infrastructure folders', () => {
      const trash = state.getTrashFolder();
      expect(() => trash.trash(TRASH_FOLDER)).toThrow('Cannot trash root or infrastructure nodes');

      const tmp = state.findByPath(TMP_FOLDER)!;
      expect(() => tmp.trash(TMP_FOLDER)).toThrow('Cannot trash root or infrastructure nodes');
    });
  });

  describe('TreeNode.restore()', () => {
    it('should restore node from trash to specified parent', () => {
      const root = state.getNode('0')!;
      const dir = root.createChild({ name: 'folder', isDirectory: true });
      const file = root.createChild({
        name: 'test.md',
        isDirectory: false
      });

      file.trash('test.md');
      const checkpoint = state.checkpoint();

      file.restore(dir);

      // Node should be moved to new parent
      expect(file.parentId).toBe(dir.id);
      expect(dir.childIds).toContain(file.id);

      // deletedFrom metadata should be removed
      expect(file.data[DELETED_FROM_KEY]).toBeUndefined();

      // Two operations should be recorded: MODIFY and MOVE
      expect(state.getLogLength()).toBe(checkpoint + 2);
    });

    it('should reject restoring node not in trash', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({ name: 'test.md', isDirectory: false });

      expect(() => file.restore(root)).toThrow('Cannot restore node');
    });

    it('should allow restoring to root', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({ name: 'test.md', isDirectory: false });

      file.trash('test.md');
      file.restore(root);

      expect(file.parentId).toBe(root.id);
      expect(root.childIds).toContain(file.id);
    });
  });

  describe('TreeNode.isTrashed()', () => {
    it('should return true for trashed nodes', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({ name: 'test.md', isDirectory: false });

      expect(file.isTrashed()).toBe(false);

      file.trash('test.md');
      expect(file.isTrashed()).toBe(true);

      file.restore(root);
      expect(file.isTrashed()).toBe(false);
    });
  });

  describe('VaultState.findTrashed()', () => {
    it('should find trashed node by original path', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({ name: 'test.md', isDirectory: false });

      file.trash('folder/test.md');

      const found = state.findTrashed('folder/test.md');
      expect(found).toBe(file);
    });

    it('should return null for non-existent path', () => {
      const found = state.findTrashed('nonexistent/path.md');
      expect(found).toBeUndefined();
    });

    it('should handle multiple trashed files with different paths', () => {
      const root = state.getNode('0')!;
      const file1 = root.createChild({ name: 'file1.md', isDirectory: false });
      const file2 = root.createChild({ name: 'file2.md', isDirectory: false });

      file1.trash('path/file1.md');
      file2.trash('path/file2.md');

      expect(state.findTrashed('path/file1.md')).toBe(file1);
      expect(state.findTrashed('path/file2.md')).toBe(file2);
    });
  });

  describe('Rollback with trash/restore', () => {
    it('should restore nodes when rolling back trash operation', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({ name: 'test.md', isDirectory: false });
      const fileId = file.id;
      const checkpoint = state.checkpoint();

      file.trash('test.md');
      expect(file.isTrashed()).toBe(true);

      // Rollback should restore node to pre-trash state
      state.rollback(checkpoint);
      expect(state.getNode(fileId)!.isTrashed()).toBe(false);
      expect(state.getNode(fileId)!.parentId).toBe(root.id);
    });

    it('should preserve trash state through rebuild', () => {
      const root = state.getNode('0')!;
      const file = root.createChild({ name: 'test.md', isDirectory: false });
      file.trash('test.md');

      const checkpoint = state.checkpoint();
      state.rollback(checkpoint); // Triggers rebuild

      const trashedNode = state.findTrashed('test.md');
      expect(trashedNode).toBeDefined();
      expect(trashedNode?.id).toBe(file.id);
      expect(trashedNode?.isTrashed()).toBe(true);
    });
  });
});
