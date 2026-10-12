/* Canvas schematic for CircuitSim documents (see engine.js parseDoc).

   var sch = new CircuitSchematic(canvas, {onPick: fn});
   sch.setDoc(doc, built);            // geometry + nets
   sch.frame(live, dtReal);           // live = {v(net), pin(partName) -> currents into pins, on(partName)}
   sch.select(name)
   sch.opts.voltColor / .currentDots / .values

   Two view modes.  By default the canvas is sized to the drawing (the playground).  With
   {pan: true, height: px} the canvas keeps its size and the drawing is panned and zoomed
   (sch.fit(), sch.zoomAt(), sch.panBy(), sch.toGrid()); the editor uses this mode and draws
   its own overlay through opts.overlay(ctx, sch).

   Wires and leads are colored by voltage (green = positive, red = negative, gray = 0 V);
   dots move along every branch at a speed that grows with the current.
*/
(function (global) {
  'use strict';
  var CS = global.CircuitSim;
  var ELEC_DIR = {l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1]};

  function CircuitSchematic(canvas, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.opts = {voltColor: true, currentDots: true, values: true, onPick: null, pan: false, height: 520, overlay: null};
    for (var k in opts || {}) this.opts[k] = opts[k];
    this.doc = null; this.sel = null; this.selSet = null; this.phase = {}; this.vmax = 1; this.imax = 1e-3;
    this.G = 20; this.bb = {x0: 0, y0: 0, x1: 10, y1: 10};
    var self = this;
    if (!this.opts.pan) {
      canvas.addEventListener('click', function (e) {
        if (!self.doc) return;
        var r = canvas.getBoundingClientRect(), hit = self.hit(e.clientX - r.left, e.clientY - r.top);
        if (hit && !hit.part && !hit.net) hit = null;
        if (self.opts.onPick) self.opts.onPick(hit);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!self.doc) return;
        var r = canvas.getBoundingClientRect(), hit = self.hit(e.clientX - r.left, e.clientY - r.top);
        canvas.style.cursor = hit && (hit.part || hit.net) ? 'pointer' : 'default';
        self.hoverHit = hit;
      });
      canvas.addEventListener('pointerleave', function () { self.hoverHit = null; });
    }
  }

  /* drawing extent of a document in grid units */
  function contentBox(doc) {
    var xs = [], ys = [];
    function add(p) { xs.push(p[0]); ys.push(p[1]); }
    doc.wires.forEach(function (w) { add(w.a); add(w.b); });
    doc.parts.forEach(function (p) {
      p.pins.forEach(add);
      if (p.type === 'Q' || p.type === 'M') { add([p.at[0] + (/h/.test(p.flag) ? -3 : 3), p.at[1]]); }
      if (p.type === 'U') { add([p.at[0], p.at[1] - 2]); add([p.at[0], p.at[1] + 2]); }
      if (p.type === 'IC') { var d = CS.IC_LIB[p.sym]; add(p.at); add([p.at[0] + d.w, p.at[1] + d.h]); }
      if (p.type === 'ELEC') { var u = ELEC_DIR[elecDir(p)]; add([p.at[0] + 4.5 * u[0] - Math.abs(u[1]) * 1.5, p.at[1] + 4.5 * u[1] - Math.abs(u[0]) * 1]); add([p.at[0] + Math.abs(u[1]) * 1.5, p.at[1] + Math.abs(u[0]) * 1]); }
      if (p.type === 'J') { add([p.at[0] - 1.5, p.at[1] - 1]); add([p.at[0] + 1.5, p.at[1] + 1]); }
    });
    doc.grounds.forEach(function (g) { add(g.at); add([g.at[0], g.at[1] + 1]); });
    doc.labels.forEach(function (l) {
      var f = l.flag || '', x = l.at[0], y = l.at[1];
      add(l.at);
      if (/l/.test(f)) add([x - 6.5, y - 1]);
      else if (/[ab]/.test(f)) { add([x - 3.3, y + (/b/.test(f) ? 1.2 : -1)]); add([x + 3.3, y]); }
      else add([x + 6.5, y - 1]);
    });
    (doc.texts || []).forEach(function (t) { add([t.at[0], t.at[1] - 1]); add([t.at[0] + textWidth(t.text) * (/h/.test(t.flag) ? 0.75 : 0.55), t.at[1] + 0.3]); });
    doc.parts.forEach(function (p) {
      if (p.pins.length !== 2) return;
      var a = p.pins[0], b = p.pins[1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (Math.abs(a[0] - b[0]) >= Math.abs(a[1] - b[1])) { add([mx, my - 1]); add([mx, my + 1]); }
      else add([mx + (/l/.test(p.flag || '') ? -3.4 : 3.4), my]);
    });
    if (!xs.length) return {x0: 0, y0: 0, x1: 10, y1: 10};
    return {x0: Math.min.apply(null, xs) - 0.8, y0: Math.min.apply(null, ys) - 0.8, x1: Math.max.apply(null, xs) + 0.8, y1: Math.max.apply(null, ys) + 0.8};
  }
  /* rough width of a string in em (CJK characters are about 1 em, others about 0.55) */
  function textWidth(s) { var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 1 : 0.56; return w; }
  function elecDir(p) { var m = /[lrud]/.exec(p.flag || ''); return m ? m[0] : 'l'; }

  CircuitSchematic.prototype.setDoc = function (doc, built) {
    var first = !this.doc;
    this.doc = doc; this.built = built; this.phase = {};
    this.cbb = contentBox(doc);
    /* wire networks per net, for current dots in wires */
    this.wireNets = buildWireTrees(doc, built);
    if (!this.opts.pan) { this.bb = this.cbb; this.layout(); }
    else { this.layout(); if (first) this.fit(); }
  };

  CircuitSchematic.prototype.layout = function () {
    var wrap = this.cv.parentElement, avail = wrap ? wrap.clientWidth : 600, dpr = window.devicePixelRatio || 1, w, h;
    if (this.opts.pan) {
      w = Math.max(200, avail); h = this.opts.height;
    } else {
      var bb = this.bb, gw = bb.x1 - bb.x0, gh = bb.y1 - bb.y0;
      this.G = Math.max(15, Math.min(34, (avail - 2) / gw));
      w = Math.round(gw * this.G); h = Math.round(gh * this.G);
    }
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.dpr = dpr; this.W = w; this.H = h;
  };
  /* pan mode: show the whole drawing (zoom limited to keep text legible unless 'all' is set) */
  CircuitSchematic.prototype.fit = function (all) {
    var b = this.cbb || {x0: 0, y0: 0, x1: 10, y1: 10}, gw = b.x1 - b.x0, gh = b.y1 - b.y0;
    var G = Math.min(this.W / gw, this.H / gh);
    if (!all) G = Math.max(G, this.opts.minFitG || 11);       // too small to read values: keep them legible, start at the top left
    G = Math.max(3, Math.min(48, G));
    this.G = G;
    this.bb = {x0: b.x0 - Math.max(0, this.W / G - gw) / 2, y0: b.y0 - Math.max(0, this.H / G - gh) / 2};
  };
  /* level of detail: what is legible at the present zoom */
  CircuitSchematic.prototype.lod = function (what) {
    var G = this.G;
    if (what === 'values') return G >= 10.5;
    if (what === 'pinnum') return G >= 12;
    if (what === 'pinname') return G >= 6;
    return true;
  };
  CircuitSchematic.prototype.zoomAt = function (x, y, f) {
    var g = this.toGrid(x, y), G = Math.max(3, Math.min(60, this.G * f));
    this.G = G; this.bb = {x0: g[0] - x / G, y0: g[1] - y / G};
  };
  CircuitSchematic.prototype.panBy = function (dx, dy) { this.bb = {x0: this.bb.x0 - dx / this.G, y0: this.bb.y0 - dy / this.G}; };
  CircuitSchematic.prototype.toGrid = function (x, y) { return [x / this.G + this.bb.x0, y / this.G + this.bb.y0]; };
  CircuitSchematic.prototype.px = function (p) { return [(p[0] - this.bb.x0) * this.G, (p[1] - this.bb.y0) * this.G]; };

  /* ---------- colors ---------- */
  CircuitSchematic.prototype.theme = function () {
    var cs = getComputedStyle(this.cv);
    function v(n, d) { return cs.getPropertyValue(n).trim() || d; }
    this.col = {
      ink: v('--ink', '#1E262C'), muted: v('--muted', '#5F6B72'), bg: v('--surface', '#fff'), sel: v('--link', '#1F5FA8'),
      pos: v('--sch-pos', '#1f9d55'), neg: v('--sch-neg', '#d64545'), zero: v('--sch-zero', '#8a8f94'), dot: v('--sch-dot', '#e0a100'),
      rule: v('--rule', '#ccd3ce'), chip: v('--chip', '#E7ECE8'), warn: v('--warn', '#A33A2B')
    };
  };
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    var A = hexToRgb(a), B = hexToRgb(b);
    return 'rgb(' + A.map(function (x, i) { return Math.round(x + (B[i] - x) * t); }).join(',') + ')';
  }
  CircuitSchematic.prototype.vcol = function (v) {
    if (!this.opts.voltColor || !isFinite(v)) return this.col.ink;
    var t = Math.max(-1, Math.min(1, v / this.vmax));
    return t >= 0 ? mix(this.col.zero, this.col.pos, Math.sqrt(t)) : mix(this.col.zero, this.col.neg, Math.sqrt(-t));
  };
  CircuitSchematic.prototype.isSel = function (kind, key) {
    if (kind === 'parts' && this.sel === key) return true;
    return !!(this.selSet && this.selSet[kind] && this.selSet[kind][key]);
  };
  CircuitSchematic.prototype.font = function (k, weight, mono) {
    return (weight ? weight + ' ' : '') + Math.round(Math.max(9.5, this.G * k)) + 'px ' + (mono ? '"IBM Plex Mono", ui-monospace, monospace' : '"Noto Sans TC", system-ui, sans-serif');
  };

  /* ---------- per-frame draw ---------- */
  CircuitSchematic.prototype.frame = function (live, dtReal) {
    if (!this.doc) return;
    this.theme();
    var ctx = this.ctx, G = this.G, self = this, doc = this.doc, built = this.built;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    var netV = {}, vm = 0;
    function nv(net) {
      if (netV[net] === undefined) { netV[net] = live ? live.v(net) : NaN; if (isFinite(netV[net])) vm = Math.max(vm, Math.abs(netV[net])); }
      return netV[net];
    }
    this.nv = nv;
    doc.parts.forEach(function (p) { p.nets.forEach(nv); });
    this.vmax = this.vmax * 0.9 + Math.max(vm, 1e-6) * 0.1;
    if (vm > this.vmax) this.vmax = vm;
    var lw = Math.max(1.2, G * 0.085);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    /* annotations first, so everything else draws over them */
    (doc.texts || []).forEach(function (t, i) {
      var P = self.px(t.at), head = /h/.test(t.flag), fz = G * (head ? 0.75 : 0.55);
      if (fz < 5) return;
      ctx.font = (head ? '700 ' : '') + fz.toFixed(1) + 'px "Noto Sans TC", system-ui, sans-serif';
      ctx.fillStyle = self.isSel('texts', i) ? self.col.sel : (head ? self.col.ink : self.col.muted);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(t.text, P[0], P[1]);
    });
    /* wires */
    doc.wires.forEach(function (w, i) {
      var a = self.px(w.a), b = self.px(w.b), net = built.netAt(w.a);
      if (self.isSel('wires', i)) {
        ctx.strokeStyle = self.col.sel; ctx.globalAlpha = 0.35; ctx.lineWidth = lw * 4;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = self.vcol(nv(net)); ctx.lineWidth = lw;
      if (self.hoverHit && self.hoverHit.net === net) ctx.lineWidth = lw * 2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });
    /* junction dots */
    ctx.fillStyle = this.col.ink;
    Object.keys(built.count).forEach(function (k) {
      if (built.count[k] < 3) return;
      var q = k.split(',').map(Number), P = self.px(q);
      ctx.fillStyle = self.vcol(nv(built.netAt(q)));
      ctx.beginPath(); ctx.arc(P[0], P[1], lw * 1.6, 0, 7); ctx.fill();
    });
    /* grounds */
    doc.grounds.forEach(function (g, i) {
      var P = self.px(g.at);
      ctx.strokeStyle = self.vcol(0); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(P[0], P[1] + G * 0.5); ctx.stroke();
      ctx.strokeStyle = self.isSel('grounds', i) ? self.col.sel : self.col.ink;
      [0.55, 0.36, 0.17].forEach(function (hw, k) {
        var y = P[1] + G * (0.5 + k * 0.18);
        ctx.beginPath(); ctx.moveTo(P[0] - hw * G, y); ctx.lineTo(P[0] + hw * G, y); ctx.stroke();
      });
    });
    /* parts */
    var currents = {}, im = 1e-15;
    doc.parts.forEach(function (p) {
      var pc = live && live.pin && !CS.MACRO_TYPES[p.type] ? live.pin(p.name) : null;
      currents[p.name] = pc;
      if (pc) pc.forEach(function (c) { if (isFinite(c)) im = Math.max(im, Math.abs(c)); });
    });
    this.imax = this.imax * 0.95 + im * 0.05;
    if (im > this.imax) this.imax = im;
    doc.parts.forEach(function (p) {
      self.drawPart(p, nv, live, lw);
    });
    /* current dots */
    if (this.opts.currentDots && live) {
      var dt = Math.min(dtReal || 0.016, 0.05);
      doc.parts.forEach(function (p) {
        var pc = currents[p.name]; if (!pc) return;
        self.partPaths(p).forEach(function (path, i) {
          var I = path.cur(pc);
          self.dots(p.name + ':' + i, path.pts, I, dt);
        });
      });
      this.wireNets.forEach(function (wn) {
        var inj = {};
        var okNet = true;
        wn.terminals.forEach(function (t) {
          var pc = currents[t.part];
          if (!pc || !isFinite(pc[t.pin])) { okNet = false; return; }
          inj[t.key] = (inj[t.key] || 0) - pc[t.pin];        // current leaving the part pin into the wire network
        });
        if (!okNet) return;
        var flows = solveTree(wn, inj);
        if (!flows) return;
        flows.forEach(function (f, i) { self.dots('w' + wn.id + ':' + i, [self.px(f.a), self.px(f.b)], f.i, dt); });
      });
    }
    /* labels */
    doc.labels.forEach(function (l, i) {
      var P = self.px(l.at), v = nv(l.name), txt = l.name + (live && self.opts.values && self.lod('values') ? '  ' + CS.fmt(v, 'V', 3) : '');
      ctx.font = self.font(0.5, 600, true);
      var tw = ctx.measureText(txt).width, f = l.flag || '', x = P[0] + 6, y = P[1] - 8;
      if (/l/.test(f)) x = P[0] - 6 - tw;
      else if (/a/.test(f)) { x = P[0] - tw / 2; y = P[1] - G * 0.55; }
      else if (/b/.test(f)) { x = P[0] - tw / 2; y = P[1] + G * 1.05; }
      var fs = Math.max(9.5, G * 0.5);
      ctx.fillStyle = self.col.bg; ctx.globalAlpha = 0.85; ctx.fillRect(x - 3, y - fs, tw + 6, fs * 1.24); ctx.globalAlpha = 1;
      ctx.fillStyle = self.col.sel; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (self.isSel('labels', i)) { ctx.strokeStyle = self.col.sel; ctx.lineWidth = 1; ctx.strokeRect(x - 3, y - fs, tw + 6, fs * 1.24); }
      ctx.fillText(txt, x, y);
      ctx.beginPath(); ctx.arc(P[0], P[1], lw * 1.5, 0, 7); ctx.fill();
    });
    if (this.opts.overlay) this.opts.overlay(ctx, this);
  };

  CircuitSchematic.prototype.dots = function (key, pts, I, dt) {
    if (!isFinite(I) || Math.abs(I) < this.imax * 2e-4) return;
    var ctx = this.ctx, G = this.G, len = [], tot = 0;
    for (var i = 1; i < pts.length; i++) { var d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); len.push(d); tot += d; }
    if (tot < 1) return;
    var speed = G * 3.2 * Math.sqrt(Math.min(1, Math.abs(I) / this.imax)) * (I > 0 ? 1 : -1);
    var ph = ((this.phase[key] || 0) + speed * dt) % (G * 0.9);
    if (ph < 0) ph += G * 0.9;
    this.phase[key] = ph;
    ctx.fillStyle = this.col.dot;
    for (var s = ph; s < tot; s += G * 0.9) {
      var acc = 0, seg = 0;
      while (seg < len.length - 1 && acc + len[seg] < s) { acc += len[seg]; seg++; }
      var t = (s - acc) / len[seg], a = pts[seg], b = pts[seg + 1];
      ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.max(1.8, G * 0.1), 0, 7); ctx.fill();
    }
  };

  /* current paths through a part (pixel polylines) and how to read their current */
  CircuitSchematic.prototype.partPaths = function (p) {
    var self = this, P = function (q) { return self.px(q); };
    if (CS.MACRO_TYPES[p.type]) return [];
    if (p.pins.length === 2) return [{pts: [P(p.pins[0]), P(p.pins[1])], cur: function (pc) { return pc[0]; }}];
    var pin = p.pins;
    if (p.type === 'U') return [{pts: [P([p.at[0] + 3.4 * (/h/.test(p.flag) ? -1 : 1), p.at[1]]), P(pin[2])], cur: function (pc) { return -pc[2]; }}];
    var h = /h/.test(p.flag) ? -1 : 1, cx = [p.at[0] + h, p.at[1]];
    return [
      {pts: [P(pin[0]), P([pin[0][0], cx[1] + (pin[0][1] - cx[1]) * 0.5]), P(cx)], cur: function (pc) { return pc[0]; }},
      {pts: [P(pin[1]), P(cx)], cur: function (pc) { return pc[1]; }},
      {pts: [P(cx), P([pin[2][0], cx[1] + (pin[2][1] - cx[1]) * 0.5]), P(pin[2])], cur: function (pc) { return -pc[2]; }}
    ];
  };

  /* ---------- symbols ---------- */
  CircuitSchematic.prototype.drawPart = function (p, nv, live, lw) {
    var ctx = this.ctx, G = this.G, self = this, col = this.col;
    var selected = this.isSel('parts', p.name), hov = this.hoverHit && this.hoverHit.part === p.name;
    var ink = selected ? col.sel : col.ink;
    ctx.lineWidth = lw;
    if (p.type === 'IC') return this.drawIC(p, nv, lw, selected || hov, ink);
    if (p.type === 'ELEC') return this.drawElec(p, nv, live, lw, selected || hov, ink);
    if (p.type === 'J') return this.drawJ(p, nv, lw, selected || hov, ink);
    if (p.pins.length === 2) {
      var a = this.px(p.pins[0]), b = this.px(p.pins[1]), dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1) return;
      var ux = dx / L, uy = dy / L, body = Math.min(L, G * 2), s0 = (L - body) / 2;
      var A = [a[0] + ux * s0, a[1] + uy * s0], B = [a[0] + ux * (s0 + body), a[1] + uy * (s0 + body)];
      ctx.strokeStyle = this.vcol(nv(p.nets[0])); line(ctx, a, A);
      ctx.strokeStyle = this.vcol(nv(p.nets[1])); line(ctx, B, b);
      ctx.save(); ctx.translate(A[0], A[1]); ctx.rotate(Math.atan2(uy, ux));
      if (selected || hov) { ctx.fillStyle = col.sel; ctx.globalAlpha = selected ? 0.2 : 0.12; ctx.fillRect(-4, -G * 0.62, body + 8, G * 1.24); ctx.globalAlpha = 1; }
      ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = lw;
      symbol2(ctx, p, body, G, live, col);
      ctx.restore();
      if (this.opts.values && this.lod('values')) this.label(p, a, b, ux, uy);
      return;
    }
    /* three-pin parts */
    var pin = p.pins.map(function (q) { return self.px(q); }), at = this.px(p.at), h = /h/.test(p.flag) ? -1 : 1;
    if (selected || hov) {
      ctx.fillStyle = col.sel; ctx.globalAlpha = selected ? 0.2 : 0.12;
      if (p.type === 'U') ctx.fillRect(Math.min(at[0], pin[2][0]) - 4, at[1] - 2 * G, 4 * G + 8, 4 * G);
      else ctx.fillRect(Math.min(at[0], pin[0][0]) - 4, pin[0][1] < pin[2][1] ? pin[0][1] : pin[2][1], Math.abs(pin[0][0] - at[0]) + 2 * G, 4 * G);
      ctx.globalAlpha = 1;
    }
    if (p.type === 'U') {
      var x0 = at[0] + h * G, xa = at[0] + h * 3.4 * G, y = at[1];
      ctx.strokeStyle = this.vcol(nv(p.nets[1])); line(ctx, pin[1], [x0, pin[1][1]]);
      ctx.strokeStyle = this.vcol(nv(p.nets[0])); line(ctx, pin[0], [x0, pin[0][1]]);
      ctx.strokeStyle = this.vcol(nv(p.nets[2])); line(ctx, [xa, y], pin[2]);
      ctx.strokeStyle = ink;
      ctx.beginPath(); ctx.moveTo(x0, y - 1.8 * G); ctx.lineTo(x0, y + 1.8 * G); ctx.lineTo(xa, y); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = ink; ctx.font = '600 ' + Math.round(G * 0.75) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('−', x0 + h * 0.45 * G, pin[1][1]); ctx.fillText('+', x0 + h * 0.45 * G, pin[0][1]);
      if (this.opts.values && this.lod('values')) {
        ctx.font = this.font(0.48, 0, true);
        ctx.fillStyle = selected ? col.sel : col.muted; ctx.textAlign = h > 0 ? 'left' : 'right'; ctx.textBaseline = 'top';
        ctx.fillText(p.name, x0 + h * 0.4 * G, y + 1.9 * G);
      }
      return;
    }
    /* BJT / MOSFET: pins C/D, B/G, E/S */
    var bx = at[0] + h * G, cy = at[1];
    ctx.strokeStyle = this.vcol(nv(p.nets[1])); line(ctx, pin[1], [bx - h * (p.type === 'M' ? 0.25 * G : 0), cy]);
    var cTop = [bx, cy + (pin[0][1] - cy) * 0.3], eBot = [bx, cy + (pin[2][1] - cy) * 0.3];
    var cKnee = [pin[0][0], cy + (pin[0][1] - cy) * 0.55], eKnee = [pin[2][0], cy + (pin[2][1] - cy) * 0.55];
    if (p.type === 'Q') {
      ctx.strokeStyle = this.vcol(nv(p.nets[0])); line(ctx, cTop, cKnee); line(ctx, cKnee, pin[0]);
      ctx.strokeStyle = this.vcol(nv(p.nets[2])); line(ctx, eBot, eKnee); line(ctx, eKnee, pin[2]);
      ctx.strokeStyle = ink; ctx.lineWidth = lw * 1.8; line(ctx, [bx, cy - 0.65 * G], [bx, cy + 0.65 * G]); ctx.lineWidth = lw;
      /* emitter arrow */
      var pnp = p.params.type === 'pnp', from = pnp ? eKnee : eBot, to = pnp ? eBot : eKnee;
      arrowHead(ctx, from, to, G * 0.42, ink, pnp ? 0.15 : 0.85);
      ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, lw * 0.6);
      ctx.beginPath(); ctx.arc(bx + h * 0.45 * G, cy, 1.15 * G, 0, 7); ctx.stroke(); ctx.lineWidth = lw;
    } else {
      var gx = bx - h * 0.25 * G;
      ctx.strokeStyle = ink; line(ctx, [gx, cy - 0.7 * G], [gx, cy + 0.7 * G]);
      ctx.lineWidth = lw * 1.6; line(ctx, [bx, cy - 0.85 * G], [bx, cy + 0.85 * G]); ctx.lineWidth = lw;
      var dY = cy + (pin[0][1] - cy) * 0.3, sY = cy + (pin[2][1] - cy) * 0.3;
      ctx.strokeStyle = this.vcol(nv(p.nets[0])); line(ctx, [bx, dY], [pin[0][0], dY]); line(ctx, [pin[0][0], dY], pin[0]);
      ctx.strokeStyle = this.vcol(nv(p.nets[2])); line(ctx, [bx, sY], [pin[2][0], sY]); line(ctx, [pin[2][0], sY], pin[2]);
      var isP = p.params.type === 'pmos';
      arrowHead(ctx, isP ? [bx, sY] : [pin[2][0], sY], isP ? [pin[2][0], sY] : [bx, sY], G * 0.38, ink, 0.6);
    }
    if (this.opts.values && this.lod('values')) {
      ctx.font = this.font(0.48, 0, true);
      ctx.fillStyle = selected ? col.sel : col.muted; ctx.textAlign = h > 0 ? 'left' : 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(p.name, bx + h * 1.75 * G, cy);
    }
  };

  /* multi-pin IC: body, stubs colored by net voltage, pin names inside, pin numbers outside */
  CircuitSchematic.prototype.drawIC = function (p, nv, lw, hl, ink) {
    var ctx = this.ctx, G = this.G, col = this.col, def = CS.IC_LIB[p.sym], self = this;
    var A = this.px(p.at), w = def.w * G, h = def.h * G;
    ctx.fillStyle = col.chip; ctx.fillRect(A[0], A[1], w, h);
    if (hl) { ctx.fillStyle = col.sel; ctx.globalAlpha = 0.1; ctx.fillRect(A[0], A[1], w, h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = ink; ctx.lineWidth = lw * 1.4; ctx.strokeRect(A[0], A[1], w, h); ctx.lineWidth = lw;
    var fs = Math.max(7.5, G * 0.52), names = this.lod('pinname'), nums = this.lod('pinnum');
    def.pins.forEach(function (pd, i) {
      var P = self.px(p.pins[i]), E;
      if (pd.side === 'l') E = [A[0], P[1]]; else if (pd.side === 'r') E = [A[0] + w, P[1]];
      else if (pd.side === 't') E = [P[0], A[1]]; else E = [P[0], A[1] + h];
      ctx.strokeStyle = self.vcol(nv(p.nets[i])); line(ctx, E, P);
      if (!names) return;
      ctx.fillStyle = pd.kind === 'd' ? col.muted : ink;
      ctx.font = (pd.kind === 'p' ? '600 ' : '') + Math.round(fs) + 'px "IBM Plex Mono", ui-monospace, monospace';
      var pad = G * 0.3;
      ctx.save();
      if (pd.side === 'l' || pd.side === 'r') {
        ctx.textBaseline = 'middle'; ctx.textAlign = pd.side === 'l' ? 'left' : 'right';
        ctx.fillText(pd.name, E[0] + (pd.side === 'l' ? pad : -pad), E[1]);
        if (pd.num && nums) {
          ctx.font = Math.round(Math.max(8, G * 0.3)) + 'px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = col.muted;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(pd.num, (E[0] + P[0]) / 2, E[1] - 2);
        }
      } else {
        ctx.translate(E[0], E[1]); ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = 'middle'; ctx.textAlign = pd.side === 't' ? 'right' : 'left';
        ctx.fillText(pd.name, pd.side === 't' ? -pad : pad, 0);
        if (pd.num && nums) {
          ctx.font = Math.round(Math.max(8, G * 0.3)) + 'px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = col.muted;
          ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
          var off = (pd.side === 't' ? 1 : -1) * Math.abs(P[1] - E[1]) / 2;
          ctx.fillText(pd.num, off, -2);
        }
      }
      ctx.restore();
    });
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(Math.max(12, G * 0.9)) + 'px "Noto Sans TC", system-ui, sans-serif';
    ctx.fillText(def.title, A[0] + w / 2, A[1] + h / 2 - G * 0.6);
    if (this.lod('values')) {
      ctx.font = this.font(0.5, 0, true); ctx.fillStyle = col.muted;
      ctx.fillText(p.name + (def.sub ? ' · ' + def.sub : ''), A[0] + w / 2, A[1] + h / 2 + G * 0.5);
    }
  };

  /* electrode: lead stub, electrode disc on the skin, name; dashed when the contact is off */
  CircuitSchematic.prototype.drawElec = function (p, nv, live, lw, hl, ink) {
    var ctx = this.ctx, G = this.G, col = this.col, u = ELEC_DIR[elecDir(p)], P = this.px(p.at);
    var on = live && live.on ? live.on('K:' + p.name) !== false : true;
    var Q = [P[0] + u[0] * 1.3 * G, P[1] + u[1] * 1.3 * G], C = [P[0] + u[0] * 1.9 * G, P[1] + u[1] * 1.9 * G], r = 0.55 * G;
    ctx.strokeStyle = this.vcol(nv(p.nets[0])); line(ctx, P, Q);
    if (hl) { ctx.fillStyle = col.sel; ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.arc(C[0], C[1], r * 1.8, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    /* skin: an arc behind the disc */
    var back = [C[0] + u[0] * 0.75 * G, C[1] + u[1] * 0.75 * G], ang = Math.atan2(-u[1], -u[0]);
    ctx.strokeStyle = col.muted; ctx.lineWidth = lw * 0.9; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(back[0] + u[0] * 1.2 * G, back[1] + u[1] * 1.2 * G, 1.2 * G, ang - 0.75, ang + 0.75); ctx.stroke();
    ctx.lineWidth = lw;
    if (!on) ctx.setLineDash([3, 3]);
    ctx.strokeStyle = ink; ctx.fillStyle = col.bg;
    ctx.beginPath(); ctx.arc(C[0], C[1], r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = on ? ink : col.warn; ctx.beginPath(); ctx.arc(C[0], C[1], r * 0.35, 0, 7); ctx.fill();
    if (on) line(ctx, Q, [C[0] - u[0] * r, C[1] - u[1] * r]);
    var T = [C[0] + u[0] * 1.6 * G, C[1] + u[1] * 1.6 * G];
    ctx.textBaseline = 'middle';
    ctx.textAlign = u[0] < 0 ? 'right' : u[0] > 0 ? 'left' : 'center';
    if (u[1]) T = [C[0], C[1] + u[1] * 1.5 * G];
    ctx.font = '700 ' + Math.round(Math.max(9, G * 0.62)) + 'px "Noto Sans TC", system-ui, sans-serif'; ctx.fillStyle = ink;
    ctx.fillText(p.name, T[0], T[1] - (u[1] || !this.lod('values') ? 0 : G * 0.28));
    if (this.opts.values && this.lod('values')) {
      ctx.font = this.font(0.38, 0, true); ctx.fillStyle = on ? col.muted : col.warn;
      ctx.fillText(on ? (p.params.TYPE || 'wet') : '脫落', T[0], T[1] + (u[1] ? u[1] * G * 0.7 : G * 0.42));
    }
  };

  CircuitSchematic.prototype.drawJ = function (p, nv, lw, hl, ink) {
    var ctx = this.ctx, G = this.G, col = this.col, P = this.px(p.at), f = p.flag || 'a';
    if (hl) { ctx.fillStyle = col.sel; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(P[0], P[1], G * 0.6, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = ink; ctx.fillStyle = col.bg; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(P[0], P[1], Math.max(2, G * 0.2), 0, 7); ctx.fill(); ctx.stroke();
    if (!this.lod('values')) return;
    var txt = p.name.replace(/^J:/, ''), x = P[0], y = P[1];
    ctx.font = this.font(0.4, 600, true); ctx.fillStyle = col.muted;
    if (/b/.test(f)) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; y += G * 0.35; }
    else if (/l/.test(f)) { ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; x -= G * 0.35; }
    else if (/r/.test(f)) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; x += G * 0.35; }
    else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; y -= G * 0.3; }
    ctx.fillText(txt, x, y);
  };

  function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  function arrowHead(ctx, from, to, size, color, at) {
    var x = from[0] + (to[0] - from[0]) * at, y = from[1] + (to[1] - from[1]) * at, ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * size * 0.5, y + Math.sin(ang) * size * 0.5);
    ctx.lineTo(x + Math.cos(ang + 2.6) * size * 0.6, y + Math.sin(ang + 2.6) * size * 0.6);
    ctx.lineTo(x + Math.cos(ang - 2.6) * size * 0.6, y + Math.sin(ang - 2.6) * size * 0.6);
    ctx.closePath(); ctx.fill();
  }

  /* draw the body of a two-pin part along +x from 0 to len */
  function symbol2(ctx, p, len, G, live, col) {
    var t = p.type, h = G * 0.32, i;
    ctx.beginPath();
    if (t === 'R') {
      ctx.moveTo(0, 0);
      var n = 6, seg = len / (n * 2);
      for (i = 0; i < n * 2; i++) ctx.lineTo(seg * (i + 0.5), (i % 2 ? 1 : -1) * h);
      ctx.lineTo(len, 0); ctx.stroke();
    } else if (t === 'C') {
      var g = G * 0.16;
      ctx.moveTo(0, 0); ctx.lineTo(len / 2 - g, 0); ctx.moveTo(len / 2 + g, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.lineWidth *= 1.5; ctx.beginPath();
      ctx.moveTo(len / 2 - g, -G * 0.55); ctx.lineTo(len / 2 - g, G * 0.55);
      ctx.moveTo(len / 2 + g, -G * 0.55); ctx.lineTo(len / 2 + g, G * 0.55); ctx.stroke();
    } else if (t === 'L') {
      var nb = 4, r = len / (nb * 2);
      ctx.moveTo(0, 0);
      for (i = 0; i < nb; i++) ctx.arc(r * (2 * i + 1), 0, r, Math.PI, 0, false);
      ctx.stroke();
    } else if (t === 'V' || t === 'I') {
      var R = Math.min(len / 2, G * 0.7);
      ctx.moveTo(0, 0); ctx.lineTo(len / 2 - R, 0); ctx.moveTo(len / 2 + R, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(len / 2, 0, R, 0, 7); ctx.stroke();
      ctx.save(); ctx.translate(len / 2, 0);
      if (t === 'V') {
        var w = p.params.wave, kind = typeof w === 'string' ? (/^\s*(\w+)/.exec(w) || [])[1] : 'DC';
        ctx.font = '600 ' + Math.round(G * 0.5) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (kind && /SIN/i.test(kind)) {
          ctx.beginPath(); for (i = 0; i <= 20; i++) { var xx = -R * 0.55 + R * 1.1 * i / 20, yy = -Math.sin(i / 20 * 2 * Math.PI) * R * 0.3; if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); } ctx.stroke();
        } else if (kind && /PULSE|SQUARE|PWL/i.test(kind)) {
          ctx.beginPath(); ctx.moveTo(-R * 0.55, R * 0.25); ctx.lineTo(-R * 0.2, R * 0.25); ctx.lineTo(-R * 0.2, -R * 0.25); ctx.lineTo(R * 0.2, -R * 0.25); ctx.lineTo(R * 0.2, R * 0.25); ctx.lineTo(R * 0.55, R * 0.25); ctx.stroke();
        }
        ctx.restore();
        /* + at pin 1 side, - at pin 2 side (SPICE: first node is +) */
        ctx.save(); ctx.font = '700 ' + Math.round(G * 0.5) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        drawUpright(ctx, '+', len / 2 - R - G * 0.05, -G * 0.45);
        drawUpright(ctx, '−', len / 2 + R + G * 0.05, -G * 0.45);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.moveTo(-R * 0.55, 0); ctx.lineTo(R * 0.5, 0); ctx.stroke();
        arrowHead(ctx, [-R * 0.5, 0], [R * 0.6, 0], G * 0.45, ctx.strokeStyle, 0.85);
        ctx.restore();
      }
    } else if (t === 'D') {
      var c = len / 2, s = G * 0.45;
      ctx.moveTo(0, 0); ctx.lineTo(c - s, 0); ctx.moveTo(c + s * 0.7, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c - s, -s); ctx.lineTo(c - s, s); ctx.lineTo(c + s * 0.7, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(c + s * 0.7, -s); ctx.lineTo(c + s * 0.7, s); ctx.stroke();
      if (p.params.BV) { ctx.beginPath(); ctx.moveTo(c + s * 0.7, -s); ctx.lineTo(c + s * 1.1, -s); ctx.moveTo(c + s * 0.7, s); ctx.lineTo(c + s * 0.3, s); ctx.stroke(); }
    } else if (t === 'TVS') {
      /* two triangles tip to tip on a zener bar */
      var m = len / 2, z = G * 0.38;
      ctx.moveTo(0, 0); ctx.lineTo(m - 2 * z, 0); ctx.moveTo(m + 2 * z, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m - 2 * z, -z); ctx.lineTo(m - 2 * z, z); ctx.lineTo(m, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(m + 2 * z, -z); ctx.lineTo(m + 2 * z, z); ctx.lineTo(m, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(m - z * 0.4, -z * 1.25); ctx.lineTo(m, -z); ctx.lineTo(m, z); ctx.lineTo(m + z * 0.4, z * 1.25); ctx.stroke();
    } else if (t === 'SW') {
      var on = live && live.on ? live.on(p.name) : p.params.on !== false;
      ctx.moveTo(0, 0); ctx.lineTo(len * 0.22, 0); ctx.moveTo(len * 0.78, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(len * 0.22, 0, G * 0.12, 0, 7); ctx.arc(len * 0.78, 0, G * 0.12, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(len * 0.22, 0);
      if (on) ctx.lineTo(len * 0.78, 0); else ctx.lineTo(len * 0.72, -G * 0.6);
      ctx.lineWidth *= 1.4; ctx.stroke();
    }
  }
  function ctxAngle(ctx) { var m = ctx.getTransform(); return Math.atan2(m.b, m.a); }
  function drawUpright(ctx, txt, x, y) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-ctxAngle(ctx)); ctx.fillText(txt, 0, 0); ctx.restore();
  }

  CircuitSchematic.prototype.label = function (p, a, b, ux, uy) {
    var ctx = this.ctx, G = this.G, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, horiz = Math.abs(ux) > Math.abs(uy);
    var val = valueText(p);
    ctx.font = this.font(0.48, 0, true);
    ctx.fillStyle = this.isSel('parts', p.name) ? this.col.sel : this.col.muted;
    if (horiz) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(p.name, mx, my - G * 0.62);
      if (val) { ctx.textBaseline = 'top'; ctx.fillText(val, mx, my + G * 0.62); }
    } else {
      var left = /l/.test(p.flag || ''), lx = left ? mx - G * 0.8 : mx + G * 0.8;
      ctx.textAlign = left ? 'right' : 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(p.name, lx, my - (val ? G * 0.32 : 0));
      if (val) ctx.fillText(val, lx, my + G * 0.32);
    }
  };
  function valueText(p) {
    var v = p.params, f = CS.fmt;
    switch (p.type) {
      case 'R': return f(v.value, 'Ω');
      case 'C': return f(v.value, 'F');
      case 'L': return f(v.value, 'H');
      case 'V': case 'I': {
        var w = v.wave, u = p.type === 'V' ? 'V' : 'A';
        if (typeof w === 'number') return f(w, u);
        var m = /^\s*(SIN|PULSE|SQUARE|PWL)\s*\(([^)]*)\)/i.exec(w || '');
        if (!m) return '';
        var a = m[2].trim().split(/[\s,]+/).map(CS.num);
        if (/SIN/i.test(m[1])) return f(a[1], u) + ' ' + f(a[2], 'Hz');
        if (/SQUARE/i.test(m[1])) return f(a[1] - a[0], u) + ' ' + f(a[2], 'Hz');
        if (/PULSE/i.test(m[1])) return f(a[1], u) + (a[6] ? ' ' + f(1 / a[6], 'Hz') : '');
        return 'PWL';
      }
      case 'SW': return '';
      case 'D': return v.BV ? 'BV ' + f(+v.BV, 'V') : '';
      case 'TVS': return '±' + f(CS.num(v.BV || 6), 'V');
    }
    return '';
  }

  /* ---------- hit testing ---------- */
  /* -> {part} | {wire: i, net} | {label: i, net} | {ground: i} | {text: i} | null */
  CircuitSchematic.prototype.hit = function (x, y) {
    var G = this.G, best = null, bd = G * 0.7, self = this;
    this.doc.parts.forEach(function (p) {
      var d;
      if (p.type === 'IC') {
        var def = CS.IC_LIB[p.sym], A = self.px(p.at);
        d = (x >= A[0] && x <= A[0] + def.w * G && y >= A[1] && y <= A[1] + def.h * G) ? 0 : Infinity;
      } else if (p.type === 'ELEC') {
        var u = ELEC_DIR[elecDir(p)], P = self.px(p.at), C = [P[0] + u[0] * 1.9 * G, P[1] + u[1] * 1.9 * G];
        d = Math.min(Math.max(0, Math.hypot(x - C[0], y - C[1]) - G * 0.8), segDist([x, y], P, C));
      } else if (p.type === 'J') {
        var Pj = self.px(p.at); d = Math.max(0, Math.hypot(x - Pj[0], y - Pj[1]) - G * 0.35);
      } else if (p.pins.length === 2) d = segDist([x, y], self.px(p.pins[0]), self.px(p.pins[1]));
      else {
        var at = self.px(p.at), h = /h/.test(p.flag) ? -1 : 1, cx = at[0] + h * (p.type === 'U' ? 2.2 : 1.2) * G;
        d = Math.max(0, Math.hypot(x - cx, y - at[1]) - G * 1.4);
      }
      if (d < bd) { bd = d; best = {part: p.name}; }
    });
    if (best) return best;
    this.doc.labels.forEach(function (l, i) {
      var P = self.px(l.at), d = Math.hypot(x - P[0], y - P[1]);
      if (d < G * 0.6 || (Math.abs(y - P[1] + 8) < G * 0.5 && x > P[0] && x < P[0] + G * 3 && !/[lab]/.test(l.flag || ''))) best = {label: i, net: l.name};
    });
    if (best) return best;
    this.doc.grounds.forEach(function (g, i) {
      var P = self.px(g.at);
      if (Math.abs(x - P[0]) < G * 0.6 && y > P[1] - G * 0.2 && y < P[1] + G * 0.95) best = {ground: i};
    });
    if (best) return best;
    bd = G * 0.45;
    this.doc.wires.forEach(function (w, i) {
      var d = segDist([x, y], self.px(w.a), self.px(w.b));
      if (d < bd) { bd = d; best = {wire: i, net: self.built.netAt(w.a)}; }
    });
    if (best) return best;
    (this.doc.texts || []).forEach(function (t, i) {
      var P = self.px(t.at), k = /h/.test(t.flag) ? 0.75 : 0.55, w = textWidth(t.text) * k * G;
      if (x >= P[0] && x <= P[0] + w && y <= P[1] + 2 && y >= P[1] - k * G * 1.1) best = {text: i};
    });
    return best;
  };
  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    var t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  CircuitSchematic.prototype.select = function (name) { this.sel = name; };

  /* ---------- wire currents ----------
     Each wire-connected group of points forms a tree.  Part pins inject current; a ground symbol
     or a net label is an unknown sink.  With at most one sink the branch currents follow from KCL. */
  function buildWireTrees(doc, built) {
    var adj = {}, edges = [], key = function (p) { return p[0] + ',' + p[1]; };
    doc.wires.forEach(function (w, i) {
      var a = key(w.a), b = key(w.b);
      (adj[a] = adj[a] || []).push(i); (adj[b] = adj[b] || []).push(i);
      edges.push({a: w.a, b: w.b, ka: a, kb: b});
    });
    var seen = {}, groups = [], id = 0;
    Object.keys(adj).forEach(function (start) {
      if (seen[start]) return;
      var stack = [start], pts = [], es = {};
      seen[start] = true;
      while (stack.length) {
        var k = stack.pop(); pts.push(k);
        adj[k].forEach(function (ei) {
          es[ei] = true;
          var e = edges[ei], o = e.ka === k ? e.kb : e.ka;
          if (!seen[o]) { seen[o] = true; stack.push(o); }
        });
      }
      var elist = Object.keys(es).map(Number);
      if (elist.length !== pts.length - 1) return;           // loop of wires: skip
      var ptset = {}; pts.forEach(function (k) { ptset[k] = true; });
      var terminals = [], sinks = [];
      doc.parts.forEach(function (p) { p.pins.forEach(function (q, pi) { if (ptset[key(q)]) terminals.push({part: p.name, pin: pi, key: key(q)}); }); });
      doc.grounds.forEach(function (g) { if (ptset[key(g.at)]) sinks.push(key(g.at)); });
      doc.labels.forEach(function (l) { if (ptset[key(l.at)]) sinks.push(key(l.at)); });
      if (sinks.length > 1) return;
      /* the root absorbs whatever does not balance, so it must be the sink when there is one */
      groups.push({id: id++, pts: pts, edges: elist.map(function (i) { return edges[i]; }), terminals: terminals, root: sinks[0] || pts[0]});
    });
    return groups;
  }
  function solveTree(g, inj) {
    /* DFS from root; current on each edge = net injection of the subtree below it, flowing toward the root */
    var parentEdge = {}, order = [], seen = {}, stack = [g.root];
    seen[g.root] = true;
    var nb = {};
    g.edges.forEach(function (e) { (nb[e.ka] = nb[e.ka] || []).push(e.kb); (nb[e.kb] = nb[e.kb] || []).push(e.ka); });
    while (stack.length) {
      var k = stack.pop(); order.push(k);
      (nb[k] || []).forEach(function (o) { if (!seen[o]) { seen[o] = true; parentEdge[o] = k; stack.push(o); } });
    }
    var sub = {}, out = [];
    for (var i = order.length - 1; i >= 0; i--) {
      var k2 = order[i], s = (inj[k2] || 0) + (sub[k2] || 0);
      if (parentEdge[k2] !== undefined) {
        var par = parentEdge[k2];
        sub[par] = (sub[par] || 0) + s;
        var a = k2.split(',').map(Number), b = par.split(',').map(Number);
        out.push({a: a, b: b, i: s});                         // s flows from child (a) toward parent (b)
      }
    }
    return out;
  }

  CircuitSchematic.contentBox = contentBox;
  CircuitSchematic.ELEC_DIR = ELEC_DIR;
  CircuitSchematic.elecDir = elecDir;
  global.CircuitSchematic = CircuitSchematic;
})(window);
