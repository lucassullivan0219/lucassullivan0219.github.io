/* Small canvas plotting helpers shared by circuit-sim/ and ads129x/.

   var p = new LabPlot(canvas, {xlog: true, ylabel: 'dB', xunit: 'Hz', yunit: 'dB'});
   p.draw([{x: [...], y: [...], color: 'var(--c1)', label: 'gain'}], {xRange: [1, 1e6]});
   Hover shows a crosshair and the nearest value of every series.

   Colors may be CSS custom properties ("var(--c1)"); they are resolved at draw time so the
   plot follows light / dark mode.
*/
(function (global) {
  'use strict';
  var fmt = function (v, u, d) { return global.CircuitSim ? global.CircuitSim.fmt(v, u, d) : v.toPrecision(3) + (u || ''); };

  function cssColor(el, c) {
    if (!c) return '#888';
    var m = /^var\((--[\w-]+)\)$/.exec(c);
    if (!m) return c;
    return getComputedStyle(el).getPropertyValue(m[1]).trim() || '#888';
  }

  function niceStep(span, target) {
    var raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  function LabPlot(canvas, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.o = opts || {};
    this.series = []; this.extra = {}; this.hover = null;
    var self = this;
    canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); self.hover = [e.clientX - r.left, e.clientY - r.top]; self.redraw(); });
    canvas.addEventListener('pointerdown', function (e) { var r = canvas.getBoundingClientRect(); self.hover = [e.clientX - r.left, e.clientY - r.top]; self.redraw(); });
    canvas.addEventListener('pointerleave', function () { self.hover = null; self.redraw(); });
  }
  LabPlot.prototype.size = function () {
    var r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.max(200, Math.round(r.width)), h = Math.round(r.height || w * (this.o.aspect || 0.55));
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    }
    return {w: w, h: h, dpr: dpr};
  };
  LabPlot.prototype.draw = function (series, extra) { this.series = series || []; this.extra = extra || {}; this.redraw(); };
  LabPlot.prototype.redraw = function () {
    var o = this.o, ex = this.extra, cv = this.cv, ctx = this.ctx, S = this.size();
    var W = S.w, H = S.h;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    var ink = cssColor(cv, 'var(--ink)'), muted = cssColor(cv, 'var(--muted)'), rule = cssColor(cv, 'var(--rule)'), bg = cssColor(cv, 'var(--surface)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var L = o.left || 40, R = 12, T = 12, B = o.bottom || 34;
    var pw = W - L - R, ph = H - T - B;
    /* ranges */
    var xs = [], ys = [], self = this;
    this.series.forEach(function (s) {
      if (s.hidden) return;
      for (var i = 0; i < s.x.length; i++) {
        var xv = s.x[i], yv = s.y[i];
        if (!isFinite(xv) || !isFinite(yv)) continue;
        if (o.xlog && xv <= 0) continue;
        if (o.ylog && yv <= 0) continue;
        xs.push(xv); ys.push(yv);
      }
    });
    var xr = ex.xRange || o.xRange || (xs.length ? [Math.min.apply(null, xs), Math.max.apply(null, xs)] : (o.xlog ? [1, 10] : [0, 1]));
    if (o.xlog && !(xr[0] > 0 && xr[1] > xr[0] && isFinite(xr[1]))) xr = [1, 10];
    var yr = ex.yRange || o.yRange;
    if (!yr) {
      var lo = Infinity, hi = -Infinity;
      for (var k = 0; k < ys.length; k++) { if (ys[k] < lo) lo = ys[k]; if (ys[k] > hi) hi = ys[k]; }
      if (!isFinite(lo)) { lo = o.ylog ? 1 : 0; hi = o.ylog ? 10 : 1; }
      if (o.ylog) { lo = Math.pow(10, Math.floor(Math.log10(lo))); hi = Math.pow(10, Math.ceil(Math.log10(hi))); if (lo === hi) hi = lo * 10; }
      else {
        if (o.yZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
        if (hi - lo < (o.yMinSpan || 1e-12)) { var c = (hi + lo) / 2, hs = (o.yMinSpan || Math.abs(c) * 0.1 || 1) / 2; lo = c - hs; hi = c + hs; }
        var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
      }
      yr = [lo, hi];
    }
    if (xr[0] === xr[1]) xr = o.xlog ? [xr[0] / 2, xr[1] * 2] : [xr[0] - 1, xr[1] + 1];
    if (o.ylog && !(yr[0] > 0 && yr[1] > yr[0] && isFinite(yr[1]))) yr = [1, 10];
    if (!o.ylog && !(isFinite(yr[0]) && isFinite(yr[1]) && yr[1] > yr[0])) yr = [0, 1];
    /* left margin wide enough for the longest y tick label */
    var dy0 = digitsFor(yr, o.ylog, 5), wmax = 0;
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    ticks(yr, o.ylog, 5).forEach(function (t) {
      if (t.major) wmax = Math.max(wmax, ctx.measureText(o.yfmt ? o.yfmt(t.v) : fmt(t.v, o.yunit || '', dy0)).width);
    });
    L = Math.max(L, Math.ceil(wmax) + 10 + (o.ylabel ? 16 : 0)); pw = W - L - R;
    var fx = o.xlog ? function (v) { return L + (Math.log10(v) - Math.log10(xr[0])) / (Math.log10(xr[1]) - Math.log10(xr[0])) * pw; }
                    : function (v) { return L + (v - xr[0]) / (xr[1] - xr[0]) * pw; };
    var fy = o.ylog ? function (v) { return T + ph - (Math.log10(v) - Math.log10(yr[0])) / (Math.log10(yr[1]) - Math.log10(yr[0])) * ph; }
                    : function (v) { return T + ph - (v - yr[0]) / (yr[1] - yr[0]) * ph; };
    var ix = o.xlog ? function (px) { return Math.pow(10, Math.log10(xr[0]) + (px - L) / pw * (Math.log10(xr[1]) - Math.log10(xr[0]))); }
                    : function (px) { return xr[0] + (px - L) / pw * (xr[1] - xr[0]); };
    this.map = {fx: fx, fy: fy, ix: ix, L: L, T: T, pw: pw, ph: ph, xr: xr, yr: yr};
    /* grid and ticks */
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.lineWidth = 1; ctx.strokeStyle = rule; ctx.fillStyle = muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var dx = digitsFor(xr, o.xlog, 7), dy = digitsFor(yr, o.ylog, 5);
    ticks(xr, o.xlog, 7).forEach(function (t) {
      var X = Math.round(fx(t.v)) + 0.5;
      ctx.globalAlpha = t.major ? 1 : 0.45; ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, T + ph); ctx.stroke(); ctx.globalAlpha = 1;
      if (t.major) {
        ctx.textAlign = X > L + pw - 30 ? 'right' : X < L + 30 ? 'left' : 'center';
        ctx.fillText(o.xfmt ? o.xfmt(t.v) : fmt(t.v, o.xunit || '', dx).replace(/ $/, ''), X, T + ph + 5);
      }
    });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ticks(yr, o.ylog, 5).forEach(function (t) {
      var Y = Math.round(fy(t.v)) + 0.5;
      ctx.globalAlpha = t.major ? 1 : 0.45; ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(L + pw, Y); ctx.stroke(); ctx.globalAlpha = 1;
      if (t.major) ctx.fillText(o.yfmt ? o.yfmt(t.v) : fmt(t.v, o.yunit || '', dy).replace(/ $/, ''), L - 5, Y);
    });
    ctx.strokeStyle = muted; ctx.strokeRect(L + 0.5, T + 0.5, pw, ph);
    if (o.xlabel) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xlabel, L + pw, H - 1); }
    if (o.ylabel) { ctx.save(); ctx.translate(11, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.ylabel, 0, 0); ctx.restore(); }
    /* bands and markers */
    (ex.bands || []).forEach(function (b) {
      ctx.fillStyle = cssColor(cv, b.color || 'var(--band)');
      var x0 = Math.max(L, fx(b.from)), x1 = Math.min(L + pw, fx(b.to));
      if (x1 > x0) ctx.fillRect(x0, T, x1 - x0, ph);
    });
    (ex.hlines || []).forEach(function (h) {
      if (h.v < yr[0] || h.v > yr[1]) return;
      ctx.strokeStyle = cssColor(cv, h.color || 'var(--muted)'); ctx.setLineDash([4, 4]);
      var Y = fy(h.v); ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(L + pw, Y); ctx.stroke(); ctx.setLineDash([]);
      if (h.label) { ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(h.label, L + 4, Y - 2); }
    });
    (ex.vlines || []).forEach(function (h) {
      if (h.v < xr[0] || h.v > xr[1]) return;
      ctx.strokeStyle = cssColor(cv, h.color || 'var(--muted)'); ctx.setLineDash([4, 4]);
      var X = fx(h.v); ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, T + ph); ctx.stroke(); ctx.setLineDash([]);
      if (h.label) { ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(h.label, X + 3, T + 3); }
    });
    /* series */
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    this.series.forEach(function (s) {
      if (s.hidden) return;
      var col = cssColor(cv, s.color);
      if (s.bars) {
        ctx.fillStyle = col; ctx.globalAlpha = 0.75;
        var bw = s.barWidth || (s.x.length > 1 ? s.x[1] - s.x[0] : 1);
        for (var i = 0; i < s.x.length; i++) {
          var x0 = fx(s.x[i] - bw / 2), x1 = fx(s.x[i] + bw / 2), y0 = fy(Math.max(yr[0], o.ylog ? yr[0] : 0)), y1 = fy(s.y[i]);
          ctx.fillRect(x0 + 0.5, Math.min(y0, y1), Math.max(1, x1 - x0 - 1), Math.abs(y1 - y0));
        }
        ctx.globalAlpha = 1; return;
      }
      ctx.strokeStyle = col; ctx.lineWidth = s.width || 1.8; ctx.lineJoin = 'round';
      if (s.dash) ctx.setLineDash(s.dash);
      ctx.beginPath();
      var n = s.x.length, stride = Math.max(1, Math.floor(n / (pw * 2))), started = false;
      for (var j = 0; j < n; j += stride) {
        var xv = s.x[j], yv = s.y[j];
        if (!isFinite(yv) || (o.xlog && xv <= 0) || (o.ylog && yv <= 0)) { started = false; continue; }
        var X = fx(xv), Y = Math.max(-1e4, Math.min(1e4, fy(yv)));
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (s.dots) { ctx.fillStyle = col; for (j = 0; j < n; j++) { ctx.beginPath(); ctx.arc(fx(s.x[j]), fy(s.y[j]), 2.5, 0, 7); ctx.fill(); } }
    });
    ctx.restore();
    /* legend */
    var lx = L + 8, ly = T + 6;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '11.5px "Noto Sans TC", system-ui, sans-serif';
    this.series.forEach(function (s) {
      if (!s.label || s.hidden) return;
      var tw = ctx.measureText(s.label).width;
      if (lx + tw + 22 > L + pw) { lx = L + 8; ly += 16; }
      ctx.fillStyle = cssColor(cv, s.color); ctx.fillRect(lx, ly + 6, 12, 3);
      ctx.fillStyle = ink; ctx.fillText(s.label, lx + 16, ly);
      lx += tw + 30;
    });
    /* hover readout */
    if (this.hover && this.hover[0] >= L && this.hover[0] <= L + pw) {
      var hx = this.hover[0], xq = ix(hx), lines = [(o.xfmt ? o.xfmt(xq) : fmt(xq, o.xunit || '', 4))];
      ctx.strokeStyle = muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hx + 0.5, T); ctx.lineTo(hx + 0.5, T + ph); ctx.stroke(); ctx.setLineDash([]);
      this.series.forEach(function (s) {
        if (s.hidden || !s.x.length || s.bars) return;
        var best = 0, bd = Infinity;
        for (var i = 0; i < s.x.length; i++) { var d = Math.abs(fx(s.x[i]) - hx); if (d < bd) { bd = d; best = i; } }
        var yv = s.y[best];
        lines.push((s.label ? s.label + ' ' : '') + (o.yfmt ? o.yfmt(yv) : fmt(yv, o.yunit || '', 4)));
        ctx.fillStyle = cssColor(cv, s.color); ctx.beginPath(); ctx.arc(fx(s.x[best]), fy(yv), 3, 0, 7); ctx.fill();
      });
      ctx.font = '11.5px "IBM Plex Mono", ui-monospace, monospace';
      var bw = 0; lines.forEach(function (l) { bw = Math.max(bw, ctx.measureText(l).width); });
      var bx = hx + 10 + bw + 12 > L + pw ? hx - bw - 22 : hx + 10, by = T + ph - lines.length * 15 - 10;
      ctx.fillStyle = bg; ctx.globalAlpha = 0.9; ctx.fillRect(bx, by, bw + 12, lines.length * 15 + 6); ctx.globalAlpha = 1;
      ctx.strokeStyle = rule; ctx.strokeRect(bx + 0.5, by + 0.5, bw + 12, lines.length * 15 + 6);
      ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach(function (l, i) { ctx.fillText(l, bx + 6, by + 4 + i * 15); });
    }
  };

  /* enough significant digits that neighbouring tick labels differ (e.g. 110.5 µV vs 111 µV) */
  function digitsFor(r, log, target) {
    if (log || !(r[1] > r[0])) return 3;
    var st = niceStep(r[1] - r[0], target), m = Math.max(Math.abs(r[0]), Math.abs(r[1]));
    return Math.max(3, Math.min(7, Math.ceil(Math.log10(m / st)) + 1));
  }
  function ticks(r, log, target) {
    var out = [];
    if (!(isFinite(r[0]) && isFinite(r[1]) && r[1] > r[0])) return out;
    if (log) {
      if (!(r[0] > 0)) return out;
      var a = Math.floor(Math.log10(r[0])), b = Math.ceil(Math.log10(r[1]));
      var dec = b - a, every = dec > 8 ? 2 : 1;
      for (var e = a; e <= b; e++) {
        var base = Math.pow(10, e);
        if (base >= r[0] * 0.999 && base <= r[1] * 1.001 && (e % every === 0)) out.push({v: base, major: true});
        if (dec <= 6) for (var m = 2; m < 10; m++) { var v = m * base; if (v > r[0] && v < r[1]) out.push({v: v, major: false}); }
      }
      return out;
    }
    var st = niceStep(r[1] - r[0], target), s = Math.ceil(r[0] / st) * st;
    if (!(st > 0) || !isFinite(s)) return out;
    for (var x = s; x <= r[1] + st * 1e-9; x += st) out.push({v: Math.abs(x) < st * 1e-9 ? 0 : x, major: true});
    return out;
  }

  /* Welch-free single FFT with a Hann window; returns {f, mag} (amplitude spectrum, same unit as input, rms per bin) */
  function spectrum(y, fs, opts) {
    opts = opts || {};
    var n = 1; while (n * 2 <= y.length) n *= 2;
    if (n < 8) return {f: [], mag: [], psd: []};
    var start = y.length - n, re = new Float64Array(n), im = new Float64Array(n), mean = 0, wsum = 0, w2 = 0;
    for (var i = 0; i < n; i++) mean += y[start + i];
    mean /= n;
    for (i = 0; i < n; i++) {
      var w = opts.window === 'rect' ? 1 : 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
      re[i] = (y[start + i] - (opts.keepDC ? 0 : mean)) * w; wsum += w; w2 += w * w;
    }
    fft(re, im);
    var f = [], mag = [], psd = [];
    for (var k = 1; k <= n / 2; k++) {
      var p = re[k] * re[k] + im[k] * im[k];
      f.push(k * fs / n);
      mag.push(Math.sqrt(2 * p) / wsum);          // rms of a sine at bin k: amplitude 2|X|/sum(w), divided by sqrt 2
      psd.push(2 * p / (fs * w2));                                                                            // one-sided PSD (unit^2/Hz)
    }
    return {f: f, mag: mag, psd: psd, n: n};
  }
  function fft(re, im) {
    var n = re.length, j = 0;
    for (var i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2], bi = im[i + k + len / 2];
          var tr = br * cr - bi * ci, ti = br * ci + bi * cr;
          re[i + k] = ar + tr; im[i + k] = ai + ti; re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  global.LabPlot = LabPlot;
  global.LabDSP = {spectrum: spectrum, fft: fft, cssColor: cssColor};
})(window);
