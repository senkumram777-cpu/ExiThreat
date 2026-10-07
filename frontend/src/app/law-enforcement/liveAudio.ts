/**
 * Plays a ProMic live stream in the browser.
 *
 * The Host's phone sends audio through ProMic's relay as binary WebSocket frames (ProMic repo,
 * AudioFrameCodec.kt): a 60-byte header (36 bytes user id, then 8-byte timestamp, latitude and
 * longitude) followed by the audio, which is AES-256-GCM encrypted as IV(12) || ciphertext ||
 * tag(16) (AudioEncryption.kt). Decrypted, it is 16 kHz mono 16-bit little-endian PCM. The relay
 * only ever forwards ciphertext; the key comes from ProMic's leJoinLive endpoint.
 */

export interface LiveTicket {
  url: string;
  room: string;
  userId: string;
  key: string;
}

export type LiveState = 'connecting' | 'waiting' | 'playing' | 'ended';

const HEADER_BYTES = 60;
const IV_BYTES = 12;
const SAMPLE_RATE = 16000;
// Audio is scheduled slightly ahead so small network gaps do not click.
const LEAD_SECONDS = 0.2;
// If playback has fallen this far behind the Host, skip ahead: live matters more than complete.
const MAX_LAG_SECONDS = 2;

export class LivePlayer {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private nextStart = 0;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly onState: (state: LiveState) => void) {}

  /** Must be called from a click, or the browser will not allow sound. */
  async start(ticket: LiveTicket): Promise<void> {
    this.onState('connecting');
    const raw = Uint8Array.from(atob(ticket.key), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
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
    const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;

    const now = context.currentTime;
    if (this.nextStart < now + 0.02 || this.nextStart > now + MAX_LAG_SECONDS) this.nextStart = now + LEAD_SECONDS;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(this.nextStart);
    this.nextStart += buffer.duration;
    this.onState('playing');
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
    this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
