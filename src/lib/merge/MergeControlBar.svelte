<script lang="ts">
  import { ChevronLeftIcon, ChevronRightIcon } from "lucide-svelte";
  
  type Props = {
    allChangedFiles: string[];
    currentFileIndex: number;
    onNavigateFile: (direction: 'prev' | 'next') => Promise<void>;
  };
  
  let { allChangedFiles, currentFileIndex, onNavigateFile }: Props = $props();
  
  // Reactive calculations
  const currentFileName = $derived(allChangedFiles[currentFileIndex]?.split('/').pop() || '');
  // Note: No need for canGoPrevious/canGoNext since we cycle through files
</script>

<div class="merge-control-bar">
  <!-- File Navigation -->
  <div class="file-navigation">
    <button 
      class="clickable-icon"
      onclick={() => onNavigateFile('prev')}
      aria-label="Previous file with changes (cycles to end)"
    >
      <ChevronLeftIcon class="size-4" />
    </button>
    
    <div class="file-counter">
      <span class="counter-text">{currentFileIndex + 1} of {allChangedFiles.length}</span>
      <span class="file-name">{currentFileName}</span>
    </div>
    
    <button 
      class="clickable-icon"
      onclick={() => onNavigateFile('next')}
      aria-label="Next file with changes (cycles to beginning)"
    >
      <ChevronRightIcon class="size-4" />
    </button>
  </div>
</div>

<style>
  .merge-control-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
    background-color: var(--background-secondary);
    font-size: var(--font-ui-smaller);
    /* Ensure it stays above editor content */
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
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
  
  /* Removed disabled styles since buttons now cycle */
</style>
