// Decoder tests. Runs in the browser via test.html (no build step, no Node needed).
import { createAaDecoder, encodeAaPacket, countsToMicrovolts } from './decoder.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assertEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function splitRandomly(bytes, rand, maxChunk = 23) {
  const chunks = [];
  for (let i = 0; i < bytes.length;) {
    const n = 1 + Math.floor(rand() * maxChunk);
    chunks.push(bytes.slice(i, i + n));
    i += n;
  }
  return chunks;
}

function decodeAll(chunks) {
  const d = createAaDecoder();
  const samples = chunks.flatMap(c => d.push(Uint8Array.from(c)));
  return { samples, stats: d.stats };
}

test('decodes one packet', () => {
  const { samples } = decodeAll([encodeAaPacket(50, [1, 2])]);
  assertEqual(samples, [{ channels: [1, 2], battery: 50 }]);
});

test('sign-extends negative values', () => {
  const vals = [[-1, -8388608], [8388607, -86], [0, 170]];
  const bytes = vals.flatMap(v => encodeAaPacket(100, v));
  const { samples } = decodeAll([bytes]);
  assertEqual(samples.map(s => s.channels), vals);
});

test('survives arbitrary fragmentation', () => {
  const rand = rng(1);
  const vals = Array.from({ length: 500 }, () =>
    [0, 1].map(() => Math.floor(rand() * 2 ** 24) - 2 ** 23));
  const bytes = vals.flatMap((v, i) => encodeAaPacket(i % 101, v));
  for (let seed = 1; seed <= 20; seed++) {
    const { samples } = decodeAll(splitRandomly(bytes, rng(seed)));
    assertEqual(samples.map(s => s.channels), vals, `seed ${seed}:`);
  }
});

test('0xAA inside data does not break aligned stream', () => {
  // 0xAAAAAA = -5592406; 0x0000AA = 170
  const vals = [[-5592406, 170], [170, -5592406]];
  const bytes = vals.flatMap(v => encodeAaPacket(0xaa - 0x50, v));
  const { samples } = decodeAll(splitRandomly(bytes, rng(7), 3));
  assertEqual(samples.map(s => s.channels), vals);
});

test('rejects invalid sub-header and resyncs', () => {
  const good = encodeAaPacket(42, [123, -456]);
  // Garbage including a fake header followed by an invalid battery byte (0xC8 > 100).
  const bytes = [0x01, 0xaa, 0xc8, 0x05, ...good];
  const { samples, stats } = decodeAll([bytes]);
  assertEqual(samples, [{ channels: [123, -456], battery: 42 }]);
  assertEqual(stats.rejected, 1, 'rejected');
});

test('0xAA 0xAA keeps second byte as header candidate', () => {
  const bytes = [0xaa, ...encodeAaPacket(10, [7, 8])];
  const { samples, stats } = decodeAll([bytes]);
  assertEqual(samples, [{ channels: [7, 8], battery: 10 }]);
  assertEqual(stats.rejected, 1, 'rejected');
});

test('starting mid-packet recovers on next header', () => {
  const p = encodeAaPacket(30, [1000, -1000]);
  const bytes = [...p.slice(3), ...p, ...p];
  const { samples } = decodeAll([bytes]);
  // The tail of the partial packet contains no 0xAA, so exactly two packets decode.
  assertEqual(samples.length, 2);
  assertEqual(samples[0].channels, [1000, -1000]);
});

test('full-scale counts convert to VREF/gain in microvolts', () => {
  const uv = countsToMicrovolts(8388607);
  if (Math.abs(uv - 2.39e6 / 24) > 1e-6) throw new Error(`got ${uv}`);
});

export function runTests() {
  return tests.map(({ name, fn }) => {
    try { fn(); return { name, ok: true }; }
    catch (e) { return { name, ok: false, error: e.message }; }
  });
}
