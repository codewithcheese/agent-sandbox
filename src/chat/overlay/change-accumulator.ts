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
      const filteredChanges = changes.filter(change => change.messageId !== messageId);
      
      if (filteredChanges.length === 0) {
        // If no changes remain, remove the path entry
        this.changesByPath.delete(path);
      } else {
        // Attempt to repair the sequence
        const repairedChanges = this.repairChangeSequence(filteredChanges);
        
        if (repairedChanges.length === 0) {
          // If repair failed completely, remove the path
          this.changesByPath.delete(path);
        } else {
          // Update with the repaired changes
          this.changesByPath.set(path, repairedChanges);
        }
      }
    }
  }
  
  /**
   * Repairs a sequence of changes after some changes have been removed.
   * Ensures that each change's 'before' state matches the previous change's 'after' state.
   */
  private repairChangeSequence(changes: TrackedChange[]): TrackedChange[] {
    if (changes.length <= 1) return changes; // No repair needed for 0 or 1 change
    
    const repairedChanges: TrackedChange[] = [];
    let currentContent: string | undefined;
    
    // First change establishes the baseline
    const firstChange = changes[0];
    repairedChanges.push(firstChange);
    
    // Set the current content based on the first change
    if (firstChange.kind === ChangeKind.CREATE) {
      currentContent = firstChange.after;
    } else if (firstChange.kind === ChangeKind.MODIFY) {
      currentContent = firstChange.after;
    } else if (firstChange.kind === ChangeKind.DELETE) {
      currentContent = undefined;
    }
    
    // Process subsequent changes
    for (let i = 1; i < changes.length; i++) {
      const change = changes[i];
      
      // Handle each change type
      if (change.kind === ChangeKind.MODIFY) {
        repairedChanges.push(this.repairModifyChange(change, currentContent));
        // Update current content if the change was applied
        if (repairedChanges[repairedChanges.length - 1]) {
          currentContent = (repairedChanges[repairedChanges.length - 1] as ModifyChange).after;
        }
      } else if (change.kind === ChangeKind.DELETE) {
        if (currentContent === undefined) {
          // Already deleted, skip
          continue;
        }
        
        // For DELETE, we don't care as much about the exact before content
        // Just update it to match current and add to sequence
        const repairedChange: DeleteChange = {
          ...change,
          before: currentContent
        };
        repairedChanges.push(repairedChange);
        currentContent = undefined;
      } else if (change.kind === ChangeKind.CREATE) {
        if (currentContent !== undefined) {
          // Can't create what already exists - convert to MODIFY
          const repairedChange: ModifyChange = {
            ...change,
            kind: ChangeKind.MODIFY,
            before: currentContent
          };
          repairedChanges.push(repairedChange);
        } else {
          // Valid CREATE
          repairedChanges.push(change);
        }
        currentContent = change.after;
      } else if (change.kind === ChangeKind.RENAME) {
        // RENAME doesn't affect content, just add it
        repairedChanges.push(change);
      }
    }
    
    // Filter out any null values (changes that couldn't be repaired)
    return repairedChanges.filter(Boolean) as TrackedChange[];
  }
  
  /**
   * Repairs a MODIFY change by attempting to apply its changes to the current content.
   * Returns the repaired change or null if repair was not possible.
   */
  private repairModifyChange(change: ModifyChange, currentContent: string | undefined): ModifyChange | null {
    if (currentContent === undefined) {
      // Can't modify what doesn't exist
      return null;
    }
    
    if (change.before === currentContent) {
      // Perfect match, no repair needed
      return change;
    }
    
    // Mismatch - try to patch
    const patchResult = this.applyPatch(change.before, change.after, currentContent);
    if (patchResult.success) {
      // Create a new modified change with corrected before value
      return {
        ...change,
        before: currentContent,
        after: patchResult.result
      };
    }
    
    // Patch failed
    return null;
  }
  
  /**
   * Attempts to apply the changes between 'before' and 'after' onto 'current'
   * using the diff-match-patch algorithm.
   */
  private applyPatch(before: string, after: string, current: string): { success: boolean; result?: string } {
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

  private applyNextIndividualChange(
    currentComposite: CompositeChange | null,
    nextChange: TrackedChange,
  ): CompositeChange | null {
    const { id, timestamp, description } = nextChange;

    if (!currentComposite) {
      // This is the first change in the sequence for this path
      if (nextChange.kind === ChangeKind.CREATE) {
        return {
          id,
          timestamp,
          description,
          kind: ChangeKind.CREATE,
          path: nextChange.path,
          after: nextChange.after,
          before: undefined,
        };
      }
      if (nextChange.kind === ChangeKind.MODIFY) {
        return {
          id,
          timestamp,
          description,
          kind: ChangeKind.MODIFY,
          path: nextChange.path,
          before: nextChange.before,
          after: nextChange.after,
        };
      }
      if (nextChange.kind === ChangeKind.DELETE) {
        return {
          id,
          timestamp,
          description,
          kind: ChangeKind.DELETE,
          path: nextChange.path,
          before: nextChange.before,
          after: undefined,
        };
      }
      // A RENAME as the very first operation is unusual for content.
      // It implies renaming a file not yet in the accumulator's content tracking.
      // The `add` logic handles path keying. For composite calculation,
      // a lone RENAME doesn't produce a C/M/D composite.
      return null;
    }

    // --- Apply nextChange to currentComposite ---

    if (nextChange.kind === ChangeKind.RENAME) {
      return {
        ...currentComposite, // Preserve kind, before, after from content state
        id,
        timestamp,
        description,
        path: nextChange.path, // New path
        renamedFrom: nextChange.oldPath, // Mark where it was renamed from
      };
    }

    // If paths don't match and it's not a rename, something is inconsistent.
    // For simplicity, we assume `nextChange.path` is the relevant one if it's a content op.
    // This can happen if a RENAME was discarded, and a subsequent MODIFY op still has the old (renamed) path.
    const effectivePath = nextChange.path;

    if (currentComposite.kind === ChangeKind.CREATE) {
      if (nextChange.kind === ChangeKind.DELETE) return null; // Create -> Delete
      if (nextChange.kind === ChangeKind.MODIFY) {
        // Create -> Modify
        return {
          ...currentComposite,
          id,
          timestamp,
          description,
          path: effectivePath,
          after: (nextChange as ModifyChange).after,
        };
      }
    }

    if (currentComposite.kind === ChangeKind.MODIFY) {
      if (nextChange.kind === ChangeKind.DELETE) {
        // Modify -> Delete
        return {
          ...currentComposite,
          id,
          timestamp,
          description,
          path: effectivePath,
          kind: ChangeKind.DELETE,
          after: undefined,
        };
      }
      if (nextChange.kind === ChangeKind.MODIFY) {
        // Modify -> Modify
        return {
          ...currentComposite,
          id,
          timestamp,
          description,
          path: effectivePath,
          after: (nextChange as ModifyChange).after,
        };
      }
    }

    if (currentComposite.kind === ChangeKind.DELETE) {
      if (nextChange.kind === ChangeKind.CREATE) {
        // Delete -> Create
        return {
          ...currentComposite, // Keeps original 'before'
          id,
          timestamp,
          description,
          path: effectivePath,
          kind: ChangeKind.MODIFY,
          after: (nextChange as CreateChange).after,
        };
      }
      // Delete -> Modify or Delete -> Delete are less logical but keep it deleted.
      return {
        ...currentComposite,
        id,
        timestamp,
        description,
        path: effectivePath,
      };
    }

    // Fallback or unhandled sequence (should ideally not be reached with valid ops)
    // If currentComposite exists, and nextChange is CREATE/MODIFY/DELETE,
    // it should have been handled by the specific cases above.
    // This might indicate an unexpected sequence, e.g. CREATE following CREATE.
    // For robustness, we can try to apply metadata and after state.
    return {
      ...currentComposite,
      id,
      timestamp,
      description,
      path: effectivePath,
      after: (nextChange as ModifyChange | CreateChange).after, // if applicable
    };
  }
}
