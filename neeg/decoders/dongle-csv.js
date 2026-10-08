// Line decoder for the ESP32 dongle's USB serial output (NEEG-2/firmware_NEEG), mirroring
// _parse_line() in neeg_monitor.py:
//   v2, 6 columns:  batt,ch0,ch1,seq,fresh,ms
//   v2, 7 columns:  batt,ch0,ch1,seq,fresh,ms,dev_seq
//   legacy, 10+:    batt,ch0,ch1,0,0,0,0,0,0,ms   (no seq / fresh)
// Rows with fresh=0 are fillers the dongle repeats to keep a 125 Hz beat; they are dropped.
// Lines starting with '[' are dongle diagnostics ([BOOT], [STATE], [BLE], [ERR], [WARN]).
// Same interface as the framed decoder: push(bytes) → samples, stats, reset(), resync().

const INT = /^-?\d+$/;

export function parseDongleLine(line) {
  const parts = line.split(',').map(s => s.trim());
  if (parts.length < 3 || !parts.slice(0, 3).every(p => INT.test(p))) return null;
  const [battery, ch0, ch1] = parts.slice(0, 3).map(Number);
  if (battery < 0 || battery > 100) return null;
  const row = { battery, counts: [ch0, ch1], seq: null, fresh: null, ms: null, devSeq: null };
  if (parts.length === 6 || parts.length === 7) {
    if (!parts.slice(3).every(p => INT.test(p))) return null;
    [row.seq, row.fresh, row.ms] = parts.slice(3, 6).map(Number);
    if (parts.length === 7) row.devSeq = Number(parts[6]);
  } else if (parts.length >= 10 && INT.test(parts[9])) {
    row.ms = Number(parts[9]);
  }
  return row;
}

export function createDongleCsvDecoder(format, { onMessage = () => {} } = {}) {
  let text = new TextDecoder();
  let pending = '';
  const stats = { bytes: 0, packets: 0, rejected: 0, skipped: 0, checksumErrors: 0, fillerDropped: 0, messages: 0 };

  function push(chunk) {
    stats.bytes += chunk.length;
    pending += text.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop();
    const out = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('[')) { stats.messages++; onMessage(line); continue; }
      const row = parseDongleLine(line);
      if (!row) { stats.rejected++; continue; }
      if (row.fresh === 0) { stats.fillerDropped++; continue; }
      const sample = { counts: row.counts, battery: row.battery };
      if (row.devSeq !== null) sample.deviceSeq = row.devSeq;
      if (row.seq !== null || row.ms !== null) sample.extra = { dongleSeq: row.seq, dongleMs: row.ms };
      out.push(sample);
      stats.packets++;
    }
    return out;
  }

  function resync() { pending = ''; text = new TextDecoder(); }
  function reset() { resync(); for (const k in stats) stats[k] = 0; }

  return { format, push, stats, reset, resync };
}
