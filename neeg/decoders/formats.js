// Packet format descriptors. To support new firmware output (2-byte sync, version byte,
// device sequence number, CRC8, more channels), add a descriptor here; transports and the
// pipeline do not change.
//
// Field names with special meaning: `counts` (raw ADC values, one per channel),
// `battery` (0..100) and `seq` (device-side sequence number). Others land in sample.extra.
// Checksum, if any, is one byte at the end: { type: 'crc8' | 'sum8' | 'xor8', poly?, init?,
// over?: 'payload' (default, excludes sync) | 'frame' }.

// Current firmware: NEEG-2/legacy/firmware/PortaSense_1014 (STM32 → JDY-23).
export const NEEG_AA_V1 = {
  id: 'neeg-aa-v1',
  version: 1,
  fs: 125,
  sync: [0xaa],
  fields: [
    // Battery doubles as a sub-header check: anything above 100 means misalignment.
    { name: 'battery', type: 'u8', valid: v => v <= 100 },
    { name: 'counts', type: 'i24be', count: 2 },
  ],
  checksum: null,
  scale: { adcMax: 8388607, vref: 2.39, gain: 24 },
  channelNames: ['Fp1', 'Fp2'],
};

export const FORMATS = { [NEEG_AA_V1.id]: NEEG_AA_V1 };

export function microvoltsPerCount(format) {
  const { adcMax, vref, gain } = format.scale;
  return vref * 1e6 / gain / adcMax;
}

export function channelCount(format) {
  return format.fields.find(f => f.name === 'counts')?.count ?? 1;
}
