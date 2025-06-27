<script lang="ts">
  import { Mic, Square, Play, Save, ClipboardPasteIcon, Ban } from "lucide-svelte";
  import { FileTextIcon, Copy } from "lucide-svelte";
  import Autoscroll from "../chat/Autoscroll.svelte";
  import { openPath } from "$lib/utils/obsidian.ts";
  import { RecorderStreaming } from "./recorder-streaming.svelte.ts";
  import { onDestroy } from "svelte";
  import { humanTime } from "$lib/utils/datetime.ts";

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

  // Reset scroll state for new recording
  function resetScrollState() {
    showTopFade = false;
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }

  // Clean up on destroy
  onDestroy(() => {
    recorder.destroy();
  });

  function openTranscription(recording: { file: { path: string } }) {
    openPath(recording.file.path);
  }

  async function copyTranscription(text: string, event: Event) {
    event.stopPropagation(); // Prevent opening the transcription
    try {
      await navigator.clipboard.writeText(text);
      // Could add a toast notification here if desired
    } catch (error) {
      console.error("Failed to copy transcription:", error);
    }
  }
</script>

<div class="h-full flex flex-col">
  <!-- Fixed Recording Area -->
  <div class="flex-none">
    <div class="m-4 border border-(--background-modifier-border) rounded-lg bg-(--background-primary-alt) h-[200px] flex flex-col">
      <!-- Header with status and controls -->
      <div class="flex-none p-4 pb-2 pt-2 border-b border-(--background-modifier-border)">
        <div class="flex items-center justify-between gap-2 text-sm">
          <div class="flex items-center gap-2">
            {#if recorder.isRecording}
              <div class="w-2 h-2 bg-(--color-accent) rounded-full animate-pulse"></div>
              <span class="text-(--text-accent)">Recording...</span>
            {:else}
              <div class="w-2 h-2 bg-(--text-muted) rounded-full"></div>
              <span class="text-(--text-muted)">Ready to record</span>
            {/if}
          </div>
          <div
            class="flex gap-2"
          >
            {#if recorder.isRecording}
              <div
                class="clickable-icon p-1 rounded cursor-pointer"
                onmousedown={async (e) => {
                  e.preventDefault();
                  recorder.cancelRecording();
                }}
                role="button"
                tabindex="-1"
                aria-label="Cancel recording"
              >
                <Ban class="size-4" />
              </div>
            {/if}
            <div
              class="clickable-icon p-1 rounded cursor-pointer"
              onmousedown={async (e) => {
                e.preventDefault();
                if (recorder.isRecording) {
                  await recorder.acceptRecording();
                } else {
                  recorder.startRecording();
                  resetScrollState();
                }
              }}
              role="button"
              tabindex="-1"
              aria-label={recorder.isRecording ? "Stop recording" : "Start recording"}
            >
              {#if recorder.isRecording}
                {#if recorder.insertionTarget === null}
                  <Save class="size-4" />
                {:else}
                  <ClipboardPasteIcon class="size-4" />
                {/if}
              {:else}
                <Play class="size-4" />
              {/if}
            </div>
          </div>
        </div>
        <!-- Paste target information (always shown) -->
        <div class="text-xs text-(--text-muted) mt-1">
          {#if recorder.insertionTarget === null}
            Click where to paste
          {:else}
            Will paste in {recorder.insertionTarget}
          {/if}
        </div>
      </div>
      
      <!-- Content area -->
      <div class="flex-1 relative min-h-0">
        {#if recorder.isRecording}
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
        {:else}
          <!-- Clickable placeholder content -->
          <div 
            class="flex items-center justify-center h-full p-4 cursor-pointer hover:bg-(--background-modifier-hover) transition-colors"
            onmousedown={(e) => {
              e.preventDefault();
              recorder.startRecording();
              resetScrollState();
            }}
          >
            <div class="text-center text-(--text-muted)">
              <Mic class="size-8 mb-2 mx-auto" />
              <div class="text-sm">Click to start recording</div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Scrollable Transcriptions List -->
  <div class="flex-1 overflow-y-auto min-h-0">
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
            <div class="flex items-start hover:bg-(--background-modifier-hover) transition-colors rounded p-3 gap-3">
              <div
                class="flex items-start gap-3 flex-1 cursor-pointer"
                onclick={() => openTranscription(recording)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && openTranscription(recording)}
              >
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
              <div
                class="clickable-icon p-1 rounded cursor-pointer"
                onmousedown={(e) => copyTranscription(recording.text, e)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && copyTranscription(recording.text, e)}
                aria-label="Copy transcription"
              >
                <Copy class="size-4" />
              </div>
            </div>
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
