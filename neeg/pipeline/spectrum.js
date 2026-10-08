// Power spectral density, matching compute_psd() / band_power() in neeg_monitor.py:
// remove the mean, Hamming window, zero-pad to NFFT, |X|² / (fs · Σw²), one-sided bins
// (not doubled; only ratios and relative levels are used).

export const SPEC_NFFT = 512;

// In-place iterative radix-2 FFT. re/im lengths must be the same power of two.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

const nextPow2 = n => 2 ** Math.ceil(Math.log2(n));

export function computePsd(x, fs, nfft = SPEC_NFFT) {
  const n = x.length;
  if (n < 32) return null;
  let mean = 0;
  for (const v of x) mean += v;
  mean /= n;
  const size = Math.max(nfft, nextPow2(n));
  const re = new Float64Array(size), im = new Float64Array(size);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1)); // numpy.hamming
    re[i] = (x[i] - mean) * w;
    wsum += w * w;
  }
  fft(re, im);
  const bins = size / 2 + 1;
  const freqs = new Float64Array(bins), psd = new Float64Array(bins);
  const norm = fs * wsum + 1e-20;
  for (let k = 0; k < bins; k++) {
    freqs[k] = k * fs / size;
    psd[k] = (re[k] * re[k] + im[k] * im[k]) / norm;
  }
  return { freqs, psd };
}

// Total power in [lo, hi] (sum × df, not the mean; see the note in neeg_monitor.py).
export function bandPower({ freqs, psd }, lo, hi) {
  const df = freqs[1] - freqs[0];
  let sum = 0;
  for (let k = 0; k < freqs.length; k++) if (freqs[k] >= lo && freqs[k] <= hi) sum += psd[k];
  return sum * df;
}
