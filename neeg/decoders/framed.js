// Generic decoder for fixed-length binary frames described by a format descriptor
// (see formats.js). New firmware formats should only need a new descriptor.
//
// Stream handling: bytes are buffered across push() calls, because BLE notifications
// split frames at arbitrary points. A frame candidate starts at every sync match; if its
// fields or checksum don't validate, scanning resumes one byte after that sync start,
// so a false sync inside the data costs at most the bytes before the real one.

const TYPES = {
  u8:     { size: 1, read: (b, o) => b[o] },
  i8:     { size: 1, read: (b, o) => (b[o] << 24) >> 24 },
  u16be:  { size: 2, read: (b, o) => (b[o] << 8) | b[o + 1] },
  u16le:  { size: 2, read: (b, o) => b[o] | (b[o + 1] << 8) },
  i16be:  { size: 2, read: (b, o) => (((b[o] << 8) | b[o + 1]) << 16) >> 16 },
  i16le:  { size: 2, read: (b, o) => ((b[o] | (b[o + 1] << 8)) << 16) >> 16 },
  u24be:  { size: 3, read: (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2] },
  i24be:  { size: 3, read: (b, o) => (((b[o] << 16) | (b[o + 1] << 8) | b[o + 2]) << 8) >> 8 },
  i24le:  { size: 3, read: (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8) >> 8 },
  u32be:  { size: 4, read: (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 },
  i32be:  { size: 4, read: (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3] },
};

const WRITERS = {
  be: (v, size) => Array.from({ length: size }, (_, i) => (v >> (8 * (size - 1 - i))) & 0xff),
  le: (v, size) => Array.from({ length: size }, (_, i) => (v >> (8 * i)) & 0xff),
};

export function crc8(bytes, poly = 0x07, init = 0x00) {
  let crc = init;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ poly) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

const CHECKSUMS = {
  crc8: (bytes, c) => crc8(bytes, c.poly ?? 0x07, c.init ?? 0),
  sum8: bytes => bytes.reduce((s, b) => (s + b) & 0xff, 0),
  xor8: bytes => bytes.reduce((s, b) => s ^ b, 0),
};

function layout(format) {
  let offset = format.sync.length;
  const fields = format.fields.map(f => {
    const type = TYPES[f.type];
    if (!type) throw new Error(`unknown field type ${f.type}`);
    const field = { ...f, type, offset, count: f.count ?? 1 };
    offset += type.size * field.count;
    return field;
  });
  const checksumSize = format.checksum ? 1 : 0;
  return { fields, payloadEnd: offset, frameLength: offset + checksumSize };
}

// Maps descriptor field names onto the standard sample shape.
function toSample(values) {
  const { counts, battery, seq, ...extra } = values;
  const sample = { counts: Array.isArray(counts) ? counts : [counts] };
  if (battery !== undefined) sample.battery = battery;
  if (seq !== undefined) sample.deviceSeq = seq;
  if (Object.keys(extra).length) sample.extra = extra;
  return sample;
}

export function createFramedDecoder(format) {
  const { fields, payloadEnd, frameLength } = layout(format);
  const sync = format.sync;
  let buf = new Uint8Array(0);
  const stats = { bytes: 0, packets: 0, rejected: 0, skipped: 0, checksumErrors: 0 };

  const syncAt = i => sync.every((s, k) => buf[i + k] === s);

  function parseAt(i) {
    const values = {};
    for (const f of fields) {
      const vals = [];
      for (let k = 0; k < f.count; k++) vals.push(f.type.read(buf, i + f.offset + k * f.type.size));
      if (f.valid && !vals.every(f.valid)) return null;
      values[f.name] = f.count > 1 || f.name === 'counts' ? vals : vals[0];
    }
    if (format.checksum) {
      const c = format.checksum;
      const from = c.over === 'frame' ? i : i + sync.length;
      const expected = CHECKSUMS[c.type](buf.subarray(from, i + payloadEnd), c);
      if (expected !== buf[i + payloadEnd]) { stats.checksumErrors++; return null; }
    }
    return toSample(values);
  }

  function push(chunk) {
    stats.bytes += chunk.length;
    const merged = new Uint8Array(buf.length + chunk.length);
    merged.set(buf);
    merged.set(chunk, buf.length);
    buf = merged;

    const out = [];
    let i = 0;
    while (i + sync.length <= buf.length) {
      if (!syncAt(i)) { i++; stats.skipped++; continue; }
      if (i + frameLength > buf.length) break; // wait for the rest of this frame
      const sample = parseAt(i);
      if (sample) { out.push(sample); stats.packets++; i += frameLength; }
      else { stats.rejected++; i++; }
    }
    buf = buf.slice(i);
    return out;
  }

  // Drop partial bytes (e.g. after a reconnect) but keep the counters.
  function resync() { buf = new Uint8Array(0); }

  function reset() {
    resync();
    for (const k in stats) stats[k] = 0;
  }

  return { format, push, stats, reset, resync };
}

// Builds one frame from field values; used by the simulator and tests.
export function encodeFrame(format, values) {
  const out = [...format.sync];
  for (const f of format.fields) {
    const size = TYPES[f.type].size;
    const endian = f.type.endsWith('le') ? 'le' : 'be';
    const raw = values[f.name];
    const vals = Array.isArray(raw) ? raw : [raw];
    for (const v of vals) out.push(...WRITERS[endian](v, size));
  }
  if (format.checksum) {
    const c = format.checksum;
    const from = c.over === 'frame' ? 0 : format.sync.length;
    out.push(CHECKSUMS[c.type](out.slice(from), c));
  }
  return out;
}
