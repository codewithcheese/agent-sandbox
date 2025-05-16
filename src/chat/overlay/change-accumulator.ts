// import { nanoid } from "nanoid"; // If you use nanoid for ID generation internally
import {
  type TrackedChange,
  type CreateChange,
  type DeleteChange,
  type ModifyChange,
  type RenameChange,
  type CompositeChange,
  ChangeKind,
} from "./change";
import { diff_match_patch } from "diff-match-patch";

export class ChangeAccumulator {
  private changesByPath = new Map<string, TrackedChange[]>();

  public reset(): void {
    this.changesByPath.clear();
  }

  public add(change: TrackedChange): void {
    if (change.kind === ChangeKind.RENAME) {
      // Get existing changes for oldPath, or start fresh if none
      const changes = this.changesByPath.get(change.oldPath) || [];
      const newChanges = [...changes, change];
      if (this.changesByPath.has(change.oldPath)) {
        this.changesByPath.delete(change.oldPath); // Remove old path entry
      }
      this.changesByPath.set(change.path, newChanges); // Store list under new path
    } else {
      const changes = this.changesByPath.get(change.path) || [];
      changes.push(change);
      this.changesByPath.set(change.path, changes);
    }
  }

  public get(path: string): CompositeChange | null {
    const changes = this.changesByPath.get(path);
    if (!changes || changes.length === 0) {
      return null;
    }
    return this.calculateCompositeChange(changes);
  }

  public discard(messageId: string): void {
    // Get all paths in the accumulator
    const pathsToCheck = Array.from(this.changesByPath.keys());

    // For each path, filter out changes with the specified messageId
    for (const path of pathsToCheck) {
      const changes = this.changesByPath.get(path);
      if (!changes) continue;

      // Filter out changes with the specified messageId
      const filteredChanges = changes.filter(
        (change) => change.messageId !== messageId,
      );

      if (filteredChanges.length === 0) {
        // If no changes remain, remove the path entry
        this.changesByPath.delete(path);
      } else {
        // Update with the filtered changes
        this.changesByPath.set(path, filteredChanges);
      }
    }
  }

  public paths(): readonly string[] {
    return Array.from(this.changesByPath.keys()).filter((path) => {
      const changes = this.changesByPath.get(path);
      return changes && changes.length > 0;
    });
  }

  private calculateCompositeChange(
    changes: TrackedChange[],
  ): CompositeChange | null {
    if (!changes || changes.length === 0) return null;

    let composite: CompositeChange | null = null;

    for (const individualChange of changes) {
      composite = this.applyNextIndividualChange(composite, individualChange);
    }
    return composite;
  }

  // Rule lookup table for composite change transformations
  private ruleMap: Record<string, (composite: CompositeChange, change: TrackedChange) => CompositeChange | null> = {
    // CREATE -> X rules
    [this.getRuleKey(ChangeKind.CREATE, ChangeKind.DELETE)]: this.applyRule_CreateDelete.bind(this),
    [this.getRuleKey(ChangeKind.CREATE, ChangeKind.MODIFY)]: this.applyRule_CreateModify.bind(this),
    [this.getRuleKey(ChangeKind.CREATE, ChangeKind.CREATE)]: this.applyRule_CreateCreate.bind(this),
    
    // MODIFY -> X rules
    [this.getRuleKey(ChangeKind.MODIFY, ChangeKind.DELETE)]: this.applyRule_ModifyDelete.bind(this),
    [this.getRuleKey(ChangeKind.MODIFY, ChangeKind.MODIFY)]: this.applyRule_ModifyModify.bind(this),
    [this.getRuleKey(ChangeKind.MODIFY, ChangeKind.CREATE)]: this.applyRule_ModifyCreate.bind(this),
    
    // DELETE -> X rules
    [this.getRuleKey(ChangeKind.DELETE, ChangeKind.CREATE)]: this.applyRule_DeleteCreate.bind(this),
    [this.getRuleKey(ChangeKind.DELETE, ChangeKind.MODIFY)]: this.applyRule_DeleteModify.bind(this),
    [this.getRuleKey(ChangeKind.DELETE, ChangeKind.DELETE)]: this.applyRule_DeleteDelete.bind(this),
  };

  // Generate a unique key for rule lookup
  private getRuleKey(fromKind: ChangeKind, toKind: ChangeKind): string {
    return `${fromKind}->${toKind}`;
  }

  private applyNextIndividualChange(
    currentComposite: CompositeChange | null,
    nextChange: TrackedChange,
  ): CompositeChange | null {
    // Handle first change in a sequence
    if (!currentComposite) {
      return this.applyFirstChange(nextChange);
    }
  
    // Handle RENAME operations specially
    if (nextChange.kind === ChangeKind.RENAME) {
      return this.applyRenameToComposite(currentComposite, nextChange as RenameChange);
    }
  
    // Look up the appropriate rule based on current kind and next kind
    const ruleKey = this.getRuleKey(currentComposite.kind, nextChange.kind);
    const ruleHandler = this.ruleMap[ruleKey];
    
    if (ruleHandler) {
      return ruleHandler(currentComposite, nextChange);
    }
    
    // Fallback for unhandled cases
    return this.applyFallbackRule(currentComposite, nextChange);
  }
  
  // Handle first change in a sequence
  private applyFirstChange(change: TrackedChange): CompositeChange | null {
    const { id, timestamp, description } = change;
  
    if (change.kind === ChangeKind.CREATE) {
      return {
        id, timestamp, description,
        kind: ChangeKind.CREATE,
        path: change.path,
        after: (change as CreateChange).after,
        before: undefined,
      };
    }
    
    if (change.kind === ChangeKind.MODIFY) {
      return {
        id, timestamp, description,
        kind: ChangeKind.MODIFY,
        path: change.path,
        before: (change as ModifyChange).before,
        after: (change as ModifyChange).after,
      };
    }
    
    if (change.kind === ChangeKind.DELETE) {
      return {
        id, timestamp, description,
        kind: ChangeKind.DELETE,
        path: change.path,
        before: (change as DeleteChange).before,
        after: undefined,
      };
    }
    
    // A RENAME as the first operation doesn't produce a content composite
    return null;
  }
  
  // Apply RENAME to any composite
  private applyRenameToComposite(
    composite: CompositeChange, 
    rename: RenameChange
  ): CompositeChange {
    return {
      ...composite,
      id: rename.id,
      timestamp: rename.timestamp,
      description: rename.description,
      path: rename.path,
      renamedFrom: rename.oldPath,
    };
  }
  
  // CREATE -> DELETE = null (cancellation)
  private applyRule_CreateDelete(
    composite: CompositeChange, 
    deleteChange: DeleteChange
  ): CompositeChange | null {
    return null; // Create followed by Delete cancels out
  }
  
  // CREATE -> MODIFY = CREATE with updated after
  private applyRule_CreateModify(
    composite: CompositeChange, 
    modifyChange: ModifyChange
  ): CompositeChange {
    // Check if before content matches
    if (modifyChange.before !== composite.after) {
      // Try to patch
      const patchResult = this.applyPatch(modifyChange.before, modifyChange.after, composite.after as string);
      if (patchResult.success) {
        return {
          ...composite,
          id: modifyChange.id,
          timestamp: modifyChange.timestamp,
          description: modifyChange.description,
          path: modifyChange.path,
          after: patchResult.result,
        };
      } else {
        // Fallback if patching fails - force apply the after state
        return {
          ...composite,
          id: modifyChange.id,
          timestamp: modifyChange.timestamp,
          description: modifyChange.description,
          path: modifyChange.path,
          after: modifyChange.after,
        };
      }
    }
    
    // Normal case - before matches
    return {
      ...composite,
      id: modifyChange.id,
      timestamp: modifyChange.timestamp,
      description: modifyChange.description,
      path: modifyChange.path,
      after: modifyChange.after,
    };
  }
  
  // CREATE -> CREATE = CREATE with second content (unusual case)
  private applyRule_CreateCreate(
    composite: CompositeChange, 
    createChange: CreateChange
  ): CompositeChange {
    return {
      ...composite,
      id: createChange.id,
      timestamp: createChange.timestamp,
      description: createChange.description,
      path: createChange.path,
      after: createChange.after,
    };
  }
  
  // MODIFY -> DELETE = DELETE
  private applyRule_ModifyDelete(
    composite: CompositeChange, 
    deleteChange: DeleteChange
  ): CompositeChange {
    return {
      ...composite,
      id: deleteChange.id,
      timestamp: deleteChange.timestamp,
      description: deleteChange.description,
      path: deleteChange.path,
      kind: ChangeKind.DELETE,
      after: undefined,
    };
  }
  
  // MODIFY -> MODIFY = MODIFY with updated after
  private applyRule_ModifyModify(
    composite: CompositeChange, 
    modifyChange: ModifyChange
  ): CompositeChange {
    // Check if before content matches
    if (modifyChange.before !== composite.after) {
      // Try to patch
      const patchResult = this.applyPatch(modifyChange.before, modifyChange.after, composite.after as string);
      if (patchResult.success) {
        return {
          ...composite,
          id: modifyChange.id,
          timestamp: modifyChange.timestamp,
          description: modifyChange.description,
          path: modifyChange.path,
          after: patchResult.result,
        };
      } else {
        // Fallback if patching fails - force apply the after state
        return {
          ...composite,
          id: modifyChange.id,
          timestamp: modifyChange.timestamp,
          description: modifyChange.description,
          path: modifyChange.path,
          after: modifyChange.after,
        };
      }
    }
    
    // Normal case - before matches
    return {
      ...composite,
      id: modifyChange.id,
      timestamp: modifyChange.timestamp,
      description: modifyChange.description,
      path: modifyChange.path,
      after: modifyChange.after,
    };
  }
  
  // MODIFY -> CREATE = MODIFY with create's content (unusual case)
  private applyRule_ModifyCreate(
    composite: CompositeChange, 
    createChange: CreateChange
  ): CompositeChange {
    return {
      ...composite,
      id: createChange.id,
      timestamp: createChange.timestamp,
      description: createChange.description,
      path: createChange.path,
      after: createChange.after,
    };
  }
  
  // DELETE -> CREATE = MODIFY
  private applyRule_DeleteCreate(
    composite: CompositeChange, 
    createChange: CreateChange
  ): CompositeChange {
    return {
      ...composite,
      id: createChange.id,
      timestamp: createChange.timestamp,
      description: createChange.description,
      path: createChange.path,
      kind: ChangeKind.MODIFY,
      after: createChange.after,
    };
  }
  
  // DELETE -> MODIFY = DELETE (unusual case, keep deleted)
  private applyRule_DeleteModify(
    composite: CompositeChange, 
    modifyChange: ModifyChange
  ): CompositeChange {
    return {
      ...composite,
      id: modifyChange.id,
      timestamp: modifyChange.timestamp,
      description: modifyChange.description,
      path: modifyChange.path,
    };
  }
  
  // DELETE -> DELETE = DELETE (unusual case, keep deleted)
  private applyRule_DeleteDelete(
    composite: CompositeChange, 
    deleteChange: DeleteChange
  ): CompositeChange {
    return {
      ...composite,
      id: deleteChange.id,
      timestamp: deleteChange.timestamp,
      description: deleteChange.description,
      path: deleteChange.path,
    };
  }
  
  // Fallback for unhandled cases
  private applyFallbackRule(
    composite: CompositeChange, 
    change: TrackedChange
  ): CompositeChange {
    return {
      ...composite,
      id: change.id,
      timestamp: change.timestamp,
      description: change.description,
      path: change.path,
      after: 'after' in change ? change.after : composite.after,
    };
  }

  /**
   * Attempts to apply the changes between 'before' and 'after' onto 'current'
   * using the diff-match-patch algorithm.
   */
  private applyPatch(
    before: string,
    after: string,
    current: string,
  ): { success: boolean; result?: string } {
    // If the current content already matches the before state, just return the after state
    if (before === current) {
      return { success: true, result: after };
    }

    try {
      // Create a diff-match-patch instance
      const dmp = new diff_match_patch();

      // Create a patch from before to after
      const patches = dmp.patch_make(before, after);

      // Apply the patch to the current content
      const [patchedText, results] = dmp.patch_apply(patches, current);

      // Check if all patches were applied successfully
      const allSuccessful = results.every(Boolean);

      if (allSuccessful && patchedText !== current) {
        return { success: true, result: patchedText };
      }

      return { success: false };
    } catch (error) {
      // If any error occurs during patching, consider it a failure
      return { success: false };
    }
  }
}
