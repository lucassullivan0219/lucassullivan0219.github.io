// Spectrum plot: PSD of the last `seconds` s per channel, 0…fmax Hz, in dB re 1 µV²/Hz.
// All channels share one axis (same unit and scale), told apart by colour plus a legend.
// A crosshair follows the pointer and lists every channel's value at that frequency.

import { computePsd } from '../pipeline/spectrum.js';

const SECONDS = 4, DB_RANGE = 60;

export function createSpectrumView(canvas, { store, names, fs, getLineFreq }) {
  // Up to Nyquist (62.5 Hz at 125 Hz) so a 60 Hz mains peak isn't on the plot edge.
  const FMAX = Math.min(65, fs / 2);
  const ctx = canvas.getContext('2d');
  let spectra = [];
  let hoverX = null;

  const css = name => getComputedStyle(canvas).getPropertyValue(name).trim();
  const toDb = p => 10 * Math.log10(p + 1e-12);

  function compute() {
    const n = Math.round(SECONDS * fs);
    spectra = names.map((_, ch) => computePsd(store.latest('uv', ch, n), fs));
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const W = canvas.width, H = canvas.height;
    const left = 34 * dpr, right = 6 * dpr, top = 8 * dpr, bottom = 18 * dpr;
    const pw = W - left - right, ph = H - top - bottom;
    const muted = css('--muted'), line = css('--line'), fg = css('--fg');
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${10.5 * dpr}px ui-monospace, SFMono-Regular, Consolas, monospace`;

    const valid = spectra.filter(Boolean);
    let maxDb = 20;
    if (valid.length) {
      maxDb = -Infinity;
      for (const s of valid) for (let k = 1; k < s.freqs.length && s.freqs[k] <= FMAX; k++) maxDb = Math.max(maxDb, toDb(s.psd[k]));
      maxDb = Math.ceil(maxDb / 10) * 10 + 5;
    }
    const minDb = maxDb - DB_RANGE;
    const xOf = f => left + f / FMAX * pw;
    const yOf = db => top + (maxDb - Math.max(minDb, Math.min(maxDb, db))) / DB_RANGE * ph;

    // Recessive grid and axes.
    ctx.strokeStyle = line;
    ctx.lineWidth = dpr;
    ctx.fillStyle = muted;
    ctx.beginPath();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let f = 0; f <= FMAX; f += 10) {
      const x = Math.round(xOf(f)) + 0.5;
      ctx.moveTo(x, top); ctx.lineTo(x, top + ph);
      ctx.fillText(`${f}`, x, top + ph + 3 * dpr);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let db = Math.ceil(minDb / 10) * 10; db <= maxDb; db += 10) {
      const y = Math.round(yOf(db)) + 0.5;
      ctx.moveTo(left, y); ctx.lineTo(left + pw, y);
      ctx.fillText(`${db}`, left - 4 * dpr, y);
    }
    ctx.stroke();

    // Mains frequency marker.
    const lf = getLineFreq();
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(Math.round(xOf(lf)) + 0.5, top); ctx.lineTo(Math.round(xOf(lf)) + 0.5, top + ph);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = 'round';
    spectra.forEach((s, ch) => {
      if (!s) return;
      ctx.strokeStyle = css(`--series-${ch + 1}`) || css('--accent');
      ctx.beginPath();
      for (let k = 0; k < s.freqs.length && s.freqs[k] <= FMAX; k++) {
        const x = xOf(s.freqs[k]), y = yOf(toDb(s.psd[k]));
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    });

    // Crosshair readout: snaps to the nearest frequency bin, lists every channel.
    if (hoverX != null && valid.length) {
      const f = Math.max(0, Math.min(FMAX, (hoverX * dpr - left) / pw * FMAX));
      const s0 = valid[0];
      const k = Math.round(f / (s0.freqs[1] - s0.freqs[0]));
      const x = Math.round(xOf(s0.freqs[k])) + 0.5;
      ctx.strokeStyle = muted;
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
      const parts = [`${s0.freqs[k].toFixed(1)} Hz`, ...spectra.map((s, ch) => s ? `${names[ch]} ${toDb(s.psd[k]).toFixed(1)} dB` : null).filter(Boolean)];
      ctx.textBaseline = 'top';
      const text = parts.join('  ');
      const tw = ctx.measureText(text).width + 8 * dpr;
      const tx = Math.min(Math.max(x - tw / 2, left), left + pw - tw);
      ctx.fillStyle = css('--card');
      ctx.fillRect(tx, top, tw, 16 * dpr);
      ctx.fillStyle = fg;
      ctx.textAlign = 'left';
      ctx.fillText(text, tx + 4 * dpr, top + 3 * dpr);
    }
  }

  // Dragging across the plot reads values instead of swiping to another page.
  canvas.addEventListener('pointerdown', e => { e.stopPropagation(); hoverX = e.offsetX; draw(); });
  canvas.addEventListener('pointermove', e => { hoverX = e.offsetX; draw(); });
  canvas.addEventListener('pointerleave', () => { hoverX = null; draw(); });

  return { update() { compute(); draw(); }, draw };
}
