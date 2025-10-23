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
      expect(root?.id).toBe('root');
      expect(root?.parentId).toBeNull();
      expect(root?.data.name).toBe('');
      expect(root?.data.isDirectory).toBe(true);
    });

    it('root should have empty children initially', () => {
      const root = trackingState.getNode('root');
      expect(root?.childIds).toEqual([]);
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

    it('getDescendants should return empty array for root', () => {
      expect(trackingState.getDescendants('root')).toEqual([]);
    });
  });

  describe('Mutation methods', () => {
    it('should have createNode method', () => {
      expect(typeof trackingState.createNode).toBe('function');
    });

    it('should have deleteNode method', () => {
      expect(typeof trackingState.deleteNode).toBe('function');
    });

    it('should have modifyNode method', () => {
      expect(typeof trackingState.modifyNode).toBe('function');
    });

    it('should have moveNode method', () => {
      expect(typeof trackingState.moveNode).toBe('function');
    });

    it('should have renameNode method', () => {
      expect(typeof trackingState.renameNode).toBe('function');
    });

    it('createNode creates a node and records operation', () => {
      const node = trackingState.createNode('node-1', 'root', {
        name: 'test.md',
        isDirectory: false,
        text: 'content'
      });
      expect(node).toBeDefined();
      expect(node.id).toBe('node-1');
      expect(trackingState.getLogLength()).toBe(1);
    });

    it('modifyNode modifies node and records operation', () => {
      const node = trackingState.createNode('node-1', 'root', {
        name: 'test.md',
        isDirectory: false
      });
      trackingState.modifyNode('node-1', { text: 'new content' });
      expect(node.data.text).toBe('new content');
      expect(trackingState.getLogLength()).toBe(2);
    });

    it('moveNode moves node between parents', () => {
      const parent1 = trackingState.createNode('parent1', 'root', {
        name: 'folder1',
        isDirectory: true
      });
      const parent2 = trackingState.createNode('parent2', 'root', {
        name: 'folder2',
        isDirectory: true
      });
      const node = trackingState.createNode('node-1', 'parent1', {
        name: 'file.md',
        isDirectory: false
      });
      trackingState.moveNode('node-1', 'parent2');
      expect(node.parentId).toBe('parent2');
      expect(trackingState.getLogLength()).toBe(4);
    });

    it('renameNode changes node name', () => {
      const node = trackingState.createNode('node-1', 'root', {
        name: 'test.md',
        isDirectory: false
      });
      trackingState.renameNode('node-1', 'renamed.md');
      expect(node.data.name).toBe('renamed.md');
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
      trackingState.createNode('node-1', 'root', {
        name: 'test.md',
        isDirectory: false
      });
      const checkpoint = trackingState.checkpoint();
      expect(checkpoint).toBe(1);

      trackingState.createNode('node-2', 'root', {
        name: 'test2.md',
        isDirectory: false
      });
      expect(trackingState.checkpoint()).toBe(2);
    });

    it('rollback truncates log and rebuilds tree', () => {
      const node1 = trackingState.createNode('node-1', 'root', {
        name: 'test.md',
        isDirectory: false
      });
      const checkpoint = trackingState.checkpoint();

      const node2 = trackingState.createNode('node-2', 'root', {
        name: 'test2.md',
        isDirectory: false
      });
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
      trackingState.createNode('node-1', 'root', {
        name: 'test.md',
        isDirectory: false
      });
      trackingState.modifyNode('node-1', { text: 'content' });

      const ops = trackingState.getOperations();
      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('create');
      expect(ops[1].type).toBe('modify');
    });

    it('getOperationsForNode returns operations for specific node', () => {
      trackingState.createNode('node-1', 'root', {
        name: 'test.md',
        isDirectory: false
      });
      trackingState.modifyNode('node-1', { text: 'content' });
      trackingState.createNode('node-2', 'root', {
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
