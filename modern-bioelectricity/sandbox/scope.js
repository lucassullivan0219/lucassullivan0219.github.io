/* Sandbox! oscilloscope: a two-channel scope front panel you operate with its own buttons and knobs.

   var sc = Scope(element);
   sc.push(t, v1, v2)        one sample (seconds, volts; v2 may be NaN when CH2 has no probe)
   sc.draw()                 redraw the screen (call once per animation frame)
   sc.setLabels(['Vm', ''])  probe node names shown on screen
   sc.measure()              {c1:{max,min,pp}, c2:{...}} over what is on screen
   sc.clear()                drop all samples
   sc.onChange = fn          called after any panel setting changes

   Acquisition (like a real DSO):
     AUTO   free-running roll display, newest sample at the right edge
     NORMAL waits for the trigger (source / slope / level), shows each captured sweep until the next one
     SINGLE one triggered sweep, then STOP
   RUN/STOP freezes or resumes the screen.  The AUTO key is autoset (fits V/div to the signal).
   Knobs: click the right half = clockwise, left half = counter-clockwise; mouse wheel; drag up / down. */
(function(){
  'use strict';
  var CSS = [
    '.osc{position:relative;width:560px;height:372px;border-radius:22px;border:3px solid #0a0d12;user-select:none;font-family:"Nunito",sans-serif;color:#dfe5ee;',
    '  background:linear-gradient(#4a525e,#353b45 8%,#2c3139);box-shadow:0 7px 0 #0a0d12,inset 0 2px 0 rgba(255,255,255,.18),inset 0 -3px 0 rgba(0,0,0,.35);transform-origin:0 0}',
    '.osc-top{position:absolute;left:18px;right:18px;top:10px;height:20px;display:flex;align-items:center;gap:10px}',
    '.osc-brand{font:400 15px/1 "Lilita One",sans-serif;letter-spacing:.08em;color:#e9edf3}.osc-brand b{color:#ffcf3f;font-weight:400;margin-left:3px}',
    '.osc-model{font:800 9.5px/1 "Nunito",sans-serif;letter-spacing:.12em;color:#98a3b3}',
    '.osc-scr{position:absolute;left:16px;top:36px;width:330px;height:250px;border-radius:12px;padding:5px;background:#14171c;border:2px solid #0a0d12;',
    '  box-shadow:inset 0 0 0 2px #3d4450,inset 0 3px 6px rgba(0,0,0,.6)}',
    '.osc-scr canvas{display:block;width:320px;height:240px;border-radius:6px;background:#04080c}',
    '.osc-soft{position:absolute;left:22px;top:292px;width:320px;display:flex;justify-content:space-between}',
    '.osc-ctl{position:absolute;left:358px;top:34px;right:8px;bottom:44px}',
    '.osc-sec{position:absolute;border:1.5px solid #555e6b;border-radius:10px;padding:14px 6px 4px}',
    '.osc-sec > h6{position:absolute;top:-7px;left:8px;margin:0;padding:0 4px;background:#30353e;font:900 8.5px/1.2 "Nunito",sans-serif;letter-spacing:.16em;color:#aab4c2}',
    '.osc-key{position:relative;border:2px solid #0a0d12;border-radius:7px;padding:0;cursor:pointer;height:22px;min-width:44px;',
    '  background:linear-gradient(#6a7380,#4b525d);color:#f2f5f8;font:900 9px/1 "Nunito",sans-serif;letter-spacing:.06em;box-shadow:0 2px 0 #0a0d12,inset 0 1px 0 rgba(255,255,255,.22)}',
    '.osc-key:active{transform:translateY(2px);box-shadow:none}',
    '.osc-key.sm{min-width:58px;height:20px;font-size:8.5px}',
    '.osc-key .led{position:absolute;right:4px;top:3px;width:5px;height:5px;border-radius:50%;background:#20242a}',
    '.osc-key.lit .led{background:var(--led,#7CFF6B);box-shadow:0 0 6px var(--led,#7CFF6B)}',
    '.osc-key.run{background:linear-gradient(#5fd06d,#2c9a3b);color:#062b0c}.osc-key.run.stop{background:linear-gradient(#ff7a6e,#c8382c);color:#fff}',
    '.osc-key.c1{background:linear-gradient(#ffe773,#e2c022);color:#2b2300}.osc-key.c2{background:linear-gradient(#83efff,#29b8d6);color:#032a33}',
    '.osc-key.c1.off,.osc-key.c2.off{background:linear-gradient(#6a7380,#4b525d);color:#c7cfda}',
    '.osc-knob{position:absolute;display:flex;flex-direction:column;align-items:center;gap:2px}',
    '.osc-knob .cap{position:relative;border-radius:50%;cursor:pointer;touch-action:none;outline:none;',
    '  background:radial-gradient(circle at 40% 32%,#5b636e,#262a30 62%,#14171b);border:2px solid #0a0d12;box-shadow:0 3px 0 #0a0d12,0 0 0 3px #8c96a3,0 0 0 5px #0a0d12}',
    '.osc-knob .cap:focus-visible{box-shadow:0 3px 0 #0a0d12,0 0 0 3px #ffcf3f,0 0 0 5px #0a0d12}',
    '.osc-knob .cap i{position:absolute;left:50%;top:7%;width:3px;height:30%;margin-left:-1.5px;border-radius:2px;background:#f1f4f7}',
    '.osc-knob .cap.c1 i{background:#ffe14d}.osc-knob .cap.c2 i{background:#4de4ff}',
    '.osc-knob label{font:900 7.5px/1 "Nunito",sans-serif;letter-spacing:.12em;color:#aab4c2;white-space:nowrap}',
    '.osc-bot{position:absolute;left:18px;right:18px;bottom:8px;height:30px;display:flex;align-items:center;gap:16px}',
    '.osc-bnc{display:flex;align-items:center;gap:6px;font:900 8.5px/1 "Nunito",sans-serif;letter-spacing:.1em;color:#aab4c2}',
    '.osc-bnc span{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle,#1a1d22 22%,#c9ced6 25%,#8d949e 55%,#3a3f47 60%);border:2px solid #0a0d12;box-shadow:0 0 0 3px var(--ring,#555)}',
    '.osc-pwr{margin-left:auto;width:26px;height:26px;border-radius:50%;border:2px solid #0a0d12;background:radial-gradient(circle at 40% 35%,#8af59a,#2fae45);color:#06350e;font:900 13px/1 sans-serif;cursor:pointer;padding:0;box-shadow:0 2px 0 #0a0d12}',
    '.osc-pwr:active{transform:translateY(2px);box-shadow:none}',
    '.osc-pwr.off{background:radial-gradient(circle at 40% 35%,#7d8590,#4b525d);color:#1a1d22}',
    '.osc.off .osc-scr canvas{background:#020304}'
  ].join('\n');

  var VSC = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
  var TSC = [1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3, 0.1, 0.2, 0.5, 1];
  var COL = ['#ffe14d', '#4de4ff'];
  var GX = 10, GY = 16, DW = 30, DH = 25, NX = 10, NY = 8;          /* screen grid: 10 x 8 divisions */

  function fv(v){ var a = Math.abs(v); return a >= 1 ? v.toFixed(2) + 'V' : (v * 1e3).toFixed(a >= 0.1 ? 0 : 1) + 'mV'; }
  function fvd(v){ return v >= 1 ? v + 'V' : v * 1e3 + 'mV'; }
  function ft(t){ return t >= 1 ? t + 's' : t >= 1e-3 ? +(t * 1e3).toFixed(3) + 'ms' : +(t * 1e6).toFixed(3) + 'us'; }

  window.Scope = function(root){
    if(!document.getElementById('osc-css')){ var s = document.createElement('style'); s.id = 'osc-css'; s.textContent = CSS; document.head.appendChild(s); }
    /* factory settings: a power cycle (POWER key) always comes back to these */
    function defaults(){ return {ch:[{on:true, vi:6, pos:-3}, {on:true, vi:5, pos:-3}], ti:6, hpos:0, mode:'AUTO', src:0, slope:1, level:2.0, run:true}; }
    var S = Object.assign(defaults(), {labels:['Vm', ''], power:true});
    var bootUntil = 0, BOOT = 1600;                    /* ms of boot screen after power-on */
    function live(){ return S.power && performance.now() >= bootUntil; }
    var CAP = 1 << 17, bt = new Float64Array(CAP), ba = new Float32Array(CAP), bb = new Float32Array(CAP), head = 0, count = 0;
    var snap = null, armed = true, trigT = null, lastDone = -Infinity, prevSrc = NaN, status = 'RUN';
    var api = {onChange:null};

    /* ---------------- panel ---------------- */
    var o = document.createElement('div'); o.className = 'osc';
    o.innerHTML =
      '<div class="osc-top"><span class="osc-brand">SANDBOX<b>SCOPE</b></span><span class="osc-model">DSO-2C · 2 CH · 100 MHz · 1 GSa/s</span></div>' +
      '<div class="osc-scr"><canvas width="320" height="240" aria-label="Oscilloscope screen"></canvas></div>' +
      '<div class="osc-soft"></div><div class="osc-ctl"></div>' +
      '<div class="osc-bot"><span class="osc-bnc" style="--ring:#e2c022"><span></span>CH1</span><span class="osc-bnc" style="--ring:#29b8d6"><span></span>CH2</span>' +
      '<span class="osc-bnc"><span></span>EXT TRIG</span><button type="button" class="osc-pwr" title="Power (power-cycling restores factory settings)" aria-label="Scope power" aria-pressed="true">⏻</button></div>';
    root.appendChild(o);
    var cv = o.querySelector('canvas'), ctx = cv.getContext('2d'), ctl = o.querySelector('.osc-ctl'), soft = o.querySelector('.osc-soft');
    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cv.width = 320 * dpr; cv.height = 240 * dpr; ctx.scale(dpr, dpr);

    function changed(){ if(api.onChange) api.onChange(S); }
    function key(parent, label, cls, x, y, fn, led){
      var b = document.createElement('button'); b.type = 'button'; b.className = 'osc-key ' + (cls || ''); b.innerHTML = label + (led ? '<span class="led"></span>' : '');
      if(x !== null){ b.style.position = 'absolute'; b.style.left = x + 'px'; b.style.top = y + 'px'; }
      b.addEventListener('click', function(){ if(!live()) return; fn(b); paint(); changed(); });
      parent.appendChild(b); return b;
    }
    function sec(title, x, y, w, h){
      var d = document.createElement('div'); d.className = 'osc-sec';
      d.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px';
      d.innerHTML = '<h6>' + title + '</h6>'; ctl.appendChild(d); return d;
    }
    function knob(parent, label, size, x, y, step, cls){
      var k = document.createElement('div'); k.className = 'osc-knob'; k.style.left = x + 'px'; k.style.top = y + 'px';
      k.innerHTML = '<div class="cap ' + (cls || '') + '" tabindex="0" role="slider" aria-label="' + label + '" style="width:' + size + 'px;height:' + size + 'px"><i></i></div><label>' + label + '</label>';
      parent.appendChild(k);
      var cap = k.firstChild, ang = 0, drag = null;
      function turn(d){ if(!d || !live()) return; ang += d * 24; cap.style.transform = 'rotate(' + ang + 'deg)'; step(d); paint(); changed(); }
      KNOBS.push(function(){ ang = 0; cap.style.transform = ''; });
      cap.addEventListener('wheel', function(e){ e.preventDefault(); turn(e.deltaY < 0 ? 1 : -1); }, {passive:false});
      cap.addEventListener('pointerdown', function(e){ drag = {y:e.clientY, moved:0, x:e.offsetX}; cap.setPointerCapture(e.pointerId); });
      cap.addEventListener('pointermove', function(e){
        if(!drag) return; var dy = drag.y - e.clientY;
        if(Math.abs(dy) >= 14){ var n = Math.trunc(dy / 14); turn(n); drag.y -= n * 14; drag.moved += Math.abs(n); }
      });
      cap.addEventListener('pointerup', function(e){
        if(drag && !drag.moved){ var r = cap.getBoundingClientRect(); turn(e.clientX - r.left >= r.width / 2 ? 1 : -1); }
        drag = null;
      });
      cap.addEventListener('keydown', function(e){
        if(e.key === 'ArrowUp' || e.key === 'ArrowRight'){ e.preventDefault(); turn(1); }
        if(e.key === 'ArrowDown' || e.key === 'ArrowLeft'){ e.preventDefault(); turn(-1); }
      });
      return k;
    }
    var KNOBS = [];                                   /* resets each knob's pointer on power-on */
    function clampI(i, n){ return Math.max(0, Math.min(n - 1, i)); }

    /* top row */
    var kRun = key(ctl, 'RUN/STOP', 'run', 0, 0, function(){ S.run = !S.run; if(S.run){ snap = null; armed = true; trigT = null; } else freeze(); });
    key(ctl, 'SINGLE', '', 47, 0, function(){ S.mode = 'SINGLE'; S.run = true; snap = null; armed = true; trigT = null; });
    key(ctl, 'AUTO', '', 94, 0, function(){ autoset(); });
    key(ctl, 'CLEAR', '', 141, 0, function(){ api.clear(); });
    /* vertical */
    var sv = sec('VERTICAL', 0, 34, 104, 178);
    var kC1 = key(sv, 'CH1', 'c1', 6, 6, function(){ S.ch[0].on = !S.ch[0].on; });
    var kC2 = key(sv, 'CH2', 'c2', 54, 6, function(){ S.ch[1].on = !S.ch[1].on; });
    knob(sv, 'SCALE', 40, 6, 38, function(d){ S.ch[0].vi = clampI(S.ch[0].vi - d, VSC.length); }, 'c1');
    knob(sv, 'SCALE', 40, 54, 38, function(d){ S.ch[1].vi = clampI(S.ch[1].vi - d, VSC.length); }, 'c2');
    knob(sv, 'POSITION', 26, 13, 106, function(d){ S.ch[0].pos = Math.max(-4, Math.min(4, S.ch[0].pos + d * 0.25)); }, 'c1');
    knob(sv, 'POSITION', 26, 61, 106, function(d){ S.ch[1].pos = Math.max(-4, Math.min(4, S.ch[1].pos + d * 0.25)); }, 'c2');
    /* horizontal */
    var sh = sec('HORIZONTAL', 112, 34, 72, 178);
    knob(sh, 'SCALE', 44, 12, 8, function(d){ S.ti = clampI(S.ti - d, TSC.length); snap = null; trigT = null; armed = true; });
    knob(sh, 'POSITION', 26, 21, 80, function(d){ S.hpos = Math.max(-5, Math.min(5, S.hpos + d * 0.5)); });
    var kMode = key(sh, 'AUTO', 'sm', 4, 136, function(){ S.mode = S.mode === 'AUTO' ? 'NORMAL' : S.mode === 'NORMAL' ? 'SINGLE' : 'AUTO'; S.run = true; snap = null; armed = true; trigT = null; });
    kMode.title = 'Acquisition mode: AUTO (roll) / NORMAL / SINGLE';
    /* trigger */
    var stg = sec('TRIGGER', 0, 220, 184, 70);
    knob(stg, 'LEVEL', 34, 6, 2, function(d){ var vd = VSC[S.ch[S.src].vi]; S.level = Math.round((S.level + d * vd * 0.2) * 1e4) / 1e4; });
    var kSrc = key(stg, 'SRC CH1', 'sm', 54, 2, function(){ S.src = 1 - S.src; armed = true; trigT = null; });
    var kSlope = key(stg, 'SLOPE ↑', 'sm', 118, 2, function(){ S.slope = -S.slope; });
    key(stg, 'LEVEL 50%', 'sm', 54, 28, function(){ var m = api.measure()['c' + (S.src + 1)]; if(m) S.level = Math.round((m.max + m.min) / 2 * 100) / 100; });
    key(stg, 'FORCE', 'sm', 118, 28, function(){ var b = lastIdx(); if(b >= 0){ trigT = bt[b]; armed = false; } });
    /* soft keys under the screen (decoration + quick help) */
    ['MENU', 'MEASURE', 'CURSOR', 'DISPLAY', 'UTILITY'].forEach(function(n){
      var b = document.createElement('button'); b.type = 'button'; b.className = 'osc-key sm'; b.textContent = n; b.style.minWidth = '56px';
      b.addEventListener('click', function(){ if(!live()) return; flash(n === 'MEASURE' ? 'Measurements are listed under the scope' : n + ': not in this prototype'); });
      soft.appendChild(b);
    });
    var flashMsg = null, flashUntil = 0;
    function flash(m){ flashMsg = m; flashUntil = performance.now() + 1600; }

    function paint(){
      kRun.textContent = S.run ? 'RUN/STOP' : 'RUN/STOP'; kRun.classList.toggle('stop', !S.run);
      kC1.classList.toggle('off', !S.ch[0].on); kC2.classList.toggle('off', !S.ch[1].on);
      kMode.textContent = S.mode;
      kSrc.textContent = 'SRC CH' + (S.src + 1); kSlope.textContent = 'SLOPE ' + (S.slope > 0 ? '↑' : '↓');
    }
    paint();

    /* POWER: off = dark screen, every key and knob dead; on = boot screen, then factory settings */
    var pwr = o.querySelector('.osc-pwr');
    api.setPower = function(on){
      S.power = on; o.classList.toggle('off', !on); pwr.classList.toggle('off', !on); pwr.setAttribute('aria-pressed', on);
      if(on){
        Object.assign(S, defaults()); KNOBS.forEach(function(f){ f(); });
        api.clear(); bootUntil = performance.now() + BOOT; flashMsg = null;
      } else { api.clear(); }
      paint(); changed();
    };
    pwr.addEventListener('click', function(){ api.setPower(!S.power); });

    /* ---------------- data ---------------- */
    function idx(k){ return (head - count + k + CAP) % CAP; }     /* logical k -> ring slot */
    function lastIdx(){ return count ? (head - 1 + CAP) % CAP : -1; }
    function firstAtOrAfter(t){                                   /* logical index of the first sample with time >= t */
      var lo = 0, hi = count;
      while(lo < hi){ var m = (lo + hi) >> 1; if(bt[idx(m)] < t) lo = m + 1; else hi = m; }
      return lo;
    }
    api.push = function(t, a, b){
      if(!S.power) return;
      bt[head] = t; ba[head] = a; bb[head] = b; head = (head + 1) % CAP; if(count < CAP) count++;
      if(!S.run || S.mode === 'AUTO') { prevSrc = S.src ? b : a; return; }
      var v = S.src ? b : a, W = 10 * TSC[S.ti], pre = (5 + S.hpos) * TSC[S.ti];
      if(armed && trigT === null && !isNaN(prevSrc) && t - pre > lastDone){
        if((S.slope > 0 && prevSrc < S.level && v >= S.level) || (S.slope < 0 && prevSrc > S.level && v <= S.level)){ trigT = t; armed = false; }
      }
      prevSrc = v;
      if(trigT !== null && t >= trigT - pre + W){                /* sweep complete */
        snap = take(trigT - pre, W, trigT); lastDone = trigT - pre + W; trigT = null;
        if(S.mode === 'SINGLE'){ S.run = false; paint(); changed(); } else armed = true;
      }
    };
    function take(t0, W, tt){                                     /* copy a window, ~4 points per screen pixel */
      var i = firstAtOrAfter(t0), j = firstAtOrAfter(t0 + W), n = j - i, stp = Math.max(1, Math.floor(n / 1200));
      var r = {t0:t0, W:W, trig:tt, t:[], a:[], b:[]};
      for(var k = i; k < j; k += stp){ var q = idx(k); r.t.push(bt[q]); r.a.push(ba[q]); r.b.push(bb[q]); }
      return r;
    }
    function freeze(){ var w = view() || lastView; if(w && !w.t) snap = take(w.t0, w.W, w.trig); }
    function view(){
      var W = 10 * TSC[S.ti], L = lastIdx(), now = L >= 0 ? bt[L] : 0, pre = (5 + S.hpos) * TSC[S.ti];
      if(snap) return snap;
      if(S.mode !== 'AUTO' && trigT !== null) return {t0:trigT - pre, W:W, trig:trigT, live:true};
      if(S.mode !== 'AUTO') return null;                          /* waiting for a trigger: keep the old screen */
      return {t0:Math.max(now - W, count ? bt[idx(0)] : 0), W:W, trig:null, live:true, roll:true};
    }
    api.clear = function(){ head = 0; count = 0; snap = null; trigT = null; armed = true; lastDone = -Infinity; };
    api.setLabels = function(l){ S.labels = l.slice(); };
    api.state = S;

    function series(w, ch){                                       /* [t[], v[]] for one channel in window w */
      if(w.t){ return [w.t, ch ? w.b : w.a]; }
      var i = firstAtOrAfter(w.t0), j = firstAtOrAfter(w.t0 + w.W), T = [], V = [], buf = ch ? bb : ba;
      var stp = Math.max(1, Math.floor((j - i) / 1500));
      for(var k = i; k < j; k += stp){ var q = idx(k); T.push(bt[q]); V.push(buf[q]); }
      return [T, V];
    }
    var lastView = null;
    api.measure = function(){
      var w = S.power ? lastView : null, out = {};
      [0, 1].forEach(function(c){
        if(!w || !S.ch[c].on){ out['c' + (c + 1)] = null; return; }
        var V = series(w, c)[1], mx = -Infinity, mn = Infinity;
        for(var i = 0; i < V.length; i++){ var v = V[i]; if(isNaN(v)) continue; if(v > mx) mx = v; if(v < mn) mn = v; }
        out['c' + (c + 1)] = mx > -Infinity ? {max:mx, min:mn, pp:mx - mn} : null;
      });
      return out;
    };
    function autoset(){
      var W = 10 * TSC[S.ti], L = lastIdx(); if(L < 0) return;
      var now = bt[L], tmp = {t0:now - Math.max(W, 2), W:Math.max(W, 2)};
      [0, 1].forEach(function(c){
        var V = series(tmp, c)[1], mx = -Infinity, mn = Infinity;
        V.forEach(function(v){ if(!isNaN(v)){ mx = Math.max(mx, v); mn = Math.min(mn, v); } });
        if(mx === -Infinity) return;
        var span = Math.max(mx - mn, 0.02), vi = 0;
        while(vi < VSC.length - 1 && span / VSC[vi] > 5) vi++;
        S.ch[c].vi = vi; S.ch[c].pos = Math.max(-4, Math.min(4, -3 - Math.floor(mn / VSC[vi] * 4) / 4));
        if(c === S.src) S.level = Math.round((mx + mn) / 2 * 100) / 100;
      });
      S.mode = 'AUTO'; S.run = true; snap = null; trigT = null; armed = true;
      flash('AUTOSET');
    }

    /* ---------------- screen ---------------- */
    api.draw = function(){
      if(!S.power){ ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, 320, 240); lastView = null; return; }
      var now = performance.now();
      if(now < bootUntil){                             /* boot screen */
        var p = 1 - (bootUntil - now) / BOOT;
        ctx.fillStyle = '#04080c'; ctx.fillRect(0, 0, 320, 240);
        ctx.textAlign = 'center'; ctx.fillStyle = '#e9edf3'; ctx.font = '22px "Lilita One", sans-serif'; ctx.fillText('SANDBOX SCOPE', 160, 104);
        ctx.font = '11px "Share Tech Mono", monospace'; ctx.fillStyle = '#98a3b3'; ctx.fillText('DSO-2C  ·  restoring factory settings', 160, 126);
        ctx.strokeStyle = '#3d4450'; ctx.strokeRect(70.5, 146.5, 180, 10); ctx.fillStyle = '#ffcf3f'; ctx.fillRect(72, 148, 177 * p, 7);
        ctx.textAlign = 'left'; lastView = null; return;
      }
      var w = view(); if(w) lastView = w; else w = lastView;
      ctx.fillStyle = '#04080c'; ctx.fillRect(0, 0, 320, 240);
      /* grid */
      ctx.strokeStyle = 'rgba(120,150,170,.22)'; ctx.lineWidth = 1;
      for(var i = 0; i <= NX; i++){ ctx.beginPath(); ctx.moveTo(GX + i * DW + .5, GY); ctx.lineTo(GX + i * DW + .5, GY + NY * DH); ctx.stroke(); }
      for(var j = 0; j <= NY; j++){ ctx.beginPath(); ctx.moveTo(GX, GY + j * DH + .5); ctx.lineTo(GX + NX * DW, GY + j * DH + .5); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(160,190,210,.38)';
      for(var tx = 0; tx <= NX * 5; tx++){ var x = GX + tx * DW / 5 + .5, cy = GY + NY * DH / 2; ctx.beginPath(); ctx.moveTo(x, cy - 2); ctx.lineTo(x, cy + 2); ctx.stroke(); }
      for(var ty = 0; ty <= NY * 5; ty++){ var y = GY + ty * DH / 5 + .5, cx = GX + NX * DW / 2; ctx.beginPath(); ctx.moveTo(cx - 2, y); ctx.lineTo(cx + 2, y); ctx.stroke(); }
      var cy0 = GY + NY * DH / 2;
      /* traces */
      if(w){
        ctx.save(); ctx.beginPath(); ctx.rect(GX, GY, NX * DW, NY * DH); ctx.clip();
        [0, 1].forEach(function(c){
          if(!S.ch[c].on) return;
          var sr = series(w, c), T = sr[0], V = sr[1], vd = VSC[S.ch[c].vi], pos = S.ch[c].pos, first = true;
          ctx.strokeStyle = COL[c]; ctx.lineWidth = 1.6; ctx.shadowColor = COL[c]; ctx.shadowBlur = 4; ctx.beginPath();
          for(var k = 0; k < T.length; k++){
            var v = V[k]; if(isNaN(v)){ first = true; continue; }
            var X = GX + (T[k] - w.t0) / w.W * NX * DW, Y = cy0 - (v / vd + pos) * DH;
            if(first){ ctx.moveTo(X, Y); first = false; } else ctx.lineTo(X, Y);
          }
          ctx.stroke(); ctx.shadowBlur = 0;
        });
        ctx.restore();
      }
      /* markers: channel grounds (left), trigger level (right), trigger time (top) */
      [0, 1].forEach(function(c){
        if(!S.ch[c].on) return;
        var y = cy0 - S.ch[c].pos * DH; ctx.fillStyle = COL[c];
        ctx.beginPath(); ctx.moveTo(GX - 9, y - 5); ctx.lineTo(GX - 2, y); ctx.lineTo(GX - 9, y + 5); ctx.fill();
        ctx.fillStyle = '#000'; ctx.font = 'bold 8px "Share Tech Mono",monospace'; ctx.fillText(String(c + 1), GX - 9, y + 3);
      });
      var tch = S.ch[S.src], ly = cy0 - (S.level / VSC[tch.vi] + tch.pos) * DH;
      if(S.mode !== 'AUTO' && ly > GY && ly < GY + NY * DH){
        ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.moveTo(GX + NX * DW + 9, ly - 5); ctx.lineTo(GX + NX * DW + 2, ly); ctx.lineTo(GX + NX * DW + 9, ly + 5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,159,67,.35)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(GX, ly); ctx.lineTo(GX + NX * DW, ly); ctx.stroke(); ctx.setLineDash([]);
      }
      if(S.mode !== 'AUTO'){
        var tx0 = GX + (5 + S.hpos) * DW; ctx.fillStyle = '#ff9f43';
        ctx.beginPath(); ctx.moveTo(tx0 - 5, GY - 6); ctx.lineTo(tx0 + 5, GY - 6); ctx.lineTo(tx0, GY - 1); ctx.fill();
      }
      /* status bar */
      status = !S.run ? 'STOP' : S.mode === 'AUTO' ? 'ROLL' : (snap || trigT !== null) ? 'TRIG\'D' : 'WAIT';
      var sc = {STOP:'#ff5a4f', ROLL:'#7CFF6B', 'TRIG\'D':'#7CFF6B', WAIT:'#ffcf3f'}[status];
      ctx.font = '11px "Share Tech Mono",monospace';
      ctx.fillStyle = sc; ctx.fillRect(GX, 2, 46, 12); ctx.fillStyle = '#000'; ctx.fillText(status, GX + 4, 12);
      ctx.fillStyle = '#e8eef5'; ctx.fillText('H ' + ft(TSC[S.ti]) + '/div', GX + 54, 12);
      ctx.fillText(S.mode === 'AUTO' ? 'AUTO' : S.mode === 'NORMAL' ? 'NORM' : 'SNGL', GX + 150, 12);
      ctx.fillStyle = '#ff9f43'; ctx.textAlign = 'right';
      ctx.fillText('T ' + (S.src + 1) + (S.slope > 0 ? '↑ ' : '↓ ') + fv(S.level), GX + NX * DW, 12); ctx.textAlign = 'left';
      /* bottom bar */
      var by = GY + NY * DH + 16;
      [0, 1].forEach(function(c){
        var x = GX + c * 150; ctx.fillStyle = S.ch[c].on ? COL[c] : '#56606b';
        ctx.fillRect(x, by - 10, 13, 13); ctx.fillStyle = '#000'; ctx.fillText(String(c + 1), x + 3, by);
        ctx.fillStyle = S.ch[c].on ? COL[c] : '#56606b';
        ctx.fillText(fvd(VSC[S.ch[c].vi]) + '/div  ' + (S.labels[c] || '—'), x + 18, by);
      });
      if(flashMsg && performance.now() < flashUntil){
        ctx.fillStyle = 'rgba(4,8,12,.85)'; ctx.fillRect(GX + 40, cy0 - 14, NX * DW - 80, 26);
        ctx.strokeStyle = '#ffcf3f'; ctx.strokeRect(GX + 40.5, cy0 - 13.5, NX * DW - 81, 25);
        ctx.fillStyle = '#ffcf3f'; ctx.textAlign = 'center'; ctx.fillText(flashMsg, GX + NX * DW / 2, cy0 + 4); ctx.textAlign = 'left';
      }
    };
    return api;
  };
})();
