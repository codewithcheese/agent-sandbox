import { Notice } from "obsidian";
import Emittery from "emittery";

/**
 * Realtime transcription client for the OpenAI Realtime API **plus**
 * an Emittery-based event bus so the UI can react to streaming text.
 *
 * 1. Opens a generic realtime session (`model=gpt-4o-transcribe`)
 * 2. Sends `session.update` to enable transcription-only mode
 * 3. Streams microphone audio
 * 4. Emits the following events:
 *
 *    ┌───────────────────────┬─────────────────────────────────────────┐
 *    | Event name            | Payload                                |
 *    ├───────────────────────┼─────────────────────────────────────────┤
 *    | "sessionStarted"      | void                                   |
 *    | "sessionStopped"      | void                                   |
 *    | "delta"               | string  ← incremental transcript text  |
 *    | "final"               | string  ← final transcript             |
 *    | "error"               | Error                                  |
 *    └───────────────────────┴─────────────────────────────────────────┘
 *
 *   `realtime.emitter.on('delta', text => { …update UI… })`
 *
 * NB: UI-only properties like a local `timestamp` are **stripped**
 *     before an event is sent to the server, otherwise you hit
 *     “unknown parameter” errors.
 */
type Events = {
  sessionStarted: undefined;
  sessionStopped: undefined;
  delta: string;
  final: string;
  error: Error;
};

export class Realtime {
  /* ──────────────────────────  S t a t e  ────────────────────────── */

  audioElement: HTMLAudioElement;
  peerConnection: RTCPeerConnection | null = null;
  dataChannel: RTCDataChannel | null = null;

  /** Reactive lists you already use elsewhere */
  state = $state<"open" | "connecting" | "closed">("closed");
  events = $state<any[]>([]);

  /** Public event bus */
  readonly emitter = new Emittery<Events>();

  /* ─────────────────────────  P u b l i c  ───────────────────────── */

  /**
   * Start a realtime transcription session.
   * @param apiKey  Your OpenAI secret key (fine for internal use)
   */
  async startSession(apiKey: string) {
    try {
      this.state = "connecting";

      /* 1.  WebRTC ---------------------------------------------------- */
      const pc = new RTCPeerConnection();

      this.audioElement = document.createElement("audio");
      this.audioElement.autoplay = true;
      pc.ontrack = (e) => (this.audioElement.srcObject = e.streams[0]);

      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      pc.addTrack(media.getTracks()[0]);

      /* 2.  Data channel --------------------------------------------- */
      const dc = pc.createDataChannel("oai-events");
      this.attachDataChannel(dc);

      /* 3.  SDP handshake -------------------------------------------- */
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        // Trying to connect with gpt-4o-transcribe is rejected
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/sdp",
          },
        },
      );

      if (!sdpRes.ok) {
        throw new Error(await sdpRes.text());
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: await sdpRes.text(),
      });

      this.peerConnection = pc;
    } catch (err) {
      this.state = "closed";
      const error = err instanceof Error ? err : new Error(String(err));
      new Notice("Failed to start session: " + error.message);
      this.emitter.emit("error", error);
      throw error;
    }
  }

  /** Gracefully stop everything. */
  stopSession() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.getSenders().forEach((s) => s.track?.stop());
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.state = "closed";
    this.emitter.emit("sessionStopped");
  }

  /* ────────────────────────  I n t e r n a l  ─────────────────────── */

  /**
   * Send a JSON event.  UI-only fields are **removed** before transmit.
   */
  private sendClientEvent(event: any) {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      console.error("No open data channel", event);
      return;
    }

    const outbound = structuredClone(event);
    outbound.event_id ??= crypto.randomUUID();
    delete outbound.timestamp; // server rejects extras

    this.dataChannel.send(JSON.stringify(outbound));

    // keep a pretty log with timestamp
    event.event_id = outbound.event_id;
    event.timestamp ??= new Date().toLocaleTimeString();
    this.events.push(event);
  }

  /** Wire up handlers and push session.update after the channel opens. */
  private attachDataChannel(dc: RTCDataChannel) {
    this.dataChannel = dc;

    dc.addEventListener("open", () => {
      this.state = "open";
      this.events = [];
      this.emitter.emit("sessionStarted");

      /* Switch to transcription mode */
      this.sendClientEvent({
        type: "session.update",
        session: {
          input_audio_transcription: {
            model: "gpt-4o-transcribe",
            language: "en",
          },
          turn_detection: {
            // type: "server_vad",
            type: "semantic_vad",
            // eagerness: "high",
            // threshold: 0.6,
            // prefix_padding_ms: 300,
            // silence_duration_ms: 650,
            create_response: false,
            interrupt_response: false,
          },
          input_audio_noise_reduction: { type: "near_field" },
        },
      });
    });

    dc.addEventListener("message", (e) => {
      const evt = JSON.parse(e.data);
      evt.timestamp ??= new Date().toLocaleTimeString();
      this.events.push(evt);

      /* Emittery: route transcription events to the UI */
      if (evt.type === "conversation.item.input_audio_transcription.delta") {
        this.emitter.emit("delta", evt.delta as string);
      } else if (
        evt.type === "conversation.item.input_audio_transcription.completed"
      ) {
        this.emitter.emit("final", evt.transcript as string);
      }
    });

    dc.addEventListener("close", () => {
      this.state = "closed";
      this.emitter.emit("sessionStopped");
    });

    dc.addEventListener("error", (err) => {
      console.error("Data channel error", err);
      // @ts-expect-error fixme err type
      this.emitter.emit("error", err);
    });
  }
}
