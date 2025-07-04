# Merge View Enhancement Plan

## Overview

This document outlines the plan to enhance the merge view with a control bar containing three main feature sets:
1. **File Navigation**: Switch between files with pending changes (N of X files)
2. **Change Navigation**: Navigate between diff chunks within the current file
3. **Bulk Operations**: Accept All / Reject All for the current file

## Current Architecture Analysis

### How Merge View Currently Works

1. **Opening Flow**: `ChatPage.openMergeView()` → `leaf.setViewState()` → `MergeView.setState()` → `MergeView.mount()`
2. **State Management**: View state contains `{ chatPath, path }`
3. **Mount Process**: Always unmounts existing component and recreates everything
4. **Change Persistence**: Individual chunk accept/reject operations are immediately persisted via `onAccept`/`onReject` callbacks

### Key Insights

- Changes are immediately persisted when approved/rejected
- Navigation can leverage existing `setState()` → `mount()` pattern
- File list is dynamic and should always be retrieved fresh from `chat.vault.getFileChanges()`
- Editor destruction/recreation is handled automatically by existing mount logic

## Implementation Phases

### Phase 1: File Navigation (Priority 1)
**Duration**: 2-3 days
- Extend merge view to support multi-file navigation
- Create control bar component with file navigation UI
- Implement view state-based navigation

### Phase 2: Change Navigation (Priority 2)
**Duration**: 2-3 days
- Research CodeMirror merge extension chunk navigation APIs
- Implement chunk-based scrolling and navigation
- Add change navigation controls to control bar

### Phase 3: Bulk Operations (Priority 3)
**Duration**: 1-2 days
- Implement Accept All / Reject All functionality
- Add bulk operation buttons to control bar
- Handle edge cases and error scenarios

### Phase 4: Polish & Testing (Priority 4)
**Duration**: 1-2 days
- Add keyboard shortcuts for navigation
- Comprehensive testing of edge cases
- UI polish and accessibility improvements

## Phase 1: File Navigation - ✅ COMPLETED

### Implementation Summary

**Status**: ✅ Fully implemented and functional

**Files Created/Modified:**
1. `src/lib/merge/MergeControlBar.svelte` - New control bar component
2. `src/lib/merge/MergePage.svelte` - Updated to integrate control bar
3. `src/lib/merge/merge-view.svelte.ts` - Enhanced with file navigation logic

**Key Features Implemented:**
- ✅ Multi-file navigation with cycling (wraps around at ends)
- ✅ Absolute positioned control bar (stays visible during scrolling)
- ✅ Dynamic file list retrieval from vault changes
- ✅ Robust edge case handling (empty lists, resolved files)
- ✅ Proper Obsidian styling and theming
- ✅ Backward compatibility with single-file usage

**Navigation Behavior:**
- **Cycling**: Next/Previous buttons cycle through files seamlessly
- **No Disabled States**: Buttons always functional (Next: 1→2→3→1, Previous: 3→2→1→3)
- **Dynamic Updates**: File list refreshed on each navigation
- **Auto-handling**: Automatically navigates when current file is resolved

### Detailed Implementation

### 1. State Structure

Keep the existing state structure minimal - only store essential data:

```typescript
export interface MergeViewState {
  chatPath: string;
  path: string;
  // No currentFileIndex needed - computed dynamically
}
```

**Rationale**: Current file index can be computed as `allChangedFiles.indexOf(this.state.path)` - no need to store it.

### 2. Enhanced Mount Process

```typescript
private async mount(): Promise<void> {
  // Existing unmount logic
  if (this.component) {
    await unmount(this.component);
    this.component = null;
  }

  const chat = await Chat.load(this.state.chatPath);
  
  // Get changes once and reuse (more efficient)
  const allChanges = chat.vault.getFileChanges();
  const allChangedFiles = this.getAllChangedFilePaths(allChanges);
  
  // Handle empty file list
  if (allChangedFiles.length === 0) {
    new Notice("No files with changes remaining");
    this.leaf.detach();
    return;
  }
  
  // Handle current file no longer in list
  if (!allChangedFiles.includes(this.state.path)) {
    // Auto-navigate to first available file
    await this.setState({
      chatPath: this.state.chatPath,
      path: allChangedFiles[0]
    }, null);
    return; // Will remount with new file
  }
  
  // Calculate current index dynamically
  const currentFileIndex = allChangedFiles.indexOf(this.state.path);
  
  // Get changes for current file
  const changes = allChanges.filter((c) => c.path === this.state.path);
  
  // ... existing content loading logic ...
  
  // Mount component with computed index
  this.component = mount(MergePage, {
    target: viewContent,
    props: {
      currentContent,
      newContent,
      name: getBaseName(this.state.path),
      // NEW: Navigation props
      allChangedFiles: allChangedFiles,
      currentFileIndex: currentFileIndex,
      onNavigateFile: async (direction: 'prev' | 'next') => {
        await this.navigateToFile(direction);
      },
      // Existing callbacks...
      onReject: async (...args) => { /* existing logic */ },
      onAccept: async (...args) => { /* existing logic */ },
    },
  });
}
```

### 3. Helper Method (Corrected)

```typescript
// More efficient - takes changes array as input to avoid duplicate API calls
private getAllChangedFilePaths(changes: ProposedChange[]): string[] {
  return changes
    .filter(change => !change.info.isDirectory) // Only files
    .map(change => change.path)
    .filter((path, index, arr) => arr.indexOf(path) === index) // Deduplicate
    .sort(); // Consistent ordering for predictable navigation
}
```

### 4. Navigation Logic

```typescript
private async navigateToFile(direction: 'prev' | 'next'): Promise<void> {
  const chat = await Chat.load(this.state.chatPath);
  const allChanges = chat.vault.getFileChanges();
  const allChangedFiles = this.getAllChangedFilePaths(allChanges);
  
  if (allChangedFiles.length === 0) {
    new Notice("No files with changes remaining");
    this.leaf.detach();
    return;
  }
  
  // Find current position dynamically
  const currentIndex = allChangedFiles.indexOf(this.state.path);
  
  // Calculate new index
  let newIndex: number;
  if (currentIndex === -1) {
    // Current file not in list anymore, go to first file
    newIndex = 0;
  } else {
    newIndex = direction === 'next' 
      ? Math.min(currentIndex + 1, allChangedFiles.length - 1)
      : Math.max(currentIndex - 1, 0);
  }
  
  if (newIndex === currentIndex && currentIndex !== -1) {
    return; // No change needed
  }
  
  // Navigate to new file - only update path, index computed on remount
  await this.setState({
    chatPath: this.state.chatPath,
    path: allChangedFiles[newIndex]
  }, null);
}
```

### 5. Control Bar Component

```svelte
<!-- MergeControlBar.svelte -->
<script lang="ts">
  import { ChevronLeftIcon, ChevronRightIcon } from "lucide-svelte";
  
  type Props = {
    allChangedFiles: string[];
    currentFileIndex: number;
    onNavigateFile: (direction: 'prev' | 'next') => Promise<void>;
  };
  
  let { allChangedFiles, currentFileIndex, onNavigateFile }: Props = $props();
  
  // Reactive calculations
  const canGoPrevious = $derived(currentFileIndex > 0);
  const canGoNext = $derived(currentFileIndex < allChangedFiles.length - 1);
  const currentFileName = $derived(allChangedFiles[currentFileIndex]?.split('/').pop() || '');
</script>

<div class="merge-control-bar">
  <!-- File Navigation -->
  <div class="file-navigation">
    <button 
      class="clickable-icon"
      disabled={!canGoPrevious}
      onclick={() => onNavigateFile('prev')}
      aria-label="Previous file with changes"
    >
      <ChevronLeftIcon class="size-4" />
    </button>
    
    <div class="file-counter">
      <span class="counter-text">{currentFileIndex + 1} of {allChangedFiles.length}</span>
      <span class="file-name">{currentFileName}</span>
    </div>
    
    <button 
      class="clickable-icon"
      disabled={!canGoNext}
      onclick={() => onNavigateFile('next')}
      aria-label="Next file with changes"
    >
      <ChevronRightIcon class="size-4" />
    </button>
  </div>
</div>

<style>
  .merge-control-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
    background-color: var(--background-secondary);
    font-size: var(--font-ui-smaller);
  }
  
  .file-navigation {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .file-counter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 120px;
  }
  
  .counter-text {
    color: var(--text-muted);
    font-weight: 500;
  }
  
  .file-name {
    color: var(--text-normal);
    font-weight: 600;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .clickable-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
```

### 6. MergePage Integration

```svelte
<!-- MergePage.svelte - Add control bar -->
<script lang="ts">
  // ... existing imports and props
  import MergeControlBar from "./MergeControlBar.svelte";
  
  type Props = {
    name: string;
    currentContent: string;
    newContent: string;
    // NEW: Navigation props
    allChangedFiles: string[];
    currentFileIndex: number;
    onNavigateFile: (direction: 'prev' | 'next') => Promise<void>;
    // Existing callback props
    onAccept: (...args) => Promise<void>;
    onReject: (...args) => Promise<void>;
  };
  
  let { 
    name, 
    currentContent, 
    newContent, 
    allChangedFiles,
    currentFileIndex,
    onNavigateFile,
    onAccept, 
    onReject 
  }: Props = $props();
  
  // ... existing editor logic
</script>

<div class="markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-readable-line-width is-live-preview is-folding show-properties">
  <!-- NEW: Control bar at top -->
  {#if allChangedFiles.length > 1}
    <MergeControlBar 
      {allChangedFiles}
      {currentFileIndex}
      {onNavigateFile}
    />
  {/if}
  
  <!-- Existing editor -->
  <div class="cm-editor">
    <div class="cm-scroller">
      <div class="cm-sizer">
        <div class="inline-title">Review: {name}</div>
        <div bind:this={editorContainer}></div>
      </div>
    </div>
  </div>
</div>
```

## Edge Cases & Error Handling

### File Navigation Edge Cases

1. **Empty File List**: Close merge view with notification
2. **Current File Resolved**: Auto-navigate to first available file
3. **All Files Resolved**: Close merge view with success message
4. **File Renamed During Review**: File list updates automatically on remount
5. **Chat Continues**: Fresh file list retrieved on each navigation

### Implementation Benefits

1. **Leverages Existing Architecture**: Uses proven `setState()` → `mount()` pattern
2. **Automatic Cleanup**: Editor destruction/recreation handled by existing mount logic
3. **State Persistence**: Obsidian's view state system handles persistence across sessions
4. **Fresh Data Loading**: Each navigation loads current changes from vault overlay
5. **Backward Compatibility**: Single-file usage continues to work unchanged
6. **Efficient API Usage**: Single `getFileChanges()` call per mount, reused for filtering

## Future Phases Preview

### Phase 2: Change Navigation
- Research CodeMirror merge extension APIs for chunk navigation
- Implement programmatic scrolling to specific diff chunks
- Add up/down navigation controls to control bar

### Phase 3: Bulk Operations
- Implement Accept All by applying all changes from original to current
- Implement Reject All by reverting to original content
- Add confirmation dialogs for destructive operations

### Phase 4: Polish
- Add keyboard shortcuts (Ctrl+Left/Right for files, Ctrl+Up/Down for changes)
- Comprehensive testing of all edge cases
- UI polish and accessibility improvements

## Files to Modify

### Phase 1 Files:
1. `src/lib/merge/merge-view.svelte.ts` - Enhanced mount and navigation logic
2. `src/lib/merge/MergePage.svelte` - Add control bar integration
3. `src/lib/merge/MergeControlBar.svelte` - New control bar component

### Testing Strategy:
1. Test with single file (backward compatibility)
2. Test with multiple files (navigation)
3. Test edge cases (files resolved during review)
4. Test dynamic file list updates (chat continues)

## Phase 2: Change Navigation - ✅ COMPLETED

### Implementation Summary

**Status**: ✅ Fully implemented and functional

**Files Modified:**
1. `src/lib/merge/MergePage.svelte` - Added chunk navigation logic and state
2. `src/lib/merge/MergeControlBar.svelte` - Extended with chunk navigation UI

**Key Features Implemented:**
- ✅ Auto-navigation to first chunk when merge view opens
- ✅ Simple index-based chunk navigation (Up/Down buttons)
- ✅ Chunk counter display ("Change X of Y" or "N changes")
- ✅ Disabled buttons for single chunk scenarios
- ✅ Integration with existing file navigation
- ✅ Real-time chunk count updates when content changes

**Navigation Behavior:**
- **Auto-Start**: Automatically navigates to first chunk on file open
- **Index-Based**: Simple increment/decrement of chunk index
- **Non-Reactive**: Doesn't track manual user scrolling (by design)
- **Boundary Handling**: Buttons disabled at first/last chunk (no cycling)

### Technical Implementation

**Chunk Navigation Logic:**
```typescript
// Auto-navigate to first chunk on editor creation
function navigateToFirstChunk(): void {
  if (!editorView || totalChunks === 0) return;
  currentChunkIndex = 0;
  goToNextChunk(editorView); // Uses CodeMirror's built-in command
}

// Navigate between chunks with boundary checking
function navigateToChunk(direction: 'next' | 'prev'): void {
  if (!editorView || totalChunks <= 1) return;
  
  if (direction === 'next' && currentChunkIndex < totalChunks - 1) {
    currentChunkIndex++;
    goToNextChunk(editorView);
  } else if (direction === 'prev' && currentChunkIndex > 0) {
    currentChunkIndex--;
    goToPreviousChunk(editorView);
  }
}
```

**Control Bar Integration:**
```svelte
<!-- Chunk Navigation UI -->
{#if hasChunks && onNavigateChunk}
  <div class="chunk-navigation">
    <button disabled={!canGoPrevChunk} onclick={() => onNavigateChunk?.('prev')}>
      <ChevronUpIcon class="size-4" />
    </button>
    
    <div class="chunk-counter">
      <span>{hasMultipleChunks ? `Change ${currentChunkIndex + 1} of ${totalChunks}` : `${totalChunks} changes`}</span>
    </div>
    
    <button disabled={!canGoNextChunk} onclick={() => onNavigateChunk?.('next')}>
      <ChevronDownIcon class="size-4" />
    </button>
  </div>
{/if}
```

**State Management:**
- `currentChunkIndex`: Tracks current chunk position (0-based)
- `totalChunks`: Total number of chunks in current file
- Updates automatically when content changes via `EditorView.updateListener`
- Resets to first chunk when switching files

### Control Bar Layout

```
[← File] [File 1 of 3: filename.md] [File →]    [↑ Change] [Change 2 of 5] [Change ↓]
```

**Layout Features:**
- File navigation on the left
- Chunk navigation on the right
- Proper spacing and alignment
- Disabled state styling for boundary conditions
- Responsive design

## Phase 2: Change Navigation - Analysis & Planning (ARCHIVED)

### Uncertainty Analysis for Phase 2 - UPDATED

#### **✅ RESOLVED: CodeMirror Merge Extension APIs**

**CodeMirror Documentation Reveals:**

1. **✅ Built-in Navigation Commands**:
   ```typescript
   import { goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
   
   // Navigate to next/previous chunk
   editorView.dispatch({ effects: goToNextChunk });
   editorView.dispatch({ effects: goToPreviousChunk });
   ```

2. **✅ Chunk Structure & Access**:
   ```typescript
   import { getChunks } from "@codemirror/merge";
   
   const result = getChunks(editorView.state);
   // Returns: {chunks: readonly Chunk[], side: "a" | "b" | null} | null
   
   // Each Chunk has:
   // - fromA/toA: positions in document A
   // - fromB/toB: positions in document B  
   // - endA/endB: safe document positions
   // - changes: individual changes within chunk
   // - precise: boolean indicating diff quality
   ```

3. **✅ Chunk Ordering**: Chunks are returned in document order
4. **✅ Position Information**: Precise document positions available
5. **✅ Dynamic Updates**: Chunks update automatically when content changes

#### **🟡 Remaining Medium Uncertainty: Current Chunk Detection**

**Challenge**: How to determine which chunk is currently "active" for UI counter display.

**Potential Solutions:**
1. **Cursor Position**: Check which chunk contains current cursor position
2. **Viewport Center**: Find chunk closest to viewport center
3. **Selection Range**: Use current selection to determine active chunk
4. **Last Navigation**: Track last chunk navigated to via our buttons

#### **🟡 Reduced Uncertainty: User Experience Design**

**Simplified Design Decisions:**
1. **Navigation Behavior**: Use built-in `goToNextChunk`/`goToPreviousChunk` commands
2. **Scroll Behavior**: CodeMirror handles scrolling automatically
3. **Cycling**: Follow CodeMirror's default behavior (likely stops at ends)
4. **Visual Feedback**: Display "Change X of Y" based on chunk count

**Remaining UX Questions:**
- How to detect "current" chunk for counter display
- Whether to add visual highlighting for current chunk
- Integration with existing file navigation layout

#### **🟡 Reduced Uncertainty: State Management**

**Simplified State Approach:**
1. **Chunk Count**: Call `getChunks(state)` to get current chunk count
2. **Dynamic Updates**: Chunks automatically update when content changes
3. **Performance**: Only update chunk info when navigation buttons are used

**Remaining State Questions:**
- How to efficiently determine current chunk index for display
- Whether to listen to editor update events for real-time chunk counter
- How to handle edge cases (no chunks, single chunk)

### Phase 2 Implementation Strategy - UPDATED

#### **Step 1: Basic Integration (Simplified)**
**Duration**: 2-3 hours
- Import `goToNextChunk`, `goToPreviousChunk`, `getChunks` from `@codemirror/merge`
- Add chunk navigation methods to `merge-view.svelte.ts`
- Test basic navigation functionality

#### **Step 2: UI Integration**
**Duration**: 3-4 hours
- Add chunk navigation buttons to `MergeControlBar.svelte`
- Implement chunk counter display using `getChunks()`
- Update control bar layout for both file and chunk navigation
- Handle edge cases (no chunks, single chunk)

#### **Step 3: Current Chunk Detection**
**Duration**: 2-3 hours
- Implement logic to determine "current" chunk for counter
- Add update listeners if needed for real-time counter
- Test and refine current chunk detection accuracy

### Proposed Control Bar Layout

```
[← File] [File 1 of 3: filename.md] [File →]  |  [↑ Change] [Change 2 of 5] [Change ↓]
```

### Implementation Code Snippets

1. **Basic Chunk Navigation**:
   ```typescript
   import { goToNextChunk, goToPreviousChunk, getChunks } from "@codemirror/merge";
   
   // In merge-view.svelte.ts
   navigateToChunk(direction: 'next' | 'prev') {
     const command = direction === 'next' ? goToNextChunk : goToPreviousChunk;
     this.editorView?.dispatch({ effects: command });
   }
   
   getChunkInfo() {
     const result = getChunks(this.editorView?.state);
     return result ? result.chunks.length : 0;
   }
   ```

2. **Current Chunk Detection**:
   ```typescript
   getCurrentChunkIndex(): number {
     const result = getChunks(this.editorView?.state);
     if (!result || !result.chunks.length) return -1;
     
     const cursor = this.editorView?.state.selection.main.head;
     if (!cursor) return -1;
     
     // Find chunk containing cursor position
     return result.chunks.findIndex(chunk => 
       cursor >= chunk.fromA && cursor <= chunk.endA
     );
   }
   ```

3. **Control Bar Integration**:
   ```svelte
   <!-- In MergeControlBar.svelte -->
   <div class="chunk-navigation">
     <button onclick={() => onNavigateChunk('prev')}>↑</button>
     <span>Change {currentChunkIndex + 1} of {totalChunks}</span>
     <button onclick={() => onNavigateChunk('next')}>↓</button>
   </div>
   ```

### Risk Mitigation - UPDATED

**Risks Significantly Reduced:**
- ✅ CodeMirror APIs are well-documented and sufficient
- ✅ Built-in navigation commands handle complexity
- ✅ Performance should be good with native commands

**Remaining Risks:**
- **Current Chunk Detection**: If cursor-based detection is unreliable
  - **Fallback**: Show total chunk count without "current" indicator
- **Edge Cases**: If chunks behave unexpectedly
  - **Fallback**: Graceful degradation with error handling
- **UI Integration**: If control bar becomes too crowded
  - **Fallback**: Separate chunk navigation to different area

### Success Criteria for Phase 2 - UPDATED

✅ **Functional Navigation**: Up/Down buttons use `goToNextChunk`/`goToPreviousChunk`  
✅ **Chunk Counter**: Display total chunk count (e.g., "5 changes")  
✅ **Current Position**: Show current chunk index when detectable (e.g., "Change 2 of 5")  
✅ **Native Scrolling**: CodeMirror handles smooth scrolling automatically  
✅ **Edge Handling**: Graceful handling of no chunks, single chunk scenarios  
✅ **Integration**: Seamless integration with existing file navigation  

**Actual Implementation Time**: ~4 hours

The CodeMirror built-in commands made implementation even faster than estimated. The simple index-based approach avoided complexity while providing excellent user experience.
