<script lang="ts">
  import {
    AArrowUpIcon,
    ArrowBigUp,
    ArrowBigUpIcon,
    ArrowUpIcon,
    Check,
    CheckIcon,
    Mic,
    Send,
    TextCursorInputIcon,
    Trash2Icon,
    X,
    XIcon,
  } from "lucide-svelte";
  import { onDestroy } from "svelte";
  import { usePlugin } from "$lib/utils";
  import { AssemblyAI } from "assemblyai";
  import { MarkdownView, Notice } from "obsidian";
  import { nanoid } from "nanoid";
  import { getTranscriptionAccount } from "../settings/recording.ts";

  // Define the structure for a recording object
  interface Recording {
    id: string;
    text: string;
    date: Date;
    duration: number; // Placeholder duration
    audio: Blob;
    audioUrl: string;
    state: "processing" | "ready" | "error";
  }

  // Main recording states using Svelte 5 runes
  let isRecording = $state(false);
  let isExpanded = $state(false);
  let accepted = $state(false);
  let audioLevels = $state(Array(15).fill(0.1));

  // Recordings management (visible transcripts)
  let recordings = $state<Recording[]>([]);

  // Audio recording variables
  let audioContext: AudioContext | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioStream: MediaStream | null = null;
  let audioData: Blob[] = [];
  let analyser: AnalyserNode | null = null;
  let animationRef: number | null = null;

  // Interval-based level updates
  const LEVEL_UPDATE_INTERVAL = 100; // ms
  let lastLevelUpdateTime = 0;
  let accumulatedLevel = 0;
  let levelCount = 0;

  // Audio processing setup
  async function setupAudio(): Promise<boolean> {
    try {
      // Get audio stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStream = stream;

      // Create audio context and analyzer
      audioContext = new AudioContext();

      // Create analyzer to visualize audio levels
      const audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256; // Increased for better resolution
      audioAnalyser.smoothingTimeConstant = 0.8; // Increased smoothing further (was 0.7)
      analyser = audioAnalyser;

      // Connect the stream to the analyzer
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(audioAnalyser);

      // Create media recorder
      const recorder = new MediaRecorder(stream);
      mediaRecorder = recorder;

      // Set up data handling
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioData.push(event.data);
        }
      };

      // When recording stops, we have the complete audio blob
      recorder.onstop = () => {
        if (!accepted) return;

        const audioBlob = new Blob(audioData, { type: "audio/webm" });
        audioData = [];

        const recording: Recording = {
          id: nanoid(),
          text: "",
          date: new Date(),
          duration: 10, // Placeholder duration (e.g., 10 seconds)
          audio: audioBlob,
          audioUrl: URL.createObjectURL(audioBlob),
          state: "processing",
        };
        recordings.push(recording);
        generateTranscription(recording.id, audioBlob);
      };

      return true;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      return false;
    }
  }

  // Process audio levels for visualization
  function updateAudioLevels(): void {
    if (!analyser || !isRecording) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Calculate average level and normalize to 0-1 range
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength / 255;

    // Scale the value to make visualization more responsive
    // Apply a minimum value so bars are always visible
    const scaledValue = Math.max(0.1, average * 12); // Use original multiplier

    // Accumulate levels over the interval
    const currentTime = performance.now();
    accumulatedLevel += scaledValue;
    levelCount++;

    // Update the visualization array only at specified intervals
    if (currentTime - lastLevelUpdateTime >= LEVEL_UPDATE_INTERVAL) {
      const averageIntervalLevel =
        levelCount > 0 ? accumulatedLevel / levelCount : 0.1;
      // Update our audio levels array (shift left and add new value)
      audioLevels = [
        ...audioLevels.slice(1),
        Math.max(0.1, averageIntervalLevel),
      ]; // Ensure minimum level

      // Reset for next interval
      lastLevelUpdateTime = currentTime;
      accumulatedLevel = 0;
      levelCount = 0;
    }

    // Continue animation loop if still recording
    if (isRecording) {
      animationRef = requestAnimationFrame(updateAudioLevels);
    }
  }

  // Start recording
  async function startRecording(): Promise<void> {
    isExpanded = true;

    // Initialize audio if not already done
    if (!audioContext) {
      const success = await setupAudio();
      if (!success) {
        isExpanded = false;
        return;
      }
    }

    // Start recording
    isRecording = true;

    // Start media recorder
    if (mediaRecorder && mediaRecorder.state !== "recording") {
      mediaRecorder.start(100); // Collect data every 100ms
    }

    // Reset audio levels and start visualization
    audioLevels = Array(15).fill(0.1); // Match array size
    lastLevelUpdateTime = performance.now(); // Initialize interval timer
    accumulatedLevel = 0;
    levelCount = 0;

    // Start visualization immediately
    if (animationRef) {
      cancelAnimationFrame(animationRef);
    }
    animationRef = requestAnimationFrame(updateAudioLevels);
  }

  function cancelRecording(): void {
    accepted = false;

    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }

    // Stop visualization
    if (animationRef) {
      cancelAnimationFrame(animationRef);
      animationRef = null;
    }

    // Update state
    isRecording = false;
    isExpanded = false;

    // Clear audio data since we're discarding this recording
    audioData = [];
  }

  // Accept recording
  function acceptRecording(): void {
    accepted = true;

    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }

    // Stop visualization
    if (animationRef) {
      cancelAnimationFrame(animationRef);
      animationRef = null;
    }

    // Update state
    isRecording = false;
    isExpanded = false;
    // The recording will be saved via the mediaRecorder.onstop handler
  }

  // Main transcription function
  async function generateTranscription(id: string, audio: Blob): Promise<void> {
    const recording = recordings.find((r) => r.id === id);
    if (!recording) {
      return;
    }
    try {
      const plugin = usePlugin();
      const { account, model } = getTranscriptionAccount();
      const client = new AssemblyAI({
        apiKey: account.config.apiKey,
      });
      const transcript = await client.transcripts.transcribe({
        audio: audio,
        speech_model: model.id,
        ...(plugin.settings?.recording?.language
          ? { language_code: plugin.settings.recording.language }
          : {}),
      });
      recording.text = transcript.text;
      recording.state = "ready";
    } catch (error) {
      recording.state = "error";
      new Notice(error.message, 3000);
    }
  }

  function playRecording(url: string): void {
    const audio = new Audio(url);
    audio.play();
  }

  // Send recording to cursor
  function sendToCursor(text: string): void {
    console.log(`Sending to cursor: "${text}"`);
    insertAtCursor(text);
  }

  // Insert at cursor
  function insertAtCursor(transcription: string): void {
    const plugin = usePlugin();
    const activeLeaf = plugin.app.workspace.activeLeaf;
    const editor = activeLeaf?.view?.editor;

    if (editor) {
      editor.replaceSelection(transcription, "end");
      return;
    }

    // Handle DOM input/textarea elements
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value =
        el.value.substring(0, start) + transcription + el.value.substring(end);
      el.selectionStart = el.selectionEnd = start + transcription.length;
    }
  }

  // Remove recording from list
  function removeRecording(id: string): void {
    // Get the recording to revoke its object URL
    const recordingIndex = recordings.findIndex((r) => r.id === id);
    if (recordingIndex !== -1) {
      const recording = recordings[recordingIndex];
      if (recording.audioUrl) {
        URL.revokeObjectURL(recording.audioUrl);
      }
      // Remove the recording from the array
      recordings.splice(recordingIndex, 1);
      recordings = recordings; // Trigger Svelte reactivity
    }
  }

  // Clean up resources when component is destroyed
  onDestroy(() => {
    // Stop all media tracks
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
    }

    // Close audio context
    if (audioContext) {
      audioContext.close();
    }

    // Cancel any animation frames
    if (animationRef) {
      cancelAnimationFrame(animationRef);
    }

    // Revoke any object URLs
    recordings.forEach((rec: Recording) => {
      if (rec.audioUrl) URL.revokeObjectURL(rec.audioUrl);
    });
  });
</script>

<div
  class="fixed bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center z-100"
>
  <!-- Stacked Transcripts -->
  {#if recordings.length > 0}
    <div class="flex flex-col-reverse gap-1 w-full max-w-sm mb-2">
      {#each recordings as recording (recording.id)}
        <div
          class="flex items-center border border-[var(--color-base-50)] bg-gray-[var(--color-base-00)] rounded-full w-full p-1"
        >
          <!-- Remove Button -->
          <button
            onclick={() => removeRecording(recording.id)}
            class="clickable-icon rounded-full"
          >
            <Trash2Icon class="size-4" />
          </button>

          <!-- Transcript Text -->
          <span class="truncate flex-1 px-1">
            {recording.state === "processing"
              ? "Processing..."
              : recording.state === "error"
                ? "Error"
                : recording.text}
          </span>

          {#if recording.state === "ready"}
            <button
              onmousedown={(e) => e.preventDefault()}
              onclick={() => sendToCursor(recording.text)}
              class="clickable-icon rounded-full"
            >
              <AArrowUpIcon class="size-4" />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  <!-- Main Widget -->
  <div class="flex flex-col items-center gap-2">
    <!-- Recorder Button -->
    <div class="flex items-center justify-center">
      {#if isExpanded}
        <div
          class="flex items-center bg-accent rounded-full h-12 w-64 px-2 border border-[var(--color-base-10)]"
        >
          <button
            onclick={cancelRecording}
            class="flex items-center justify-center clickable-icon rounded-full"
          >
            <XIcon class="text-(--text-on-accent-inverted) size-6" />
          </button>
          <div class="flex-1 flex items-center justify-center space-x-px mx-1">
            {#each audioLevels as level, index}
              <div
                class="w-1 bg-(--color-base-10) rounded-full"
                style="height: {Math.max(3, level * 8)}px; opacity: {(index +
                  1) /
                  audioLevels.length}"
              ></div>
            {/each}
          </div>
          <button
            onclick={acceptRecording}
            class="clickable-icon flex items-center justify-center h-10 w-10 rounded-full"
          >
            <CheckIcon class="text-(--text-on-accent-inverted) size-6" />
          </button>
        </div>
      {:else}
        <button
          onclick={startRecording}
          class="mic-btn flex items-center justify-center transition-colors"
        >
          <Mic size={20} />
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .bg-accent {
    background-color: var(--color-accent-1) !important;
  }

  .mic-btn {
    background-color: var(--color-accent-1) !important;
    color: var(--color-base-00) !important;
    border-radius: calc(infinity * 1px) !important;
    width: calc(var(--spacing) * 12);
    height: calc(var(--spacing) * 12);
  }
</style>
