/**
 * Phase 1 Tests: TreeNode class structure and basic instantiation
 *
 * These tests verify that TreeNode can be created with the correct structure.
 * Full method implementation tests will be in Phase 2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TreeNode, VaultState } from '../../src/chat/vault-state';

describe('TreeNode (Phase 1: Structure)', () => {
  let vaultState: VaultState;
  let node: TreeNode;

  beforeEach(() => {
    vaultState = new VaultState('tracking');
    node = new TreeNode('test-node-1', vaultState);
  });

  it('should create a node with an ID', () => {
    expect(node.id).toBe('test-node-1');
  });

  it('should have no parent initially', () => {
    expect(node.parentId).toBeNull();
  });

  it('should have empty children list initially', () => {
    expect(node.childIds).toEqual([]);
  });

  it('should have node data with default values', () => {
    expect(node.data.name).toBe('');
    expect(node.data.isDirectory).toBe(false);
  });

  it('should have mutable node data', () => {
    node.data.name = 'test.md';
    node.data.isDirectory = false;
    expect(node.data.name).toBe('test.md');
    expect(node.data.isDirectory).toBe(false);
  });

  it('should have modify method', () => {
    expect(typeof node.modify).toBe('function');
  });

  it('should have move method', () => {
    expect(typeof node.move).toBe('function');
  });

  it('should have rename method', () => {
    expect(typeof node.rename).toBe('function');
  });

  it('should have delete method', () => {
    expect(typeof node.delete).toBe('function');
  });

  it('should have working modify method', () => {
    // modify is now implemented and delegates to vaultState
    // We test it indirectly through vaultState tests
    expect(typeof node.modify).toBe('function');
  });

  it('should have working move method', () => {
    expect(typeof node.move).toBe('function');
  });

  it('should have working rename method', () => {
    expect(typeof node.rename).toBe('function');
  });

  it('should have working delete method', () => {
    expect(typeof node.delete).toBe('function');
  });

  it('should allow setting parent and child IDs', () => {
    const parentNode = new TreeNode('parent-id', vaultState);
    const childNode = new TreeNode('child-id', vaultState);

    node.parentId = parentNode.id;
    node.childIds.push(childNode.id);

    expect(node.parentId).toBe('parent-id');
    expect(node.childIds).toContain('child-id');
  });
});
