import { Recorder, recordingBaseName } from '../pipeline/recorder.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { NEEG_AA_V1, microvoltsPerCount } from '../decoders/formats.js';
import { test, assertEqual, assert, assertClose } from './harness.js';

async function record(format, samples) {
  const p = new Pipeline(format);
  const rec = new Recorder({ format, channelNames: p.channelNames });
  p.on(b => rec.push(b));
  p.push([{ counts: [0, 0] }]); // before start: must not be recorded
  rec.start({ transport: 'sim', label: 'test' });
  for (let i = 0; i < samples.length; i += 10) p.push(samples.slice(i, i + 10), performance.now());
  const out = rec.stop();
  const lines = (await out.csv.text()).trim().split('\n');
  return { header: lines[0].split(','), rows: lines.slice(1).map(l => l.split(',')), meta: out.meta };
}

test('recorder: CSV keeps neeg_monitor.py columns first, then index and time', async () => {
  const { header } = await record(NEEG_AA_V1, [{ counts: [1, 2], battery: 50 }]);
  assertEqual(header, ['epoch_ms', 'elapsed_ms', 'fp1_uV', 'fp2_uV', 'raw0', 'raw1', 'battery', 'seq', 'fresh', 'sample_index', 't_s']);
});

test('recorder: rows hold counts, µV, index and time base', async () => {
  const samples = Array.from({ length: 10000 }, (_, i) => ({ counts: [i - 5000, -i], battery: i % 101 }));
  const { rows, meta } = await record(NEEG_AA_V1, samples);
  assertEqual(rows.length, 10000);
  const k = microvoltsPerCount(NEEG_AA_V1);
  const r = rows[1234];
  assertEqual(+r[4], 1234 - 5000, 'raw0');
  assertEqual(+r[5], -1234, 'raw1');
  assertClose(+r[2], (1234 - 5000) * k, 1e-4, 'fp1_uV');
  assertEqual(+r[6], 1234 % 101, 'battery');
  assertEqual(+r[9], 1235, 'sample_index (one sample was pushed before start)');
  assertEqual(+r[8], 1, 'fresh');
  assertEqual(r[10], (1235 / 125).toFixed(3), 't_s');
  assertEqual(meta.samples, 10000);
  assertEqual(meta.firstSampleIndex, 1);
  assertEqual(meta.channels, ['Fp1', 'Fp2']);
  assertClose(meta.scale.uvPerCount, k, 1e-15);
  assertEqual(meta.protocol.sync, ['0xaa']);
});

test('recorder: adds dev_seq when the format carries a device sequence number', async () => {
  const fmt = { ...NEEG_AA_V1, fields: [{ name: 'seq', type: 'u16be' }, ...NEEG_AA_V1.fields] };
  const { header, rows } = await record(fmt, [{ counts: [1, 2], battery: 9, deviceSeq: 77 }]);
  assertEqual(header[header.length - 1], 'dev_seq');
  assertEqual(rows[0][header.length - 1], '77');
});

test('recorder: file name uses local date and time', () => {
  assertEqual(recordingBaseName(new Date(2026, 9, 8, 7, 5, 3)), 'neeg_20261008_070503');
});

test('recorder: one hour of 2-channel data stays small', async () => {
  const p = new Pipeline(NEEG_AA_V1);
  const rec = new Recorder({ format: NEEG_AA_V1, channelNames: p.channelNames });
  p.on(b => rec.push(b));
  rec.start();
  const batch = Array.from({ length: 125 }, () => ({ counts: [123456, -654321], battery: 50 }));
  const t = performance.now();
  for (let s = 0; s < 3600; s++) p.push(batch);
  assertEqual(rec.sampleCount, 450000);
  const out = rec.stop();
  assert(out.csv.size > 20e6 && out.csv.size < 60e6, `CSV size ${out.csv.size}`);
  assert(performance.now() - t < 15000, 'took too long');
});
