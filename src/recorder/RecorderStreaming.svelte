<script lang="ts">
  /********** Imports **********/
  import { onDestroy } from "svelte";
  import {
    Mic,
    XIcon,
    CheckIcon,
    Trash2Icon,
    AArrowUpIcon,
  } from "lucide-svelte";

  import { nanoid } from "nanoid";
  import { usePlugin } from "$lib/utils";
  import { getTranscriptionAccount } from "../settings/recording";
  import type { StreamingEventMessage } from "assemblyai";

  /********** Types **********/
  interface Recording {
    id: string;
    text: string;
    date: Date;
    duration: number; // seconds
    audioUrl: null; // reserved for future wav saving
    state: "ready" | "error";
  }

  /********** State **********/
  // UI
  let isRecording = $state<boolean>(false);
  let isExpanded = $state<boolean>(false);

  // Streaming text
  let turns = $state<string[]>([]);

  // Saved transcripts
  let recordings = $state<Recording[]>([]);

  // Internal handles
  const SAMPLE_RATE = 16_000;
  let ws: WebSocket | null = null;
  let audioCtx: AudioContext | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let mediaStream: MediaStream | null = null;
  let startedAt = 0;

  /********** Utils **********/
  function f32ToS16(buf: Float32Array): ArrayBuffer {
    const out = new Int16Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      const v = Math.max(-1, Math.min(1, buf[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out.buffer;
  }

  function closeWs(sendTerminate = false) {
    if (ws) {
      try {
        if (sendTerminate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Terminate" }));
        }
        ws.close();
      } catch (_) {
        /* ignore */
      }
      ws = null;
    }
  }

  function stopAudio() {
    scriptNode?.disconnect();
    scriptNode = null;

    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }

    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  function resetUI() {
    isRecording = false;
    isExpanded = false;
    turns = [];
  }

  /********** WebSocket event handler **********/
  function onWsMessage(ev: MessageEvent) {
    try {
      const msg = JSON.parse(ev.data as string) as StreamingEventMessage;

      if (!("type" in msg) || msg.type !== "Turn") return;

      turns[msg.turn_order] = msg.transcript;
    } catch (err) {
      console.error("WS parse error:", err);
    }
  }

  /********** Recording control **********/
  async function startRecording() {
    if (isRecording) return;

    isExpanded = true;
    isRecording = true;
    startedAt = Date.now();

    try {
      const { account } = getTranscriptionAccount();
      const qs = new URLSearchParams({
        sample_rate: SAMPLE_RATE.toString(),
        format_turns: "true",
        token: account.config.apiKey, // user confirmed this works
      });
      ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${qs}`);
      ws.onmessage = onWsMessage;
      ws.onerror = (e) => {
        console.error("WS error:", e);
        cancelRecording();
      };
      ws.onclose = () => console.log("WS closed");

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      const source = audioCtx.createMediaStreamSource(mediaStream);

      // Prepare PCM pump (ScriptProcessor or fallback AudioWorklet)
      if (audioCtx.createScriptProcessor) {
        // @ts-ignore — deprecated but still present on desktop Chromium
        scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
        scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const pcm = f32ToS16(e.inputBuffer.getChannelData(0));
          ws.send(pcm);
        };
        source.connect(scriptNode);
        scriptNode.connect(audioCtx.destination); // keep node in graph
      } else {
        /* Mobile Safari / WKWebView path */
        await audioCtx.audioWorklet.addModule(
          URL.createObjectURL(
            new Blob(
              [
                `
              class PCMWorklet extends AudioWorkletProcessor {
                process(inputs) {
                  if (!inputs[0]?.[0]) return true;
                  const f32 = inputs[0][0];
                  const i16 = new Int16Array(f32.length);
                  for (let i = 0; i < f32.length; i++) {
                    const v = Math.max(-1, Math.min(1, f32[i]));
                    i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
                  }
                  this.port.postMessage(i16.buffer, [i16.buffer]);
                  return true;
                }
              }
              registerProcessor('pcm-worklet', PCMWorklet);
            `,
              ],
              { type: "text/javascript" },
            ),
          ),
        );

        const awNode = new (window as any).AudioWorkletNode(
          audioCtx,
          "pcm-worklet",
        );
        awNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        source.connect(awNode);
      }
    } catch (err) {
      console.error("startRecording error:", err);
      cancelRecording();
    }
  }

  function acceptRecording() {
    if (!isRecording) return;

    closeWs(true);
    stopAudio();

    const full = turns.join(" ").trim();
    if (full) {
      recordings = [
        ...recordings,
        {
          id: nanoid(),
          text: full,
          date: new Date(),
          duration: (Date.now() - startedAt) / 1000,
          audioUrl: null,
          state: "ready",
        },
      ];
    }

    resetUI();
  }

  function cancelRecording() {
    if (!isRecording) return;
    closeWs(true);
    stopAudio();
    resetUI();
  }

  /********** Transcript chip helpers **********/
  function insertAtCursor(text: string) {
    const plugin = usePlugin();
    const leaf = plugin.app.workspace.activeLeaf;
    const editor = leaf?.view?.editor;

    if (editor) {
      editor.replaceSelection(text, "end");
      return;
    }

    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const s = el.selectionStart ?? 0;
      const e = el.selectionEnd ?? 0;
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      el.selectionStart = el.selectionEnd = s + text.length;
    }
  }

  function removeRecording(id: string) {
    recordings = recordings.filter((r) => r.id !== id);
  }

  /********** Cleanup **********/
  onDestroy(() => {
    closeWs();
    stopAudio();
  });
</script>

<!-- ================= UI ================= -->
<div
  class="fixed bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center z-100"
>
  <!-- Transcript chips -->
  {#if recordings.length}
    <div class="flex flex-col-reverse gap-1 w-full max-w-sm mb-2">
      {#each recordings as rec (rec.id)}
        <div
          class="flex items-center border border-[var(--color-base-50)] bg-(--background-primary-alt) rounded-full w-full p-1"
        >
          <button
            class="clickable-icon rounded-full"
            onclick={() => removeRecording(rec.id)}
          >
            <Trash2Icon class="size-4" />
          </button>

          <span class="truncate flex-1 px-1">{rec.text}</span>

          <button
            class="clickable-icon rounded-full"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => insertAtCursor(rec.text)}
          >
            <AArrowUpIcon class="size-4" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Main pill -->
  <div class="flex flex-col items-center gap-2">
    {#if isExpanded}
      <div
        class="flex items-center bg-accent rounded-full h-12 w-64 px-2 border border-[var(--color-base-10)]"
      >
        <!-- cancel -->
        <button class="clickable-icon rounded-full" onclick={cancelRecording}>
          <XIcon class="text-(--text-on-accent-inverted) size-6" />
        </button>

        <!-- live text / placeholder -->
        <span class="truncate-left flex-1 px-1">
          {turns.length ? turns.join(" ").trim() : "Listening…"}
        </span>

        <!-- accept -->
        <button
          class="clickable-icon rounded-full h-10 w-10"
          onclick={acceptRecording}
        >
          <CheckIcon class="text-(--text-on-accent-inverted) size-6" />
        </button>
      </div>
    {:else}
      <button
        class="mic-btn flex items-center justify-center transition-colors"
        onclick={startRecording}
      >
        <Mic size={20} />
      </button>
    {/if}
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

  .truncate-left {
    direction: rtl;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
