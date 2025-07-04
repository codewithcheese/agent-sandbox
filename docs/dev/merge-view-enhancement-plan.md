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

## Phase 2: Change Navigation - Analysis & Planning

### Uncertainty Analysis for Phase 2

#### **🔴 High Uncertainty: CodeMirror Merge Extension APIs**

**Primary Challenge**: Limited documentation on programmatic chunk navigation in CodeMirror 6 merge extension.

**Open Questions:**
1. **Chunk Position Detection**: How do we determine which chunk is currently visible/active in the viewport?
2. **Programmatic Scrolling**: Can we reliably scroll to specific chunks using line positions?
3. **Dynamic Chunk Updates**: How do chunks change when user accepts/rejects individual changes?
4. **Chunk Ordering**: Are chunks returned by `getChunks()` in document order?

**Research Needed:**
- Investigate `getChunks(state)` return structure and chunk properties
- Test `EditorView.dispatch()` with scroll actions to specific line positions
- Understand relationship between chunk `fromA/toA/fromB/toB` and document positions
- Explore CodeMirror's viewport and scroll APIs

#### **🟡 Medium Uncertainty: User Experience Design**

**Navigation Behavior Questions:**
1. **Current Chunk Detection**: How do we visually indicate which chunk is "current"?
2. **Scroll Behavior**: Should we scroll to chunk start, middle, or ensure entire chunk is visible?
3. **Cycling**: Should chunk navigation cycle like file navigation, or stop at ends?
4. **Visual Feedback**: How do we show chunk position (e.g., "Change 2 of 5")?

**Design Decisions Needed:**
- Chunk highlighting or selection mechanism
- Scroll positioning strategy
- Control bar layout for chunk navigation buttons
- Integration with existing file navigation

#### **🟡 Medium Uncertainty: State Management**

**Synchronization Challenges:**
1. **Manual Scrolling**: How do we detect when user manually scrolls to different chunk?
2. **Accept/Reject Impact**: How do we update current chunk index when chunks are modified?
3. **Chunk Count Updates**: How do we handle dynamic chunk count changes?
4. **Performance**: How often should we poll/update chunk position?

**Technical Questions:**
- Should we listen to scroll events, cursor position, or viewport changes?
- How do we efficiently track current chunk without constant recalculation?
- What happens to chunk indices when chunks are accepted/rejected?

### Phase 2 Implementation Strategy

#### **Step 1: Research & Prototyping**
**Duration**: 1 day
- Create minimal test to understand `getChunks()` API
- Experiment with `EditorView.dispatch()` scroll actions
- Test chunk position calculation and line mapping
- Investigate viewport change listeners

#### **Step 2: Core Navigation Logic**
**Duration**: 1-2 days
- Implement chunk position detection
- Add scroll-to-chunk functionality
- Create chunk navigation methods (next/previous)
- Handle edge cases (no chunks, single chunk)

#### **Step 3: UI Integration**
**Duration**: 1 day
- Add chunk navigation buttons to control bar
- Implement chunk counter display
- Add visual feedback for current chunk
- Test integration with file navigation

### Proposed Control Bar Layout

```
[← File] [File 1 of 3: filename.md] [File →]  |  [↑ Change] [Change 2 of 5] [Change ↓]
```

### Research Questions to Answer

1. **CodeMirror API Investigation**:
   ```typescript
   // What does getChunks() actually return?
   const chunks = getChunks(editorView.state);
   console.log(chunks); // Structure? Properties? Order?
   
   // How do we scroll to a specific line?
   editorView.dispatch({
     selection: { anchor: pos },
     scrollIntoView: true
   });
   ```

2. **Viewport Detection**:
   ```typescript
   // How do we detect current viewport position?
   const viewport = editorView.viewport;
   // How do we map viewport to chunks?
   ```

3. **Event Handling**:
   ```typescript
   // What events fire when user scrolls or changes chunks?
   EditorView.updateListener.of((update) => {
     // Detect scroll changes?
     // Detect chunk changes?
   });
   ```

### Risk Mitigation

**If CodeMirror APIs are insufficient:**
- **Fallback 1**: Line-based navigation instead of chunk-based
- **Fallback 2**: Simple "scroll to top/bottom" navigation
- **Fallback 3**: Defer to Phase 3 and implement bulk operations first

**If performance is poor:**
- **Throttle**: Debounce chunk position detection
- **Cache**: Store chunk positions and update only on content changes
- **Lazy**: Only calculate current chunk when navigation buttons are used

### Success Criteria for Phase 2

✅ **Functional Navigation**: Up/Down buttons scroll between diff chunks  
✅ **Position Awareness**: Display current chunk number (e.g., "Change 2 of 5")  
✅ **Smooth Scrolling**: Chunks are properly centered/visible when navigated to  
✅ **State Sync**: Current chunk updates when user manually scrolls  
✅ **Edge Handling**: Works with single chunk, no chunks, dynamic changes  

This analysis identifies the key uncertainties and provides a structured approach to tackle Phase 2 implementation.
