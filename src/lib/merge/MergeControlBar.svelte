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
