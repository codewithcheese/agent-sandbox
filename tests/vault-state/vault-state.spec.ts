/**
 * Phase 1 Tests: VaultState class structure and basic instantiation
 *
 * These tests verify that VaultState can be created with the correct structure.
 * Full method implementation tests will be in Phase 2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VaultState } from '../../src/chat/vault-state';

describe('VaultState (Phase 1: Structure)', () => {
  let trackingState: VaultState;
  let proposedState: VaultState;

  beforeEach(() => {
    trackingState = new VaultState('tracking');
    proposedState = new VaultState('proposed');
  });

  describe('Initialization', () => {
    it('should create tracking instance', () => {
      expect(trackingState).toBeDefined();
    });

    it('should create proposed instance', () => {
      expect(proposedState).toBeDefined();
    });

    it('should have independent operations logs', () => {
      expect(trackingState.getLogLength()).toBe(0);
      expect(proposedState.getLogLength()).toBe(0);
    });
  });

  describe('Root node', () => {
    it('should have root node after creation', () => {
      const root = trackingState.getNode('root');
      expect(root).toBeDefined();
    });

    it('root should have correct initial properties', () => {
      const root = trackingState.getNode('root');
      expect(root?.id).toBeDefined();
      expect(root?.parentId).toBeNull();
      expect(root?.data.name).toBe('');
      expect(root?.data.isDirectory).toBe(true);
    });

    it('root should have infrastructure folders as children', () => {
      const root = trackingState.getNode('root');
      // Root has two infrastructure folders with auto-generated IDs
      expect(root?.childIds).toHaveLength(2);
      const childNames = root?.childIds.map(id => trackingState.getNode(id)?.data.name).sort();
      expect(childNames).toEqual(['.overlay-tmp', '.overlay-trash']);
    });
  });

  describe('Query methods', () => {
    it('should have getNode method', () => {
      expect(typeof trackingState.getNode).toBe('function');
    });

    it('should have findByPath method', () => {
      expect(typeof trackingState.findByPath).toBe('function');
    });

    it('should have getNodePath method', () => {
      expect(typeof trackingState.getNodePath).toBe('function');
    });

    it('should have getDescendants method', () => {
      expect(typeof trackingState.getDescendants).toBe('function');
    });

    it('getNode should return null for non-existent node', () => {
      expect(trackingState.getNode('non-existent')).toBeNull();
    });

    it('findByPath should return root for empty path', () => {
      expect(trackingState.findByPath('')).toBe(trackingState.getNode('root'));
    });

    it('getNodePath should return empty string for root', () => {
      expect(trackingState.getNodePath('root')).toBe('');
    });

    it('getDescendants should return infrastructure folders for root', () => {
      // Root has two infrastructure folders that are always present
      const descendants = trackingState.getDescendants('root');
      expect(descendants).toHaveLength(2);
      expect(descendants.map(d => d.id)).toContain('trash-folder');
      expect(descendants.map(d => d.id)).toContain('tmp-folder');
    });
  });

  describe('Node mutation methods', () => {
    it('node.modify modifies node and records operation', () => {
      const root = trackingState.getNode('root')!;
      const node = root.createChild('node-1', {
        name: 'test.md',
        isDirectory: false
      });
      node.modify({ text: 'new content' });
      expect(node.data.text).toBe('new content');
      expect(trackingState.getLogLength()).toBe(2);
    });

    it('node.move moves node between parents', () => {
      const root = trackingState.getNode('root')!;
      const parent1 = root.createChild('parent1', {
        name: 'folder1',
        isDirectory: true
      });
      const parent2 = root.createChild('parent2', {
        name: 'folder2',
        isDirectory: true
      });
      const node = parent1.createChild('node-1', {
        name: 'file.md',
        isDirectory: false
      });
      node.move(parent2);
      expect(node.parentId).toBe('parent2');
      expect(trackingState.getLogLength()).toBe(4);
    });

    it('node.rename changes node name', () => {
      const root = trackingState.getNode('root')!;
      const node = root.createChild('node-1', {
        name: 'test.md',
        isDirectory: false
      });
      node.rename('renamed.md');
      expect(node.data.name).toBe('renamed.md');
      expect(trackingState.getLogLength()).toBe(2);
    });

    it('node.delete removes node and records operation', () => {
      const root = trackingState.getNode('root')!;
      const node = root.createChild('node-1', {
        name: 'test.md',
        isDirectory: false
      });
      node.delete();
      expect(trackingState.getNode('node-1')).toBeNull();
      expect(trackingState.getLogLength()).toBe(2);
    });
  });

  describe('Checkpoint and rollback', () => {
    it('should have checkpoint method', () => {
      expect(typeof trackingState.checkpoint).toBe('function');
    });

    it('should have rollback method', () => {
      expect(typeof trackingState.rollback).toBe('function');
    });

    it('checkpoint returns current log length', () => {
      const root = trackingState.getNode('root')!;
      root.createChild('node-1', { name: 'test.md', isDirectory: false });
      const checkpoint = trackingState.checkpoint();
      expect(checkpoint).toBe(1);

      root.createChild('node-2', { name: 'test2.md', isDirectory: false });
      expect(trackingState.checkpoint()).toBe(2);
    });

    it('rollback truncates log and rebuilds tree', () => {
      const root = trackingState.getNode('root')!;
      const node1 = root.createChild('node-1', { name: 'test.md', isDirectory: false });
      const checkpoint = trackingState.checkpoint();

      const node2 = root.createChild('node-2', { name: 'test2.md', isDirectory: false });
      expect(trackingState.getLogLength()).toBe(2);

      trackingState.rollback(checkpoint);
      expect(trackingState.getLogLength()).toBe(1);
      expect(trackingState.getNode('node-2')).toBeNull();
      expect(trackingState.getNode('node-1')).toBeDefined();
    });
  });

  describe('Operations log', () => {
    it('should have getOperations method', () => {
      expect(typeof trackingState.getOperations).toBe('function');
    });

    it('should have getOperationsForNode method', () => {
      expect(typeof trackingState.getOperationsForNode).toBe('function');
    });

    it('should have getLogLength method', () => {
      expect(typeof trackingState.getLogLength).toBe('function');
    });

    it('getLogLength should return 0 initially', () => {
      expect(trackingState.getLogLength()).toBe(0);
    });

    it('getOperations returns all operations', () => {
      const root = trackingState.getNode('root')!;
      const node1 = root.createChild('node-1', {
        name: 'test.md',
        isDirectory: false
      });
      node1.modify({ text: 'content' });

      const ops = trackingState.getOperations();
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('create');
      expect(ops[1].type).toBe('modify');
    });

    it('getOperationsForNode returns operations for specific node', () => {
      const root = trackingState.getNode('root')!;
      const node1 = root.createChild('node-1', {
        name: 'test.md',
        isDirectory: false
      });
      node1.modify({ text: 'content' });
      const node2 = root.createChild('node-2', {
        name: 'test2.md',
        isDirectory: false
      });

      const opsForNode1 = trackingState.getOperationsForNode('node-1');
      expect(opsForNode1).toHaveLength(2);
      expect(opsForNode1[0].type).toBe('create');
      expect(opsForNode1[1].type).toBe('modify');

      const opsForNode2 = trackingState.getOperationsForNode('node-2');
      expect(opsForNode2).toHaveLength(1);
      expect(opsForNode2[0].type).toBe('create');
    });
  });

  describe('Persistence', () => {
    it('should have serialize method', () => {
      expect(typeof trackingState.serialize).toBe('function');
    });

    it('serialize should throw (Phase 6 not yet implemented)', () => {
      expect(() => trackingState.serialize()).toThrow();
    });

    it('should have deserialize static method', () => {
      expect(typeof VaultState.deserialize).toBe('function');
    });

    it('deserialize should throw (Phase 6 not yet implemented)', () => {
      expect(() => VaultState.deserialize({ operationsLog: [] })).toThrow();
    });
  });

  describe('Independent state', () => {
    it('tracking and proposed should be independent', () => {
      expect(trackingState.getLogLength()).toBe(0);
      expect(proposedState.getLogLength()).toBe(0);

      // Both start with only root
      expect(trackingState.getNode('root')).toBeDefined();
      expect(proposedState.getNode('root')).toBeDefined();
    });
  });
});
