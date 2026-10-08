// Simulator transport: synthesises EEG-like signals, encodes them with the active packet
// format and emits the bytes in random-sized chunks, like BLE notifications do.
// Same events as the other transports ('data', 'state', 'log').

import { encodeFrame } from '../decoders/framed.js';
import { microvoltsPerCount, channelCount } from '../decoders/formats.js';

const TICK_MS = 40;

export class SimTransport extends EventTarget {
  kind = 'sim';
  output = 'bytes';
  connected = false;
  #timer = 0;
  #n = 0;
  #carry = 0;

  constructor(format) {
    super();
    this.format = format;
  }

  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // Per channel: 10 Hz alpha with a different phase, 60 Hz mains, noise and a DC offset.
  #signal(ch, t) {
    return 20 * Math.sin(2 * Math.PI * 10 * t + ch) + 5 * Math.sin(2 * Math.PI * 60 * t) +
      4 * (Math.random() - 0.5) + 300 * ch;
  }

  async connect() {
    const { fs } = this.format;
    const nch = channelCount(this.format);
    const perCount = microvoltsPerCount(this.format);
    this.#n = 0;
    this.#carry = 0;
    this.#timer = setInterval(() => {
      // Keep the long-run rate exact even though 125 Hz × 40 ms isn't always an integer.
      this.#carry += fs * TICK_MS / 1000;
      const count = Math.floor(this.#carry);
      this.#carry -= count;
      const bytes = [];
      for (let k = 0; k < count; k++, this.#n++) {
        const t = this.#n / fs;
        const counts = Array.from({ length: nch }, (_, ch) => Math.round(this.#signal(ch, t) / perCount));
        bytes.push(...encodeFrame(this.format, { battery: 50, counts }));
      }
      for (let i = 0; i < bytes.length;) {
        const size = 1 + Math.floor(Math.random() * 20);
        this.#emit('data', Uint8Array.from(bytes.slice(i, i + size)));
        i += size;
      }
    }, TICK_MS);
    this.connected = true;
    this.#emit('log', 'simulator started (10 Hz + 60 Hz + noise, random chunks of 1–20 B)');
    this.#emit('state', { state: 'connected' });
    return { deviceName: 'Simulator' };
  }

  async disconnect() {
    clearInterval(this.#timer);
    if (!this.connected) return;
    this.connected = false;
    this.#emit('log', 'simulator stopped');
    this.#emit('state', { state: 'disconnected' });
  }
}
