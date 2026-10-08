// Streaming display filters. All are stateful: feed samples in order, one at a time.
//
// The band-pass is a 4th-order Butterworth high-pass at 1 Hz cascaded with a 4th-order
// Butterworth low-pass at 50 Hz (biquads from the RBJ cookbook, bilinear transform with
// pre-warping). neeg_monitor.py uses scipy's butter(4, [1, 50], 'band'); the shape is close
// but not bit-identical.

export class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    Object.assign(this, { b0, b1, b2, a1, a2 });
    this.z1 = 0; this.z2 = 0;
  }
  process(x) { // transposed direct form II
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = 0; this.z2 = 0; }
}

// Even-order Butterworth as a cascade of biquads.
export function butterworth(kind, fc, fs, order = 4) {
  const w0 = 2 * Math.PI * fc / fs;
  const c = Math.cos(w0), s = Math.sin(w0);
  const sections = [];
  for (let k = 0; k < order / 2; k++) {
    const q = 1 / (2 * Math.cos(Math.PI * (2 * k + 1) / (2 * order)));
    const alpha = s / (2 * q);
    const a0 = 1 + alpha;
    const [b0, b1, b2] = kind === 'lowpass'
      ? [(1 - c) / 2, 1 - c, (1 - c) / 2]
      : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    sections.push(new Biquad(b0 / a0, b1 / a0, b2 / a0, -2 * c / a0, (1 - alpha) / a0));
  }
  return sections;
}

export const DISPLAY_MODES = {
  raw: 'Raw',
  dc: 'Remove DC',
  bp: '1–50 Hz',
};

const DC_WINDOW_S = 5;      // same as REMOVE_DC_WINDOW_SEC in neeg_monitor.py
const BAND = [1, 50];

export function createDisplayFilter(mode, fs) {
  if (mode === 'raw') return { process: x => x, reset() {} };

  if (mode === 'dc') {
    // Subtract the moving average of the last 5 s (or of what is available so far).
    const n = Math.round(DC_WINDOW_S * fs);
    const win = new Float64Array(n);
    let i = 0, count = 0, sum = 0;
    return {
      process(x) {
        if (count === n) sum -= win[i]; else count++;
        win[i] = x; sum += x;
        i = (i + 1) % n;
        return x - sum / count;
      },
      reset() { i = 0; count = 0; sum = 0; },
    };
  }

  if (mode === 'bp') {
    const sections = [...butterworth('highpass', BAND[0], fs), ...butterworth('lowpass', BAND[1], fs)];
    // Subtracting the first sample removes the start-up step response to a large DC offset;
    // the high-pass removes that constant anyway, so steady-state output is unchanged.
    let x0 = null;
    return {
      process(x) {
        if (x0 === null) x0 = x;
        let y = x - x0;
        for (const s of sections) y = s.process(y);
        return y;
      },
      reset() { x0 = null; sections.forEach(s => s.reset()); },
    };
  }

  throw new Error(`unknown display mode ${mode}`);
}
