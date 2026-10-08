import { Ring } from '../pipeline/ring.js';
import { createDisplayFilter, butterworth } from '../pipeline/filters.js';
import { SignalStore } from '../pipeline/store.js';
import { test, assertEqual, assert, assertClose } from './harness.js';

const FS = 125;

// Steady-state amplitude of a filter's response to a unit sine at f Hz.
function gainAt(mode, f, seconds = 20) {
  const filt = createDisplayFilter(mode, FS);
  const n = seconds * FS;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const y = filt.process(Math.sin(2 * Math.PI * f * i / FS));
    if (i > n / 2) peak = Math.max(peak, Math.abs(y));
  }
  return peak;
}

test('ring: keeps the newest values in order across wrap-around', () => {
  const r = new Ring(4);
  for (let i = 1; i <= 6; i++) r.push(i);
  assertEqual([...r.latest()], [3, 4, 5, 6]);
  assertEqual([...r.latest(2)], [5, 6]);
  assertEqual([...r.latest(10)], [3, 4, 5, 6]);
});

test('band-pass: passes 10 Hz', () => assertClose(gainAt('bp', 10), 1, 0.05));
test('band-pass: passes 3 Hz and 40 Hz within 1 dB', () => {
  assert(gainAt('bp', 3) > 0.89, `3 Hz gain ${gainAt('bp', 3)}`);
  assert(gainAt('bp', 40) > 0.89, `40 Hz gain ${gainAt('bp', 40)}`);
});
test('band-pass: about −3 dB at the 1 Hz and 50 Hz corners', () => {
  assertClose(gainAt('bp', 1, 60), Math.SQRT1_2, 0.05, '1 Hz');
  assertClose(gainAt('bp', 50), Math.SQRT1_2, 0.05, '50 Hz');
});
test('band-pass: rejects 0.2 Hz drift and 60 Hz mains', () => {
  assert(gainAt('bp', 0.2, 100) < 0.01, `0.2 Hz gain ${gainAt('bp', 0.2, 100)}`);
  assert(gainAt('bp', 60) < 0.05, `60 Hz gain ${gainAt('bp', 60)}`);
});

test('band-pass: no start-up spike from a large DC offset', () => {
  const f = createDisplayFilter('bp', FS);
  let peak = 0;
  for (let i = 0; i < 2 * FS; i++) peak = Math.max(peak, Math.abs(f.process(5000 + 10 * Math.sin(2 * Math.PI * 10 * i / FS))));
  assert(peak < 15, `peak ${peak}`);
});

test('remove DC: output averages to zero and keeps the AC part', () => {
  const f = createDisplayFilter('dc', FS);
  const out = [];
  for (let i = 0; i < 20 * FS; i++) out.push(f.process(300 + 20 * Math.sin(2 * Math.PI * 10 * i / FS)));
  const tail = out.slice(-5 * FS);
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  assertClose(mean, 0, 0.5, 'mean');
  assertClose(Math.max(...tail), 20, 1, 'amplitude');
});

test('butterworth: sections are stable (poles inside the unit circle)', () => {
  for (const s of [...butterworth('highpass', 1, FS), ...butterworth('lowpass', 50, FS)]) {
    assert(Math.abs(s.a2) < 1 && Math.abs(s.a1) < 1 + s.a2, `a1=${s.a1} a2=${s.a2}`);
  }
});

test('store: switching mode re-filters history like live streaming would', () => {
  const live = new SignalStore({ channels: 1, fs: FS, mode: 'dc' });
  const switched = new SignalStore({ channels: 1, fs: FS, mode: 'raw' });
  for (let i = 0; i < 1000; i++) {
    const s = [{ index: i, counts: [i], uv: [100 + Math.sin(i / 7)] }];
    live.push(s); switched.push(s);
  }
  switched.setMode('dc');
  const a = live.latest('view', 0, 200), b = switched.latest('view', 0, 200);
  for (let i = 0; i < a.length; i++) assertClose(b[i], a[i], 1e-9, `sample ${i}`);
});
