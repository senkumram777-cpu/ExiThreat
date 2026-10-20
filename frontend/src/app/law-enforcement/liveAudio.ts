/**
 * Plays a ProMic live stream in the browser, and lets the officer speak back when ProMic allows it.
 *
 * The Host's phone sends audio through ProMic's relay as binary WebSocket frames (ProMic repo,
 * AudioFrameCodec.kt): a 60-byte header (36 bytes user id, then 8-byte timestamp, latitude and
 * longitude) followed by the audio, which is AES-256-GCM encrypted as IV(12) || ciphertext ||
 * tag(16) (AudioEncryption.kt). Decrypted, it is Opus (ProMic repo, LiveOpus.kt): a format byte
 * (1), then 20 ms packets of 16 kHz mono, each as a 2-byte big-endian length and the packet. The
 * relay only ever forwards ciphertext; the key comes from ProMic's leJoinLive endpoint.
 *
 * Talk-back is the same frame going the other way, on the same socket and with the same key, but
 * with 16 kHz mono 16-bit little-endian PCM inside rather than Opus. The
 * relay hands a listener's frames to the Host's phone only, and the phone plays them only once a
 * check-in has gone unanswered (ProMic repo, HostCheckIn.kt), so sending before that does nothing.
 */

import type { OpusDecoder } from 'opus-decoder';

export interface LiveTicket {
  url: string;
  room: string;
  userId: string;
  key: string;
}

export type LiveState = 'connecting' | 'waiting' | 'playing' | 'ended';

const HEADER_BYTES = 60;
const USER_ID_BYTES = 36;
const IV_BYTES = 12;
const FORMAT_OPUS = 1;
const SAMPLE_RATE = 16000;
// Audio is scheduled slightly ahead so small network gaps do not click.
const LEAD_SECONDS = 0.2;
// If playback has fallen this far behind the Host, skip ahead: live matters more than complete.
const MAX_LAG_SECONDS = 2;
// After the officer stops speaking, the stream stays silent this long: the Host's microphone is
// still picking up the end of what was just played from their phone.
const ECHO_GUARD_MS = 1200;

interface Microphone {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: ScriptProcessorNode;
}

export class LivePlayer {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private key: CryptoKey | null = null;
  private opus: OpusDecoder<16000> | null = null;
  private userId = '';
  private nextStart = 0;
  private queue: Promise<void> = Promise.resolve();
  private outgoing: Promise<void> = Promise.resolve();
  private stopped = false;
  private wantTalk = false;
  private muted = false;
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;
  private microphone: Microphone | null = null;

  constructor(
    private readonly onState: (state: LiveState) => void,
    /** Where the Host's phone was when it sent each frame, when it knew (the header's lat/lon). */
    private readonly onPosition: (lat: number, lon: number, ts: number) => void = () => undefined,
  ) {}

  /** Must be called from a click, or the browser will not allow sound. */
  async start(ticket: LiveTicket): Promise<void> {
    this.onState('connecting');
    const raw = Uint8Array.from(atob(ticket.key), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt', 'encrypt']);
    this.key = key;
    this.userId = ticket.userId;
    // libopus, compiled to WebAssembly: plays the same in every browser.
    const { OpusDecoder } = await import('opus-decoder');
    const opus = new OpusDecoder({ sampleRate: SAMPLE_RATE, channels: 1 });
    await opus.ready;
    this.opus = opus;
    this.context = new AudioContext();
    await this.context.resume();

    const socket = new WebSocket(
      `${ticket.url}?room=${encodeURIComponent(ticket.room)}&userId=${encodeURIComponent(ticket.userId)}`,
    );
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onopen = () => this.onState('waiting');
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const frame = event.data;
      // Frames are decrypted one after another so they are played in the order they arrived.
      this.queue = this.queue.then(() => this.play(frame, key)).catch(() => undefined);
    };
    socket.onclose = () => {
      if (!this.stopped) this.onState('ended');
    };
    socket.onerror = () => socket.close();
  }

  private async play(frame: ArrayBuffer, key: CryptoKey): Promise<void> {
    const context = this.context;
    if (this.stopped || !context || frame.byteLength <= HEADER_BYTES + IV_BYTES) return;
    const iv = frame.slice(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
    let pcm: ArrayBuffer;
    try {
      pcm = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, frame.slice(HEADER_BYTES + IV_BYTES));
    } catch {
      return; // not for this session's key (for example, the Host restarted the stream)
    }
    // Header numbers are big-endian (Java's ByteBuffer); 0, 0 means the phone had no fix.
    const header = new DataView(frame, USER_ID_BYTES, 24);
    const lat = header.getFloat64(8);
    const lon = header.getFloat64(16);
    if (lat !== 0 && lon !== 0 && Number.isFinite(lat) && Number.isFinite(lon)) {
      this.onPosition(lat, lon, Number(header.getBigInt64(0)));
    }
    const samples = this.decodeOpus(new Uint8Array(pcm));
    // The officer's own voice would come straight back from the Host's microphone. (Decoded all
    // the same, so the decoder keeps up with the stream.)
    if (this.muted || !samples || samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);

    const now = context.currentTime;
    if (this.nextStart < now + 0.02 || this.nextStart > now + MAX_LAG_SECONDS) this.nextStart = now + LEAD_SECONDS;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(this.nextStart);
    this.nextStart += buffer.duration;
    this.onState('playing');
  }

  /** The frame's 20 ms packets, decoded and joined; null if it isn't Opus or is cut short. */
  private decodeOpus(payload: Uint8Array): Float32Array<ArrayBuffer> | null {
    const opus = this.opus;
    if (!opus || payload.length === 0 || payload[0] !== FORMAT_OPUS) return null;
    const parts: Float32Array[] = [];
    let total = 0;
    let at = 1;
    while (at < payload.length) {
      if (at + 2 > payload.length) return null;
      const length = (payload[at] << 8) | payload[at + 1];
      at += 2;
      if (length === 0 || at + length > payload.length) return null;
      const decoded = opus.decodeFrame(payload.subarray(at, at + length));
      at += length;
      const channel = decoded.channelData[0];
      if (channel && decoded.samplesDecoded > 0) {
        parts.push(channel.subarray(0, decoded.samplesDecoded));
        total += decoded.samplesDecoded;
      }
    }
    const out = new Float32Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  /**
   * Hold to talk: sends the officer's microphone to the Host's phone until stopTalking(). Throws
   * when the browser will not give the microphone.
   */
  async startTalking(): Promise<void> {
    if (this.wantTalk || this.stopped || !this.socket || !this.key) return;
    this.wantTalk = true;
    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      .catch((err) => {
        this.wantTalk = false;
        throw err;
      });
    // The button may have been let go while the browser was still asking for permission.
    if (!this.wantTalk || this.stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const node = context.createScriptProcessor(4096, 1, 1);
    const step = context.sampleRate / SAMPLE_RATE;
    let position = 0;
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      // Down to 16 kHz by averaging each run of input samples that makes up one output sample.
      const out: number[] = [];
      while (position + step <= input.length) {
        const from = Math.floor(position);
        const to = Math.max(from + 1, Math.floor(position + step));
        let sum = 0;
        for (let i = from; i < to; i++) sum += input[i];
        out.push(sum / (to - from));
        position += step;
      }
      position -= input.length;
      if (position < 0) position = 0;
      if (out.length > 0) this.send(Int16Array.from(out, (v) => Math.max(-1, Math.min(1, v)) * 32767));
    };
    source.connect(node);
    // A script processor only runs while it leads somewhere; it writes nothing, so this is silent.
    node.connect(context.destination);
    this.microphone = { stream, context, source, node };
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
    this.muted = true;
  }

  stopTalking(): void {
    this.wantTalk = false;
    const microphone = this.microphone;
    if (!microphone) return;
    this.microphone = null;
    microphone.node.onaudioprocess = null;
    microphone.source.disconnect();
    microphone.node.disconnect();
    microphone.stream.getTracks().forEach((track) => track.stop());
    microphone.context.close().catch(() => undefined);
    this.unmuteTimer = setTimeout(() => {
      this.muted = false;
    }, ECHO_GUARD_MS);
  }

  /** One talk-back frame, built the way the Host's phone expects (see the header comment). */
  private send(samples: Int16Array): void {
    const key = this.key;
    const socket = this.socket;
    if (!key || !socket || socket.readyState !== WebSocket.OPEN) return;
    const pcm = new Uint8Array(samples.byteLength);
    pcm.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    // Encrypted one after another so the frames leave in the order they were spoken.
    this.outgoing = this.outgoing
      .then(async () => {
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
        const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pcm));
        const frame = new Uint8Array(HEADER_BYTES + IV_BYTES + cipher.length);
        frame.set(new TextEncoder().encode(this.userId.padEnd(USER_ID_BYTES).slice(0, USER_ID_BYTES)), 0);
        // Timestamp as a big-endian 64-bit integer; latitude and longitude stay zero.
        new DataView(frame.buffer).setBigInt64(USER_ID_BYTES, BigInt(Date.now()));
        frame.set(iv, HEADER_BYTES);
        frame.set(cipher, HEADER_BYTES + IV_BYTES);
        if (socket.readyState === WebSocket.OPEN) socket.send(frame);
      })
      .catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    this.stopTalking();
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
    this.socket?.close();
    this.socket = null;
    this.context?.close().catch(() => undefined);
    this.context = null;
    this.opus?.free();
    this.opus = null;
  }
}
