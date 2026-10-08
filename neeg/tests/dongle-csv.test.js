import { createDongleCsvDecoder, parseDongleLine } from '../decoders/dongle-csv.js';
import { NEEG_AA_V1 } from '../decoders/formats.js';
import { test, assertEqual, rng, splitRandomly } from './harness.js';

const enc = s => [...new TextEncoder().encode(s)];

function decode(text, chunks = 1) {
  const msgs = [];
  const d = createDongleCsvDecoder(NEEG_AA_V1, { onMessage: m => msgs.push(m) });
  const bytes = enc(text);
  const parts = chunks === 1 ? [bytes] : splitRandomly(bytes, rng(chunks), 7);
  const samples = parts.flatMap(p => d.push(Uint8Array.from(p)));
  return { samples, stats: d.stats, msgs };
}

test('dongle csv: v2 six columns', () => {
  assertEqual(parseDongleLine('50,-123,456,7,1,1000'),
    { battery: 50, counts: [-123, 456], seq: 7, fresh: 1, ms: 1000, devSeq: null });
});

test('dongle csv: v2 seven columns carries dev_seq', () => {
  const { samples } = decode('80,1,2,3,1,99,42\n');
  assertEqual(samples, [{ counts: [1, 2], battery: 80, deviceSeq: 42, extra: { dongleSeq: 3, dongleMs: 99 } }]);
});

test('dongle csv: legacy ten columns (no seq/fresh)', () => {
  const { samples } = decode('33,-8388608,8388607,0,0,0,0,0,0,123456\r\n');
  assertEqual(samples, [{ counts: [-8388608, 8388607], battery: 33, extra: { dongleSeq: null, dongleMs: 123456 } }]);
});

test('dongle csv: fresh=0 filler rows are dropped and counted', () => {
  const { samples, stats } = decode('50,1,1,1,1,8\n50,1,1,2,0,16\n50,2,2,3,1,24\n');
  assertEqual(samples.map(s => s.counts[0]), [1, 2]);
  assertEqual(stats.fillerDropped, 1);
});

test('dongle csv: diagnostics lines go to onMessage, not samples', () => {
  const { samples, msgs, stats } = decode('[BOOT] reset reason 1\n[STATE] connected (t=5 ms)\n50,1,2,1,1,8\n');
  assertEqual(msgs, ['[BOOT] reset reason 1', '[STATE] connected (t=5 ms)']);
  assertEqual(samples.length, 1);
  assertEqual(stats.messages, 2);
});

test('dongle csv: malformed lines are rejected', () => {
  const { samples, stats } = decode('hello\n101,1,2,1,1,8\n50,1\n50,a,2,1,1,8\n50,1,2,x,1,8\n50,1,2,1,1,8\n');
  assertEqual(samples.length, 1);
  assertEqual(stats.rejected, 5);
});

test('dongle csv: lines split across arbitrary chunks', () => {
  const rows = Array.from({ length: 300 }, (_, i) => `${i % 101},${i * 7 - 1000},${-i},${i + 1},1,${i * 8}`);
  const { samples } = decode(rows.join('\r\n') + '\r\n', 5);
  assertEqual(samples.map(s => s.counts), rows.map((_, i) => [i * 7 - 1000, -i]));
});
