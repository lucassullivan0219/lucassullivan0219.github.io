// In-memory recorder. Produces a CSV compatible with neeg_monitor.py recordings plus extra
// columns, and a JSON sidecar with the protocol, scaling and timing metadata.
//
// CSV columns (first nine match neeg_monitor.py):
//   epoch_ms, elapsed_ms   browser arrival time (bursty; for debugging, not the time base)
//   <ch>_uV …, raw0 …      µV and raw ADC counts per channel
//   battery, seq, fresh    seq = receiver frame counter (1-based, like the ESP32 dongle's);
//                          fresh = 1 (every row is a decoded frame, never a filler)
//   sample_index, t_s      the time base: t_s = sample_index / fs
//   dev_seq                only if the packet format carries a device sequence number

import { microvoltsPerCount } from '../decoders/formats.js';

const CHUNK = 4096;

export class Recorder {
  recording = false;
  #chunks = [];
  #n = 0;

  constructor({ format, channelNames }) {
    this.format = format;
    this.channelNames = channelNames;
    this.uvPerCount = microvoltsPerCount(format);
    this.hasDevSeq = format.fields.some(f => f.name === 'seq');
  }

  get sampleCount() { return this.#n; }
  get durationS() { return this.recording ? (Date.now() - this.startEpoch) / 1000 : this.durationAtStop ?? 0; }

  start(info = {}) {
    this.#chunks = [];
    this.#n = 0;
    this.info = info;
    this.startEpoch = Date.now();
    // performance.now() → epoch, so arrival times keep sub-ms precision.
    this.perfToEpoch = this.startEpoch - performance.now();
    this.firstIndex = null;
    this.recording = true;
  }

  #newChunk() {
    const nch = this.channelNames.length;
    const c = {
      n: 0,
      index: new Float64Array(CHUNK),
      arrival: new Float64Array(CHUNK),
      battery: new Int16Array(CHUNK),
      devSeq: new Float64Array(CHUNK),
      counts: Array.from({ length: nch }, () => new Int32Array(CHUNK)),
    };
    this.#chunks.push(c);
    return c;
  }

  push(batch) {
    if (!this.recording) return;
    let c = this.#chunks[this.#chunks.length - 1];
    for (const s of batch) {
      if (!c || c.n === CHUNK) c = this.#newChunk();
      const i = c.n++;
      if (this.firstIndex === null) this.firstIndex = s.index;
      c.index[i] = s.index;
      c.arrival[i] = s.arrivalMs + this.perfToEpoch;
      c.battery[i] = s.battery ?? -1;
      c.devSeq[i] = s.deviceSeq ?? NaN;
      for (let ch = 0; ch < c.counts.length; ch++) c.counts[ch][i] = s.counts[ch];
      this.#n++;
    }
  }

  stop() {
    if (!this.recording) return null;
    this.recording = false;
    this.stopEpoch = Date.now();
    this.durationAtStop = (this.stopEpoch - this.startEpoch) / 1000;
    return { csv: this.#csv(), meta: this.#meta() };
  }

  #csv() {
    const fs = this.format.fs;
    const k = this.uvPerCount;
    const nch = this.channelNames.length;
    const header = [
      'epoch_ms', 'elapsed_ms',
      ...this.channelNames.map(n => `${n.toLowerCase()}_uV`),
      ...this.channelNames.map((_, i) => `raw${i}`),
      'battery', 'seq', 'fresh', 'sample_index', 't_s',
      ...(this.hasDevSeq ? ['dev_seq'] : []),
    ].join(',') + '\n';
    const parts = [header];
    for (const c of this.#chunks) {
      let text = '';
      for (let i = 0; i < c.n; i++) {
        const idx = c.index[i];
        const row = [
          Math.round(c.arrival[i]), Math.round(c.arrival[i] - this.startEpoch),
        ];
        for (let ch = 0; ch < nch; ch++) row.push((c.counts[ch][i] * k).toFixed(4));
        for (let ch = 0; ch < nch; ch++) row.push(c.counts[ch][i]);
        row.push(c.battery[i] < 0 ? '' : c.battery[i], idx + 1, 1, idx, (idx / fs).toFixed(3));
        if (this.hasDevSeq) row.push(Number.isNaN(c.devSeq[i]) ? '' : c.devSeq[i]);
        text += row.join(',') + '\n';
      }
      parts.push(text);
    }
    return new Blob(parts, { type: 'text/csv' });
  }

  #meta() {
    const f = this.format;
    return {
      app: 'NEEG-2 web receiver',
      protocol: {
        id: f.id, version: f.version,
        sync: f.sync.map(b => '0x' + b.toString(16).padStart(2, '0')),
        fields: f.fields.map(({ name, type, count }) => ({ name, type, count: count ?? 1 })),
        checksum: f.checksum,
      },
      fs: f.fs,
      scale: { ...f.scale, uvPerCount: this.uvPerCount, formula: 'uV = count / adcMax * vref * 1e6 / gain' },
      channels: this.channelNames,
      start: new Date(this.startEpoch).toISOString(),
      end: new Date(this.stopEpoch).toISOString(),
      durationS: this.durationAtStop,
      samples: this.#n,
      firstSampleIndex: this.firstIndex,
      expectedSamples: Math.round(this.durationAtStop * f.fs),
      device: this.info,
      userAgent: navigator.userAgent,
      timeBase: 't_s = sample_index / fs. epoch_ms/elapsed_ms are browser arrival times; BLE delivers samples in bursts, so use them only for debugging and gap checks.',
      columns: {
        seq: 'receiver frame counter, 1-based (same meaning as the ESP32 dongle seq)',
        fresh: 'always 1: every row is a decoded frame. The sensor may still repeat its last sample when the ADC has no new data; that cannot be detected without a device sequence number.',
      },
    };
  }
}

export function recordingBaseName(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `neeg_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

// Screen Wake Lock while recording (keeps a phone from sleeping). Re-acquired when the page
// becomes visible again, because the browser releases it whenever the page is hidden.
export function createWakeLock(log) {
  let lock = null, wanted = false;
  const supported = 'wakeLock' in navigator;
  async function acquire() {
    if (!supported || !wanted || document.hidden) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch (e) { log(`wake lock failed: ${e.message}`); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) acquire(); });
  return {
    supported,
    get active() { return !!lock; },
    async on() { wanted = true; await acquire(); if (lock) log('screen wake lock on'); },
    async off() { wanted = false; if (lock) { await lock.release(); log('screen wake lock off'); } lock = null; },
  };
}
