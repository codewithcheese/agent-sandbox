/**
 * Phase 1 Tests: TreeNode class structure and basic instantiation
 *
 * These tests verify that TreeNode can be created with the correct structure.
 * Full method implementation tests will be in Phase 2.
 *
 * Note: TreeNode constructor is internal - users create nodes via createChild()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TreeNode, VaultState } from '../../src/chat/vault-state';

describe('TreeNode (Phase 1: Structure)', () => {
  let vaultState: VaultState;
  let root: TreeNode;

  beforeEach(() => {
    vaultState = new VaultState('tracking');
    root = vaultState.getNode(vaultState.findByPath('')!)!;  // Get root
  });

  it('should have an auto-generated ID', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    expect(node.id).toBeDefined();
    expect(typeof node.id).toBe('string');
    expect(node.id.startsWith('node-')).toBe(true);
  });

  it('should have no parent initially (except root)', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    expect(node.parentId).toBe(root.id);
  });

  it('should have empty children list initially', () => {
    const node = root.createChild({ name: 'folder', isDirectory: true });
    expect(node.childIds).toEqual([]);
  });

  it('should have node data with configured values', () => {
    const node = root.createChild({
      name: 'test.md',
      isDirectory: false,
      text: 'content'
    });
    expect(node.data.name).toBe('test.md');
    expect(node.data.isDirectory).toBe(false);
    expect(node.data.text).toBe('content');
  });

  it('should have mutable node data', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    node.data.name = 'renamed.md';
    node.data.text = 'new content';
    expect(node.data.name).toBe('renamed.md');
    expect(node.data.text).toBe('new content');
  });

  it('should have modify method', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    expect(typeof node.modify).toBe('function');
  });

  it('should have move method', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    expect(typeof node.move).toBe('function');
  });

  it('should have rename method', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    expect(typeof node.rename).toBe('function');
  });

  it('should have delete method', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    expect(typeof node.delete).toBe('function');
  });

  it('should have working modify method', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    node.modify({ text: 'updated' });
    expect(node.data.text).toBe('updated');
  });

  it('should have working move method', () => {
    const folder = root.createChild({ name: 'folder', isDirectory: true });
    const file = root.createChild({ name: 'test.md', isDirectory: false });

    file.move(folder);

    expect(file.parentId).toBe(folder.id);
    expect(folder.childIds).toContain(file.id);
  });

  it('should have working rename method', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    node.rename('renamed.md');

    expect(node.data.name).toBe('renamed.md');
  });

  it('should have working delete method', () => {
    const node = root.createChild({ name: 'test.md', isDirectory: false });
    node.delete();

    expect(vaultState.getNode(node.id)).toBeNull();
  });

  it('should allow setting parent and child IDs programmatically', () => {
    const folder1 = root.createChild({ name: 'folder1', isDirectory: true });
    const folder2 = root.createChild({ name: 'folder2', isDirectory: true });
    const file = root.createChild({ name: 'file.md', isDirectory: false });

    // Programmatically update relationships
    file.parentId = folder1.id;
    folder1.childIds.push(file.id);

    expect(file.parentId).toBe(folder1.id);
    expect(folder1.childIds).toContain(file.id);
  });
});
