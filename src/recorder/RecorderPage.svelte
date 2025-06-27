<script lang="ts">
  import { Mic, Square, FileTextIcon } from "lucide-svelte";
  import { RecorderStreaming } from "./recorder-streaming.svelte.ts";
  import { onDestroy } from "svelte";
  import { humanTime } from "$lib/utils/datetime.ts";
  import Autoscroll from "../chat/Autoscroll.svelte";

  // Create recorder instance
  const recorder = new RecorderStreaming();

  let scrollContainer = $state<HTMLElement | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let showTopFade = $state(false);

  // Track scroll position to show/hide fade
  function handleScroll() {
    if (scrollContainer) {
      showTopFade = scrollContainer.scrollTop > 10;
    }
  }

  // Clean up on destroy
  onDestroy(() => {
    recorder.destroy();
  });

  function openTranscription(fileName: string) {
    // TODO: Open the transcription file
    console.log("Opening transcription:", fileName);
  }
</script>

<div class="h-full flex flex-col">
  <!-- Streaming Text Area -->
  <div class="flex-none">
    <div class="m-4 border border-(--background-modifier-border) rounded-lg bg-(--background-primary-alt) h-[200px] flex flex-col">
      {#if recorder.isRecording}
        <!-- Fixed Recording Header -->
        <div class="flex-none p-4 pb-2 border-b border-(--background-modifier-border)">
          <div class="flex items-center justify-between gap-2 text-sm text-(--text-accent)">
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 bg-(--color-accent) rounded-full animate-pulse"></div>
              <span>Recording...</span>
            </div>
            <button
              class="clickable-icon p-1 rounded"
              onmousedown={(e) => {
                e.preventDefault();
                recorder.acceptRecording();
              }}
              aria-label="Stop recording"
            >
              <Square class="size-4" />
            </button>
          </div>
        </div>
        
        <!-- Scrollable Transcription Text -->
        <div class="flex-1 relative min-h-0">
          <!-- Fixed fade overlay at top (outside scroll area) -->
          {#if showTopFade}
            <div class="fade-top"></div>
          {/if}
          
          <div 
            class="absolute inset-0 overflow-y-auto scrollbar-hidden p-4 pt-2"
            bind:this={scrollContainer}
            onscroll={handleScroll}
          >
            <div class="text-sm text-(--text-normal) whitespace-pre-wrap">
              {recorder.streamingText}
            </div>
            
            <Autoscroll
              messages={[{ text: recorder.streamingText }]}
              container={scrollContainer}
              enabled={recorder.isRecording}
              bind:sentinel
            />
          </div>
        </div>
      {:else}
        <!-- Placeholder (full area clickable) -->
        <div
          class="flex items-center justify-center h-full cursor-pointer text-(--text-muted) hover:text-(--text-normal) transition-colors p-4"
          onmousedown={(e) => {
            e.preventDefault();
            recorder.startRecording();
          }}
        >
          <div class="flex flex-col items-center gap-2">
            <Mic class="size-8" />
            <span class="text-sm">Click to start recording</span>
            {#if recorder.autoInsert}
              <span class="text-xs opacity-70">Will insert at cursor</span>
            {:else}
              <span class="text-xs opacity-70">Will save only</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Auto-insert Toggle (only show when not recording) -->
    {#if !recorder.isRecording}
      <div class="setting-item mx-4 mb-4">
        <div class="setting-item-info">
          <div class="setting-item-name" style="color: var(--text-muted); ">
            Insert at cursor
          </div>
        </div>
        <div class="setting-item-control">
          <div
            role="checkbox"
            tabindex="0"
            onkeydown={() => recorder.toggleAutoInsert()}
            onclick={() => recorder.toggleAutoInsert()}
            aria-label="Insert at cursor"
            aria-checked={recorder.autoInsert}
            class="checkbox-container"
            class:is-enabled={recorder.autoInsert}
          >
            <input type="checkbox" tabindex="-1" />
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Transcription Files List -->
  <div class="flex-1 overflow-y-auto">
    <div class="px-2 py-2">
      {#if recorder.recordings.length === 0}
        <div class="flex flex-col items-center justify-center py-8 gap-2">
          <FileTextIcon class="size-8 opacity-30" />
          <span class="text-sm text-(--text-muted)">No transcriptions yet</span>
          <p class="text-xs text-(--text-muted) text-center px-4">
            Start recording to create your first transcription file
          </p>
        </div>
      {:else}
        <div class="flex flex-col gap-1">
          {#each recorder.recordings as recording}
            <button
              class="clickable-icon p-3 text-left"
              onclick={() => openTranscription(recording.text)}
            >
              <div class="flex items-start gap-3">
                <FileTextIcon
                  class="size-4 mt-0.5 flex-shrink-0 text-(--text-muted)"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-(--text-muted) mb-1">
                    {humanTime(recording.date.getTime())} • {recording.duration.toFixed(
                      0,
                    )}s
                  </div>
                  <div
                    class="text-sm text-(--text-normal) text-wrap leading-relaxed"
                  >
                    {recording.text.slice(0, 120)}{recording.text.length > 120
                      ? "..."
                      : ""}
                  </div>
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .checkbox-container {
    display: inline-block;
    position: relative;
    width: 40px;
    height: 20px;
    border-radius: 10px;
    background-color: var(--background-modifier-border);
    transition: background-color 0.2s ease;
  }
  .checkbox-container.is-enabled {
    background-color: var(--color-accent);
  }
  .checkbox-container input[type="checkbox"] {
    display: none;
  }
  .scrollbar-hidden::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hidden {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .fade-top {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 30px;
    background-image: linear-gradient(to bottom, var(--background-primary-alt) 0%, var(--background-primary-alt) 30%, transparent 100%);
    pointer-events: none;
    z-index: 1;
  }
</style>
