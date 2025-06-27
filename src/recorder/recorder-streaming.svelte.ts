import { nanoid } from "nanoid";
import { getTranscriptionAccount } from "../settings/recording";
import type { StreamingEventMessage } from "assemblyai";
import { usePlugin } from "$lib/utils";
import {
  saveTranscriptionFile,
  loadTranscriptionFiles,
} from "./transcription-files";
import type { Recording } from "./types";

export class RecorderStreaming {
  // UI State
  isRecording = $state<boolean>(false);

  // Streaming text
  turns = $state<string[]>([]);

  // Saved transcripts
  recordings = $state<Recording[]>([]);

  // Insertion target detection
  insertionTarget = $state<string | null>(null);

  // Internal handles
  private readonly SAMPLE_RATE = 16_000;
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  private startedAt = 0;

  // Event listener references for cleanup
  private focusInHandler = () => this.updateInsertionTarget();
  private focusOutHandler = () => this.updateInsertionTarget();

  // Derived state
  get streamingText() {
    return this.turns.length ? this.turns.join(" ").trim() : "";
  }

  get isIdle() {
    return !this.isRecording;
  }

  // Detect where text can be inserted
  private detectInsertionTarget(): void {
    const plugin = usePlugin();

    // Check if focused element can accept paste
    const activeElement = document.activeElement;
    if (!activeElement) {
      this.insertionTarget = null;
      return;
    }

    // Check if it's an Obsidian editor first
    if (plugin) {
      const leaves = plugin.app.workspace.getLeavesOfType("markdown");
      const editorLeaf = leaves.find((leaf) => leaf.view?.editor);

      if (editorLeaf?.view?.editor && activeElement.closest(".cm-editor")) {
        // Get the file name if available
        const file = editorLeaf.view?.file;
        let fileName = file?.name || "Editor";
        // Remove .md extension since it's implied in Obsidian
        if (fileName.endsWith(".md")) {
          fileName = fileName.slice(0, -3);
        }
        this.insertionTarget = fileName;
        return;
      }
    }

    // Check if it's a text input/textarea
    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      // Check if it's a chat input with title
      const chatTitle = activeElement.getAttribute("data-chat-title");
      if (chatTitle) {
        this.insertionTarget = chatTitle;
        return;
      }

      this.insertionTarget = "Text input";
      return;
    }

    // Check if element is contentEditable
    // @ts-expect-error no type narrowing
    if (activeElement.isContentEditable) {
      this.insertionTarget = "Editable content";
      return;
    }

    // Default case - no valid insertion target
    this.insertionTarget = null;
  }

  constructor() {
    // Initial detection
    this.updateInsertionTarget();

    // Update detection when focus changes
    document.addEventListener("focusin", this.focusInHandler);
    document.addEventListener("focusout", this.focusOutHandler);

    // Load existing transcriptions
    this.loadExistingTranscriptions();
  }

  // Load transcriptions from files
  private async loadExistingTranscriptions(): Promise<void> {
    try {
      const fileTranscriptions = await loadTranscriptionFiles();
      // Direct assignment - TranscriptionFile and Recording are identical
      this.recordings = fileTranscriptions;
    } catch (error) {
      console.error("Failed to load existing transcriptions:", error);
    }
  }

  // Public method to update insertion target detection
  updateInsertionTarget(): void {
    this.detectInsertionTarget();
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

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
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
          if (this.ws && this.ws.readyState === WebSocket.OPEN)
            this.ws.send(e.data);
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

    const activeElement = document.activeElement;
    if (!activeElement) return;

    // Check if focused element is an Obsidian editor
    if (activeElement.closest(".cm-editor")) {
      const leaves = plugin.app.workspace.getLeavesOfType("markdown");
      const editorLeaf = leaves.find((leaf) => leaf.view?.editor);

      if (editorLeaf?.view?.editor) {
        editorLeaf.view.editor.replaceSelection(text, "end");
        return;
      }
    }

    // Check if focused element is a text input/textarea
    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      const s = activeElement.selectionStart ?? 0;
      const e = activeElement.selectionEnd ?? 0;
      activeElement.value =
        activeElement.value.slice(0, s) + text + activeElement.value.slice(e);
      activeElement.selectionStart = activeElement.selectionEnd =
        s + text.length;
      return;
    }

    // Check if focused element is contentEditable
    if (
      activeElement instanceof HTMLElement &&
      activeElement.isContentEditable
    ) {
      // Insert text at cursor position in contentEditable element
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  async acceptRecording(): Promise<void> {
    if (!this.isRecording) return;

    this.closeWs(true);
    this.stopAudio();

    const full = this.turns.join(" ").trim();
    if (full) {
      // Insert text if there's a valid target
      this.insertAtCursor(full);

      // Save to file first
      const file = await saveTranscriptionFile(
        full,
        new Date(),
        (Date.now() - this.startedAt) / 1000,
      );

      // Only add to recordings if file save was successful
      if (file) {
        const recording: Recording = {
          id: nanoid(),
          text: full,
          date: new Date(),
          duration: (Date.now() - this.startedAt) / 1000,
          audioUrl: null,
          file: file,
        };
        // Add to beginning of array so newest appears first
        this.recordings = [recording, ...this.recordings];
      } else {
        // Show error if file save failed
        console.error("Failed to save transcription file");
      }
    }

    this.resetUI();
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
    this.cancelRecording();

    // Clean up focus event listeners
    document.removeEventListener("focusin", this.focusInHandler);
    document.removeEventListener("focusout", this.focusOutHandler);
  }
}
