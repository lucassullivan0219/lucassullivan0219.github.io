// Pipeline: consumes standardised samples from any decoder and assigns the time base.
// Time is sampleIndex / fs (BLE delivers samples in bursts, so arrival time is kept only
// for debugging). Channel count comes from the decoder's format, never hard-coded.
//
// Consumers subscribe with on(fn); fn receives an array of
//   { index, t, counts: number[], uv: number[], battery?, deviceSeq?, arrivalMs }

import { microvoltsPerCount, channelCount } from '../decoders/formats.js';

export class Pipeline {
  #listeners = new Set();
  #rateCount = 0;

  constructor(format) {
    this.setFormat(format);
  }

  setFormat(format) {
    this.format = format;
    this.fs = format.fs;
    this.channels = channelCount(format);
    this.channelNames = format.channelNames ?? Array.from({ length: this.channels }, (_, i) => `ch${i}`);
    this.uvPerCount = microvoltsPerCount(format);
    this.reset();
  }

  reset() {
    this.index = 0;
    this.last = null;
    this.rate = null;
    this.#rateCount = 0;
  }

  on(fn) { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }

  push(samples, arrivalMs = performance.now()) {
    if (!samples.length) return;
    const batch = samples.map(s => ({
      index: this.index,
      t: this.index++ / this.fs,
      counts: s.counts,
      uv: s.counts.map(c => c * this.uvPerCount),
      battery: s.battery,
      deviceSeq: s.deviceSeq,
      arrivalMs,
    }));
    this.last = batch[batch.length - 1];
    this.#rateCount += batch.length;
    for (const fn of this.#listeners) fn(batch);
  }

  // Call once per second to update the measured sample rate.
  tickRate() {
    this.rate = this.#rateCount;
    this.#rateCount = 0;
    return this.rate;
  }
}
