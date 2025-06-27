import { nanoid } from "nanoid";
import { getTranscriptionAccount } from "../settings/recording";
import type { StreamingEventMessage } from "assemblyai";
import { usePlugin } from "$lib/utils";

interface Recording {
  id: string;
  text: string;
  date: Date;
  duration: number; // seconds
  audioUrl: null; // reserved for future wav saving
  state: "ready" | "error";
}

export class RecorderStreaming {
  // UI State
  isRecording = $state<boolean>(false);
  autoInsert = $state<boolean>(true); // Toggle for auto-insert at cursor
  
  // Streaming text
  turns = $state<string[]>([]);
  
  // Saved transcripts
  recordings = $state<Recording[]>([]);

  // Internal handles
  private readonly SAMPLE_RATE = 16_000;
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  private startedAt = 0;

  // Derived state
  get streamingText() {
    return this.turns.length ? this.turns.join(" ").trim() : "";
  }

  get isIdle() {
    return !this.isRecording;
  }

  /********** Utils **********/
  private f32ToS16(buf: Float32Array): ArrayBuffer {
    const out = new Int16Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      const v = Math.max(-1, Math.min(1, buf[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out.buffer;
  }

  private closeWs(sendTerminate = false) {
    if (this.ws) {
      try {
        if (sendTerminate && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "Terminate" }));
        }
        this.ws.close();
      } catch (_) {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private stopAudio() {
    this.scriptNode?.disconnect();
    this.scriptNode = null;

    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }

    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
  }

  private resetUI() {
    this.isRecording = false;
    this.turns = [];
  }

  /********** WebSocket event handler **********/
  private onWsMessage = (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(ev.data as string) as StreamingEventMessage;

      if (!("type" in msg) || msg.type !== "Turn") return;

      this.turns[msg.turn_order] = msg.transcript;
    } catch (err) {
      console.error("WS parse error:", err);
    }
  };

  /********** Public API **********/
  async startRecording(): Promise<void> {
    if (this.isRecording) return;

    this.isRecording = true;
    this.startedAt = Date.now();

    try {
      const { account } = getTranscriptionAccount();
      const qs = new URLSearchParams({
        sample_rate: this.SAMPLE_RATE.toString(),
        format_turns: "true",
        token: account.config.apiKey,
      });
      this.ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${qs}`);
      this.ws.onmessage = this.onWsMessage;
      this.ws.onerror = (e) => {
        console.error("WS error:", e);
        this.cancelRecording();
      };
      this.ws.onclose = () => console.log("WS closed");

      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new AudioContext({ sampleRate: this.SAMPLE_RATE });
      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);

      // Prepare PCM pump (ScriptProcessor or fallback AudioWorklet)
      if (this.audioCtx.createScriptProcessor) {
        // @ts-ignore — deprecated but still present on desktop Chromium
        this.scriptNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
          const pcm = this.f32ToS16(e.inputBuffer.getChannelData(0));
          this.ws.send(pcm);
        };
        source.connect(this.scriptNode);
        this.scriptNode.connect(this.audioCtx.destination); // keep node in graph
      } else {
        /* Mobile Safari / WKWebView path */
        await this.audioCtx.audioWorklet.addModule(
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
          this.audioCtx,
          "pcm-worklet",
        );
        awNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(e.data);
        };
        source.connect(awNode);
      }
    } catch (err) {
      console.error("startRecording error:", err);
      this.cancelRecording();
    }
  }

  private insertAtCursor(text: string): void {
    const plugin = usePlugin();
    if (!plugin) return;

    const editor = plugin.app.workspace.activeLeaf.view.editor;
    if (editor) {
      editor.replaceSelection(text, "end");
      return;
    }

    // Fallback for other input elements
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const s = el.selectionStart ?? 0;
      const e = el.selectionEnd ?? 0;
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      el.selectionStart = el.selectionEnd = s + text.length;
    }
  }

  acceptRecording(): void {
    if (!this.isRecording) return;

    this.closeWs(true);
    this.stopAudio();

    const full = this.turns.join(" ").trim();
    if (full) {
      // Auto-insert at cursor if enabled
      if (this.autoInsert) {
        this.insertAtCursor(full);
      }

      // Always save to recordings list
      this.recordings = [
        ...this.recordings,
        {
          id: nanoid(),
          text: full,
          date: new Date(),
          duration: (Date.now() - this.startedAt) / 1000,
          audioUrl: null,
          state: "ready",
        },
      ];
    }

    this.resetUI();
  }

  toggleAutoInsert(): void {
    this.autoInsert = !this.autoInsert;
  }

  cancelRecording(): void {
    if (!this.isRecording) return;
    this.closeWs(true);
    this.stopAudio();
    this.resetUI();
  }

  removeRecording(id: string): void {
    this.recordings = this.recordings.filter((r) => r.id !== id);
  }

  // Cleanup method to be called when component is destroyed
  destroy(): void {
    this.closeWs();
    this.stopAudio();
  }
}
