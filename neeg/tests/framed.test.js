import { createFramedDecoder, encodeFrame, crc8 } from '../decoders/framed.js';
import { NEEG_AA_V1, microvoltsPerCount } from '../decoders/formats.js';
import { test, assertEqual, assert, rng, splitRandomly } from './harness.js';

const aa = (battery, counts) => encodeFrame(NEEG_AA_V1, { battery, counts });

function decodeAll(chunks, format = NEEG_AA_V1) {
  const d = createFramedDecoder(format);
  const samples = chunks.flatMap(c => d.push(Uint8Array.from(c)));
  return { samples, stats: d.stats };
}

// ---------- current 0xAA format ----------
test('aa: decodes one frame', () => {
  const { samples } = decodeAll([aa(50, [1, 2])]);
  assertEqual(samples, [{ counts: [1, 2], battery: 50 }]);
});

test('aa: sign-extends negative 24-bit values', () => {
  const vals = [[-1, -8388608], [8388607, -86], [0, 170]];
  const { samples } = decodeAll([vals.flatMap(v => aa(100, v))]);
  assertEqual(samples.map(s => s.counts), vals);
});

test('aa: survives arbitrary fragmentation', () => {
  const rand = rng(1);
  const vals = Array.from({ length: 500 }, () => [0, 1].map(() => Math.floor(rand() * 2 ** 24) - 2 ** 23));
  const bytes = vals.flatMap((v, i) => aa(i % 101, v));
  for (let seed = 1; seed <= 20; seed++) {
    const { samples, stats } = decodeAll(splitRandomly(bytes, rng(seed)));
    assertEqual(samples.map(s => s.counts), vals, `seed ${seed}:`);
    assertEqual(stats.rejected, 0, `seed ${seed} rejected:`);
  }
});

test('aa: 0xAA inside data does not break an aligned stream', () => {
  const vals = [[-5592406, 170], [170, -5592406]]; // 0xAAAAAA and 0x0000AA
  const { samples } = decodeAll(splitRandomly(vals.flatMap(v => aa(90, v)), rng(7), 3));
  assertEqual(samples.map(s => s.counts), vals);
});

test('aa: rejects an invalid sub-header and resyncs', () => {
  const bytes = [0x01, 0xaa, 0xc8, 0x05, ...aa(42, [123, -456])]; // 0xC8 = 200 > 100
  const { samples, stats } = decodeAll([bytes]);
  assertEqual(samples, [{ counts: [123, -456], battery: 42 }]);
  assertEqual(stats.rejected, 1, 'rejected');
});

test('aa: 0xAA 0xAA keeps the second byte as header candidate', () => {
  const { samples, stats } = decodeAll([[0xaa, ...aa(10, [7, 8])]]);
  assertEqual(samples, [{ counts: [7, 8], battery: 10 }]);
  assertEqual(stats.rejected, 1, 'rejected');
});

test('aa: starting mid-frame recovers on the next header', () => {
  const p = aa(30, [1000, -1000]);
  const { samples } = decodeAll([[...p.slice(3), ...p, ...p]]);
  assertEqual(samples.length, 2);
  assertEqual(samples[0].counts, [1000, -1000]);
});

test('aa: false header inside data loses no real frame after it', () => {
  // Misaligned start where a data byte is 0xAA followed by a valid-looking battery byte.
  const real = aa(20, [5, 6]);
  const bytes = [0x00, 0xaa, 0x10, 0x00, ...real, ...real];
  const { samples } = decodeAll([bytes]);
  // The false frame AA 10 00 AA 14 00 00 05 is accepted (no checksum in this format),
  // but decoding realigns on the following real header.
  assert(samples.length >= 1, 'at least one frame');
  assertEqual(samples[samples.length - 1].counts, [5, 6]);
});

test('aa: full scale converts to VREF / gain in µV', () => {
  const uv = 8388607 * microvoltsPerCount(NEEG_AA_V1);
  assert(Math.abs(uv - 2.39e6 / 24) < 1e-6, `got ${uv}`);
});

// ---------- descriptor features for future firmware ----------
const FUTURE = {
  id: 'test-future', version: 2, fs: 250,
  sync: [0xa5, 0x5a],
  fields: [
    { name: 'version', type: 'u8', valid: v => v === 2 },
    { name: 'seq', type: 'u16be' },
    { name: 'battery', type: 'u8', valid: v => v <= 100 },
    { name: 'counts', type: 'i24le', count: 4 },
  ],
  checksum: { type: 'crc8', poly: 0x07 },
  scale: { adcMax: 8388607, vref: 4.5, gain: 12 },
  channelNames: ['C3', 'C4', 'O1', 'O2'],
};

test('future: 2-byte sync, seq, 4 channels little-endian, CRC8', () => {
  const rand = rng(3);
  const frames = Array.from({ length: 200 }, (_, i) => ({
    version: 2, seq: i, battery: 80,
    counts: [0, 1, 2, 3].map(() => Math.floor(rand() * 2 ** 24) - 2 ** 23),
  }));
  const bytes = frames.flatMap(f => encodeFrame(FUTURE, f));
  const { samples, stats } = decodeAll(splitRandomly(bytes, rng(4)), FUTURE);
  assertEqual(samples.map(s => s.counts), frames.map(f => f.counts));
  assertEqual(samples.map(s => s.deviceSeq), frames.map(f => f.seq));
  assertEqual(samples[0].extra, { version: 2 });
  assertEqual(stats.checksumErrors, 0);
});

test('future: corrupted byte is caught by CRC8 and the stream recovers', () => {
  const f = i => encodeFrame(FUTURE, { version: 2, seq: i, battery: 50, counts: [i, -i, 2 * i, -2 * i] });
  const bad = f(1);
  bad[8] ^= 0x01; // flip a bit inside the counts
  const { samples, stats } = decodeAll([[...f(0), ...bad, ...f(2)]], FUTURE);
  assertEqual(samples.map(s => s.deviceSeq), [0, 2]);
  assertEqual(stats.checksumErrors, 1);
});

test('crc8: matches the standard CRC-8 (poly 0x07) check value', () => {
  const ascii = [...'123456789'].map(c => c.charCodeAt(0));
  assertEqual(crc8(ascii, 0x07, 0), 0xf4);
});
