// Keeps the last 30 s of every channel (raw counts, µV, and µV through the display filter)
// for the waveform, spectrum and quality views. Subscribe it to the pipeline.

import { Ring } from './ring.js';
import { createDisplayFilter } from './filters.js';

const SECONDS = 30; // BUFFER_SECONDS in neeg_monitor.py

export class SignalStore {
  constructor({ channels, fs, mode = 'bp' }) {
    this.channels = channels;
    this.fs = fs;
    this.mode = mode;
    const cap = Math.round(SECONDS * fs);
    this.counts = Array.from({ length: channels }, () => new Ring(cap, Int32Array));
    this.uv = Array.from({ length: channels }, () => new Ring(cap));
    this.view = Array.from({ length: channels }, () => new Ring(cap));
    this.filters = Array.from({ length: channels }, () => createDisplayFilter(mode, fs));
    this.lastIndex = -1;
  }

  push(batch) {
    for (const s of batch) {
      for (let ch = 0; ch < this.channels; ch++) {
        this.counts[ch].push(s.counts[ch]);
        this.uv[ch].push(s.uv[ch]);
        this.view[ch].push(this.filters[ch].process(s.uv[ch]));
      }
      this.lastIndex = s.index;
    }
  }

  // Re-run the whole buffered history through the new filter so the plot switches instantly.
  setMode(mode) {
    this.mode = mode;
    for (let ch = 0; ch < this.channels; ch++) {
      this.filters[ch] = createDisplayFilter(mode, this.fs);
      const hist = this.uv[ch].latest();
      this.view[ch].clear();
      for (const x of hist) this.view[ch].push(this.filters[ch].process(x));
    }
  }

  reset() {
    for (let ch = 0; ch < this.channels; ch++) {
      this.counts[ch].clear(); this.uv[ch].clear(); this.view[ch].clear();
      this.filters[ch].reset();
    }
    this.lastIndex = -1;
  }

  get length() { return this.uv[0]?.length ?? 0; }

  // kind: 'counts' | 'uv' | 'view'
  latest(kind, ch, n) { return this[kind][ch].latest(n); }
}
