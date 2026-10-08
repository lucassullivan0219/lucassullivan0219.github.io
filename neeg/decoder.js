// NEEG-2 packet decoder for the current 0xAA format (8 bytes per packet, 125 Hz).
// Ported from notifyCallback() in NEEG-2/firmware_NEEG/src/main.cpp.
//
//   0xAA | battery (0x00..0x64) | ch0 (3 B, BE, signed 24-bit) | ch1 (3 B, ...)
//
// BLE notifications split packets at arbitrary points, so all parse state
// lives in the closure and survives across push() calls.

export const FS = 125;
export const ADC_MAX = 8388607; // 2^23 - 1
export const VREF = 2.39;
export const PGA_GAIN = 24;

export function countsToMicrovolts(count) {
  return count / ADC_MAX * VREF * 1e6 / PGA_GAIN;
}

export function createAaDecoder({ channels = 2 } = {}) {
  const HEADER = 0xaa;
  const BATTERY_MAX = 0x64;

  let state = 'header'; // 'header' | 'battery' | 'data'
  let battery = 0;
  let values = new Array(channels).fill(0);
  let byteCount = 0;
  let channel = 0;

  const stats = { bytes: 0, packets: 0, rejected: 0, skipped: 0 };

  function push(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      stats.bytes++;

      if (state === 'header') {
        if (b === HEADER) state = 'battery';
        else stats.skipped++;
        continue;
      }

      if (state === 'battery') {
        if (b <= BATTERY_MAX) {
          battery = b;
          values.fill(0);
          byteCount = 0;
          channel = 0;
          state = 'data';
        } else {
          stats.rejected++;
          // Unlike the ESP32 parser, a rejected byte that is itself 0xAA is
          // kept as the next header candidate instead of being discarded.
          state = b === HEADER ? 'battery' : 'header';
        }
        continue;
      }

      values[channel] = (values[channel] << 8) | b;
      if (++byteCount < 3) continue;

      // Sign-extend 24-bit two's complement.
      if (values[channel] & 0x800000) values[channel] -= 0x1000000;
      byteCount = 0;
      if (++channel < channels) continue;

      out.push({ channels: values.slice(), battery });
      stats.packets++;
      state = 'header';
    }
    return out;
  }

  return { push, stats };
}

// Build one raw packet; used by tests and the simulator.
export function encodeAaPacket(battery, channelCounts) {
  const out = [0xaa, battery];
  for (const c of channelCounts) {
    const v = c & 0xffffff;
    out.push((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  }
  return out;
}
