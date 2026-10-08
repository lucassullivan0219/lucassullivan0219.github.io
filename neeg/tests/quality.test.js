import { computePsd, bandPower, fft } from '../pipeline/spectrum.js';
import { evaluateChannel } from '../pipeline/quality.js';
import { test, assertEqual, assert, assertClose, rng } from './harness.js';

const FS = 125, ADC_MAX = 8388607;
const UV_PER_COUNT = 2.39e6 / 24 / ADC_MAX;

function signal(seconds, fn) {
  return Float64Array.from({ length: Math.round(seconds * FS) }, (_, i) => fn(i / FS));
}
const toCounts = uv => Int32Array.from(uv, v => Math.round(v / UV_PER_COUNT));

test('fft: matches a direct DFT on random input', () => {
  const rand = rng(9);
  const n = 16;
  const x = Array.from({ length: n }, () => rand() - 0.5);
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  for (let k = 0; k < n; k++) {
    let dr = 0, di = 0;
    for (let t = 0; t < n; t++) { dr += x[t] * Math.cos(2 * Math.PI * k * t / n); di -= x[t] * Math.sin(2 * Math.PI * k * t / n); }
    assertClose(re[k], dr, 1e-9, `re[${k}]`);
    assertClose(im[k], di, 1e-9, `im[${k}]`);
  }
});

test('psd: a 10 Hz sine peaks at 10 Hz', () => {
  const spec = computePsd(signal(4, t => 20 * Math.sin(2 * Math.PI * 10 * t) + 500), FS);
  let best = 0;
  for (let k = 1; k < spec.psd.length; k++) if (spec.psd[k] > spec.psd[best]) best = k;
  assertClose(spec.freqs[best], 10, spec.freqs[1], 'peak frequency');
});

test('psd: band power ratio picks out a mains component', () => {
  const spec = computePsd(signal(2, t => 10 * Math.sin(2 * Math.PI * 10 * t) + 10 * Math.sin(2 * Math.PI * 60 * t)), FS);
  const ratio = bandPower(spec, 58, 62) / bandPower(spec, 1, 65);
  assertClose(ratio, 0.5, 0.05);
});

const rand = rng(11);
const eeg = t => 15 * Math.sin(2 * Math.PI * 10 * t) + 8 * Math.sin(2 * Math.PI * 6 * t + 1) + 6 * (rand() - 0.5);
const evalUv = (uv, lf = 60) => evaluateChannel(toCounts(uv), uv, FS, lf, ADC_MAX);

test('quality: clean EEG-like signal is good', () => {
  const q = evalUv(signal(2, eeg));
  assertEqual(q.level, 'good', q.reason);
});

test('quality: saturated samples are railed / bad', () => {
  const uv = signal(2, eeg);
  const full = ADC_MAX * UV_PER_COUNT;
  for (let i = 0; i < 30; i++) uv[i * 8] = full * 0.99; // 12% of samples
  const q = evalUv(uv);
  assertEqual(q.level, 'bad');
  assert(q.railedPct > 5, `railed ${q.railedPct}`);
});

test('quality: a constant signal is flat / bad', () => {
  const q = evalUv(signal(2, () => 123));
  assertEqual(q.level, 'bad');
  assert(q.reason.startsWith('Flat'), q.reason);
});

test('quality: strong mains noise is bad at 60 Hz but not counted at 50 Hz', () => {
  const uv = signal(2, t => eeg(t) + 40 * Math.sin(2 * Math.PI * 60 * t));
  assertEqual(evalUv(uv, 60).level, 'bad');
  assert(evalUv(uv, 50).lineRatio < 0.3, 'mains ratio at 50 Hz');
});

test('quality: slow drift is a warning', () => {
  const q = evalUv(signal(2, t => eeg(t) + 80 * t));
  assertEqual(q.level, 'warn');
  assertClose(q.driftUvPerS, 80, 5);
});

test('quality: under half a second is not evaluated', () => {
  assertEqual(evalUv(signal(0.3, eeg)).level, 'na');
});
