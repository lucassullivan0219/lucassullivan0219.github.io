import { Pipeline } from '../pipeline/pipeline.js';
import { NEEG_AA_V1, microvoltsPerCount } from '../decoders/formats.js';
import { createFramedDecoder } from '../decoders/framed.js';
import { SimTransport } from '../transports/sim.js';
import { test, assertEqual, assert, assertClose } from './harness.js';

test('pipeline: index and time come from sample count, not arrival', () => {
  const p = new Pipeline(NEEG_AA_V1);
  const got = [];
  p.on(b => got.push(...b));
  p.push([{ counts: [1, 2] }, { counts: [3, 4] }], 1000);
  p.push([{ counts: [5, 6] }], 1000); // same arrival time: bursty BLE delivery
  assertEqual(got.map(s => s.index), [0, 1, 2]);
  assertEqual(got.map(s => s.t), [0, 1 / 125, 2 / 125]);
  assertClose(got[2].uv[1], 6 * microvoltsPerCount(NEEG_AA_V1), 1e-12);
});

test('pipeline: channel count follows the format', () => {
  const four = { ...NEEG_AA_V1, fields: [{ name: 'counts', type: 'i24be', count: 4 }], channelNames: undefined };
  const p = new Pipeline(four);
  assertEqual(p.channels, 4);
  assertEqual(p.channelNames, ['ch0', 'ch1', 'ch2', 'ch3']);
});

test('sim: emits bytes that decode at about fs', async () => {
  const sim = new SimTransport(NEEG_AA_V1);
  const dec = createFramedDecoder(NEEG_AA_V1);
  let n = 0;
  sim.addEventListener('data', e => { n += dec.push(e.detail).length; });
  await sim.connect();
  await new Promise(r => setTimeout(r, 1000));
  await sim.disconnect();
  assert(n >= 100 && n <= 135, `decoded ${n} samples in 1 s`);
  assertEqual(dec.stats.rejected, 0);
});
