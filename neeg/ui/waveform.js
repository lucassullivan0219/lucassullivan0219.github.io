// Live waveform: one panel per channel, newest sample at the right edge, last `seconds` s.
// Colours come from CSS tokens (--series-N, --line, --muted) so light/dark both work.
// Auto scale follows neeg_monitor.py: centre = mean, span = 1.2 × peak-to-peak (≥ 20 µV).

export function createWaveform(canvas, { store, names, fs, seconds = 5 }) {
  const ctx = canvas.getContext('2d');
  let span = null; // null = auto, else full span in µV

  function css(name) { return getComputedStyle(canvas).getPropertyValue(name).trim(); }

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return dpr;
  }

  function draw() {
    const dpr = fitCanvas();
    const W = canvas.width, H = canvas.height;
    const n = Math.round(seconds * fs);
    const nch = names.length;
    const ph = H / nch;
    const line = css('--line'), muted = css('--muted');
    const font = `${11 * dpr}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.clearRect(0, 0, W, H);
    ctx.font = font;
    ctx.textBaseline = 'top';

    for (let ch = 0; ch < nch; ch++) {
      const top = ch * ph;
      const y = store.latest('view', ch, n);

      // Grid: one vertical line per second, centre line, panel separator.
      ctx.lineWidth = dpr;
      ctx.strokeStyle = line;
      ctx.beginPath();
      for (let s = 0; s <= seconds; s++) {
        const x = Math.round(W - s * fs * W / n) + 0.5;
        ctx.moveTo(x, top); ctx.lineTo(x, top + ph);
      }
      ctx.moveTo(0, Math.round(top + ph / 2) + 0.5); ctx.lineTo(W, Math.round(top + ph / 2) + 0.5);
      if (ch > 0) { ctx.moveTo(0, Math.round(top) + 0.5); ctx.lineTo(W, Math.round(top) + 0.5); }
      ctx.stroke();

      let centre = 0, full = span ?? 200;
      if (y.length) {
        let min = Infinity, max = -Infinity, sum = 0;
        for (const v of y) { if (v < min) min = v; if (v > max) max = v; sum += v; }
        centre = sum / y.length;
        if (span == null) full = Math.max((max - min) * 1.2, 20);
      }
      const half = full / 2;
      const pad = 4 * dpr;
      const toY = v => top + ph / 2 - (v - centre) / half * (ph / 2 - pad);

      if (y.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top, W, ph);
        ctx.clip();
        ctx.strokeStyle = css(`--series-${ch + 1}`) || css('--accent');
        ctx.lineWidth = 1.5 * dpr;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const x0 = W - (y.length - 1) * W / (n - 1);
        for (let i = 0; i < y.length; i++) {
          const x = x0 + i * W / (n - 1), yy = toY(y[i]);
          if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Labels in text colour (identity is the panel, not the ink).
      ctx.fillStyle = css('--fg');
      ctx.textAlign = 'left';
      ctx.fillText(names[ch], 6 * dpr, top + 4 * dpr);
      ctx.fillStyle = muted;
      ctx.textAlign = 'right';
      ctx.fillText(`±${fmt(half)} µV${span == null ? ' auto' : ''}`, W - 6 * dpr, top + 4 * dpr);
    }

    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`−${seconds} s`, 4 * dpr, H - 2 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText('now', W - 4 * dpr, H - 2 * dpr);
  }

  const fmt = v => v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1);

  return {
    draw,
    setSpan(v) { span = v; },
  };
}
