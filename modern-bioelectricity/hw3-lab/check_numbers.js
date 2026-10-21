/* Re-measures the simulated numbers written on index.html and in app.js (preset notes), for a given scope probe.
   Not loaded by the page.  Open hw3-lab/index.html, paste this file into the console (or load it with a <script>),
   then:   HW3CHK.all(1e6, null, 7.0)   -> {key: value}   (1e6 = x1 probe, 1e7 = x10 probe; 7.0 = battery V+, the page default)
   Each check builds a fresh SynEngine with the same defaults as app.js (BASE, TRUE_SYN), powers on and rests 2 s,
   then drives SW A / SW B on a schedule.  AP counting is app.js's: rising through 2 V, re-armed below 1.5 V. */
var HW3CHK = (function(){
  var DT = 2e-4, THR = 2.0, REARM = 1.5;
  var BASE = {vplus:7.0, pre:'kit', postMem:'kit', r1p:0, r6:0, bat:'on', rpotA:700, rpotB:700, syn:'exc', post:'passive', ch1:'A.Vm', ch2:'P1'};
  var TRUE = {pre:'true', postMem:'true', r1p:1.5e6, rpotA:0, rpotB:0};
  var CIRC = {s31:{syn:'exc', post:'passive', ch2:'P1'}, s32:{syn:'exc', post:'active', ch2:'B.Vm'},
              s33:{syn:'inh', post:'passive', ch2:'P1'}, s34:{syn:'inh', post:'active', ch2:'B.Vm'}};
  var RP = 1e6, VP = 7.0;
  function mk(circ, cfg){
    var E = SynEngine();
    Object.assign(E.st, BASE, CIRC[circ], cfg || {}, {rprobe:RP, vplus:VP, swA:false, swB:false});
    E.build(); E.powerOn(); E.settle(2.0);
    return E;
  }
  /* sched: list of [t0, t1, 'A'|'B'] presses; returns traces of `nodes` (one sample per step) */
  function run(E, T, sched, nodes){
    var n = Math.round(T / DT), out = {t:new Float64Array(n)};
    nodes.forEach(function(k){ out[k] = new Float64Array(n); });
    for(var k = 0; k < n; k++){
      var t = k * DT, a = false, b = false;
      sched.forEach(function(p){ if(t >= p[0] - 1e-9 && t < p[1] - 1e-9){ if(p[2] === 'A') a = true; else b = true; } });
      if(a !== E.st.swA || b !== E.st.swB){ E.st.swA = a; E.st.swB = b; E.build(); }
      E.step(DT);
      out.t[k] = t + DT;
      nodes.forEach(function(x){ out[x][k] = E.v(x); });
    }
    return out;
  }
  function train(n, isi, w, t0){ var L = []; for(var k = 0; k < n; k++) L.push([(t0 || 0) + k * isi, (t0 || 0) + k * isi + w, 'A']); return L; }
  function max(a){ var m = -Infinity, i0 = 0; for(var i = 0; i < a.length; i++) if(a[i] > m){ m = a[i]; i0 = i; } return [m, i0]; }
  function min(a){ var m = Infinity, i0 = 0; for(var i = 0; i < a.length; i++) if(a[i] < m){ m = a[i]; i0 = i; } return [m, i0]; }
  function aps(a, from){ var n = 0, armd = true, t = []; for(var i = from || 0; i < a.length; i++){ if(armd && a[i] >= THR){ n++; armd = false; t.push(i * DT); } else if(!armd && a[i] < REARM) armd = true; } return {n:n, t:t}; }
  /* small peaks of the kit membrane: local maxima above lo */
  function peaks(a, lo){ var p = []; for(var i = 1; i + 1 < a.length; i++) if(a[i] > lo && a[i] >= a[i - 1] && a[i] > a[i + 1]) p.push(a[i]); return p; }
  function r2(x){ return Math.round(x * 100) / 100; }
  function r3(x){ return Math.round(x * 1000) / 1000; }
  function mv(x){ return Math.round(x * 1e4) / 10; }

  var C = {};
  /* ---- basic (kit) ---- */
  C.kit_pre = function(){
    var E = mk('s31'), sp = run(E, 3, [], ['A.Vm', 'P1', 'SY.S']);
    var pk = peaks(sp['A.Vm'], 1.0), lo = min(sp['A.Vm'])[0], hi = max(sp['A.Vm'])[0];
    var E2 = mk('s31'), pr = run(E2, 1.5, [[0, 0.02, 'A']], ['A.Vm', 'SY.S']);
    var E3 = mk('s31'), hd = run(E3, 3, [[0, 3, 'A']], ['A.Vm']);
    return {spont_per_s:pk.length / 3, spont_peak_mean:r2(pk.reduce(function(s, x){ return s + x; }, 0) / Math.max(1, pk.length)),
            pre_min:r2(lo), pre_max:r2(hi), P1_base:r3(sp.P1[sp.P1.length - 1]),
            press20_peak:r2(max(pr['A.Vm'])[0]), press20_S_mV:mv(max(pr['SY.S'])[0]), hold_end:r2(hd['A.Vm'][hd['A.Vm'].length - 1])};
  };
  C.kit_s32 = function(){
    var E = mk('s32'), pr = run(E, 1.5, [[0, 0.01, 'B']], ['B.Vm']);
    var E2 = mk('s32'), hd = run(E2, 3, [[0, 3, 'B']], ['B.Vm']);
    return {pressB10_peak:r2(max(pr['B.Vm'])[0]), holdB_end:r2(hd['B.Vm'][hd['B.Vm'].length - 1])};
  };
  C.kit_s34 = function(){
    var E = mk('s34'), rest = E.v('B.Vm'), pr = run(E, 1.5, [[0, 0.01, 'B']], ['B.Vm']);
    var E2 = mk('s34'), hd = run(E2, 3, [[0, 3, 'B']], ['B.Vm']);
    return {rest:r2(rest), pressB10_peak:r2(max(pr['B.Vm'])[0]), holdB_max:r2(max(hd['B.Vm'])[0]), holdB_aps:aps(hd['B.Vm']).n, holdB_end:r2(hd['B.Vm'][hd['B.Vm'].length - 1])};
  };
  /* ---- HW2 true AP, synapse unchanged ---- */
  C.hw2 = function(){
    var cfg = {pre:'true', postMem:'true', r1p:0, rpotA:0, rpotB:0};
    var E = mk('s31', cfg), rest = E.v('A.Vm'), b = E.v('P1'), o = run(E, 1.5, [[0, 0.015, 'A']], ['A.Vm', 'SY.S', 'P1']);
    var E3 = mk('s33', cfg), b3 = E3.v('P1'), o3 = run(E3, 1.5, [[0, 0.015, 'A']], ['P1']);
    return {pre_rest:r2(rest), pre_peak:r2(max(o['A.Vm'])[0]), S_peak:r2(max(o['SY.S'])[0]), P1_mV:mv(max(o.P1)[0] - b), ipsp_P1_mV:mv(min(o3.P1)[0] - b3)};
  };
  /* ---- table: parallel resistor across the 820k (Pre = HW2 true AP, press 15 ms) ---- */
  function needEPSP(cfg, isi){
    for(var n = 1; n <= 6; n++){
      var E = mk('s32', cfg), o = run(E, n * isi + 1.0, train(n, isi, 0.015), ['B.Vm']);
      if(aps(o['B.Vm']).n > 0) return n;
    }
    return '>6';
  }
  C.table = function(){
    var rows = {};
    [0, 4.7e6, 3.3e6, 2.2e6, 1.5e6, 1e6].forEach(function(r){
      var cfg = Object.assign({}, TRUE, {r1p:r});
      var E = mk('s31', cfg), b1 = E.v('P1'), b5 = E.v('P5'), o = run(E, 1.5, [[0, 0.015, 'A']], ['SY.S', 'P1', 'P5']);
      var E3 = mk('s33', cfg), c1 = E3.v('P1'), o3 = run(E3, 1.5, [[0, 0.015, 'A']], ['P1']);
      rows[r ? (r / 1e6) + 'M' : 'none'] = {S:r2(max(o['SY.S'])[0]), P1_mV:Math.round((max(o.P1)[0] - b1) * 1e3), P5_mV:Math.round((max(o.P5)[0] - b5) * 1e3),
        nEPSP_100ms:needEPSP(cfg, 0.1), ipsp_mV:Math.round((min(o3.P1)[0] - c1) * 1e3)};
    });
    rows['1.5M'].nEPSP_50ms = needEPSP(Object.assign({}, TRUE), 0.05);
    rows['1.5M'].nEPSP_1200ms = needEPSP(Object.assign({}, TRUE), 1.2);
    return rows;
  };
  /* ---- #3-1 true synapse ---- */
  C.s31 = function(){
    var E = mk('s31', TRUE), b1 = E.v('P1'), b5 = E.v('P5'), q2b = E.v('SY.B'), rest = E.v('A.Vm'), sRest = E.v('SY.S');
    var o = run(E, 1.5, [[0, 0.015, 'A']], ['A.Vm', 'P1', 'P5', 'SY.B', 'SY.S']);
    var ap = max(o['A.Vm']), p1 = max(o.P1), p5 = max(o.P5);
    var E2 = mk('s31', TRUE), o2 = run(E2, 1.6, train(2, 0.1, 0.015), ['P1', 'P5']);
    var E6 = mk('s31', Object.assign({}, TRUE, {r6:1e5})), d1 = E6.v('P1'), o6 = run(E6, 1.5, [[0, 0.015, 'A']], ['P1']), p6 = max(o6.P1);
    return {pre_rest:r2(rest), Q2B_rest:r2(q2b), Q2B_ap:r2(max(o['SY.B'])[0]), S_rest:r2(sRest), S_peak:r2(max(o['SY.S'])[0]), P1_base:r3(b1),
            pre_ap:r2(ap[0]), P1_epsp:r2(p1[0] - b1), P1_delay_ms:Math.round((p1[1] - ap[1]) * DT * 1e3), P5_epsp:r2(p5[0] - b5),
            P5_delay_ms:Math.round((p5[1] - ap[1]) * DT * 1e3), P5_over_P1:r2((p5[0] - b5) / (p1[0] - b1)),
            two100_P1:r2(max(o2.P1)[0] - b1), two100_P5:r2(max(o2.P5)[0] - b5),
            r6_P1_epsp:r2(p6[0] - d1), r6_delay_ms:Math.round((p6[1] - ap[1]) * DT * 1e3)};
  };
  /* ISI ratios as app.js isiSweep: amplitude = largest deviation from baseline after the first press */
  function ratios(circ, list){
    var E = mk(circ, TRUE), snap = E.snapshot(), node = 'P1', base = E.v(node);
    function amp(isi){
      E.restore(snap); E.st.swA = false; E.build();
      var o = run(E, (isi || 0) + 0.015 + 1.0, isi ? train(2, isi, 0.015) : [[0, 0.015, 'A']], [node]), best = 0;
      for(var i = 0; i < o[node].length; i++){ var d = o[node][i] - base; if(Math.abs(d) > Math.abs(best)) best = d; }
      return best;
    }
    var one = amp(0), r = {one_mV:mv(one)};
    list.forEach(function(x){ r[Math.round(x * 1e3)] = r2(amp(x) / one); });
    return r;
  }
  C.s31_isi = function(){ return ratios('s31', [0.05, 0.075, 0.1, 0.2, 0.5, 1.2]); };
  C.s33_isi = function(){ return ratios('s33', [0.05, 0.1, 0.3, 1.2]); };
  C.s33 = function(){
    var E = mk('s33', TRUE), b1 = E.v('P1'), b5 = E.v('P5'), sRest = E.v('SY.S'), o = run(E, 1.5, [[0, 0.015, 'A']], ['P1', 'P5', 'SY.S']);
    var r = {S_rest:r2(sRest), S_min:r2(min(o['SY.S'])[0]), P1_mV:mv(min(o.P1)[0] - b1), P5_mV:mv(min(o.P5)[0] - b5), P1_base:r3(b1)};
    ['short', 'open'].forEach(function(bat){
      var E2 = mk('s33', Object.assign({}, TRUE, {bat:bat})), c = E2.v('P1'), o2 = run(E2, 1.5, [[0, 0.015, 'A']], ['P1']);
      r['P1_mV_' + bat] = mv(min(o2.P1)[0] - c); r['P1_rest_' + bat] = r3(c);
    });
    return r;
  };
  /* ---- #3-2 true synapse ---- */
  function bMin(circ, cfg){            /* shortest SW B press (0.5 ms steps) that fires the Post */
    for(var w = 1; w <= 40; w += 0.5){ var E = mk(circ, cfg), o = run(E, 0.6, [[0, w / 1e3, 'B']], ['B.Vm']); if(aps(o['B.Vm']).n) return w; }
    return '>40';
  }
  C.s32 = function(){
    var E = mk('s32', TRUE), rest = E.v('B.Vm'), o = run(E, 1.5, [[0, 0.015, 'A']], ['B.Vm']);
    var r = {post_rest:r2(rest), one_epsp_peak:r2(max(o['B.Vm'])[0]), one_epsp_aps:aps(o['B.Vm']).n};
    [0.05, 0.1, 0.5, 1.2].forEach(function(isi){ var E2 = mk('s32', TRUE), o2 = run(E2, isi + 1.2, train(2, isi, 0.015), ['B.Vm']); r['two_' + Math.round(isi * 1e3) + '_aps'] = aps(o2['B.Vm']).n; });
    var E5 = mk('s32', TRUE), o5 = run(E5, 1.6, train(5, 0.1, 0.015), ['B.Vm']); r.five100_post_aps = aps(o5['B.Vm']).n;
    r.B_min_ms = bMin('s32', TRUE);
    /* threshold: the Post peak of the longest B press that does not fire */
    var wl = r.B_min_ms - 0.5, E6 = mk('s32', TRUE), o6 = run(E6, 0.6, [[0, wl / 1e3, 'B']], ['B.Vm']); r.post_thr_est = r2(max(o6['B.Vm'])[0]);
    [0.02, 0.05].forEach(function(dt){ var E7 = mk('s32', TRUE), o7 = run(E7, 1.2, [[0, 0.015, 'A'], [dt, dt + 0.005, 'B']], ['B.Vm']); r['preFirst_' + Math.round(dt * 1e3) + '_aps'] = aps(o7['B.Vm']).n; });
    var E8 = mk('s32', TRUE), o8 = run(E8, 1.2, [[0, 0.005, 'B'], [0.05, 0.065, 'A']], ['B.Vm']); r.postFirst_oneEPSP_aps = aps(o8['B.Vm']).n;
    return r;
  };
  /* ---- #3-4 true synapse ---- */
  function blocks(cfg, wB, n){          /* n IPSPs (50 ms apart), SW B 30 ms after the last A: does the Post still fire? */
    var E = mk('s34', cfg), tl = (n - 1) * 0.05, sch = train(n, 0.05, 0.015).concat([[tl + 0.03, tl + 0.03 + wB / 1e3, 'B']]);
    var o = run(E, tl + 0.6, sch, ['B.Vm']); return aps(o['B.Vm']).n === 0;
  }
  function need(cfg, wB){ for(var n = 1; n <= 6; n++) if(blocks(cfg, wB, n)) return n; return '>6'; }
  function rate(cfg, holdA){
    var E = mk('s34', cfg), sch = [[0, 6, 'B']]; if(holdA) sch.push([0, 6, 'A']);
    var o = run(E, 6, sch, ['B.Vm', 'A.Vm']), from = Math.round(2 / DT);
    var pb = aps(o['B.Vm'], from), pa = aps(o['A.Vm'], from);
    return {post_Hz:Math.round(pb.n / 4 * 10) / 10, pre_Hz:Math.round(pa.n / 4 * 10) / 10};
  }
  C.s34 = function(){
    var E = mk('s34', TRUE), r = {post_rest:r2(E.v('B.Vm'))};
    r.B_min_ms = bMin('s34', TRUE);
    r.need_B11_5 = need(TRUE, 11.5); r.need_B13 = need(TRUE, 13);
    r.need_B11_5_short = need(Object.assign({}, TRUE, {bat:'short'}), 11.5);
    return r;
  };
  C.s34_hz = function(){
    var r = {};
    [0, 6e3, 8e3].forEach(function(p){
      var cfg = Object.assign({}, TRUE, {rpotB:p}), k = 'pot' + (p / 1e3) + 'k';
      var a = rate(cfg, false), b = rate(cfg, true), c = rate(Object.assign({}, cfg, {bat:'short'}), true);
      r[k] = {B:a.post_Hz, B_withA:b.post_Hz, pre_Hz:b.pre_Hz, B_withA_short:c.post_Hz};
    });
    return r;
  };
  C.s34_rest_noinh = function(){        /* post membrane at rest without the inhibitory board's leak (#3-2 post as a reference) */
    var E = mk('s32', TRUE); return {s32_post_rest:r2(E.v('B.Vm'))};
  };

  /* ---- finer checks ---- */
  /* kit peaks depend on when the press lands on the free-running small peaks: start it at 16 phases */
  C.kit_phase = function(){
    function scan(circ, who, w, node){
      var lo = Infinity, hi = -Infinity;
      for(var ph = 0; ph < 0.16; ph += 0.01){ var E = mk(circ), o = run(E, ph + 0.6, [[ph, ph + w, who]], [node]), m = max(o[node].subarray(Math.round(ph / DT)))[0]; lo = Math.min(lo, m); hi = Math.max(hi, m); }
      return [r2(lo), r2(hi)];
    }
    var E = mk('s31'), hd = run(E, 3, [[0, 3, 'A']], ['A.Vm']);
    return {preA20:scan('s31', 'A', 0.02, 'A.Vm'), s32B10:scan('s32', 'B', 0.01, 'B.Vm'), s34B10:scan('s34', 'B', 0.01, 'B.Vm'), preHold_max:r2(max(hd['A.Vm'])[0])};
  };
  function bThr(circ, cfg, from){
    for(var w = from; w <= 40; w += 0.25){ var E = mk(circ, cfg), o = run(E, 0.6, [[0, w / 1e3, 'B']], ['B.Vm']); if(aps(o['B.Vm']).n) return w; }
    return '>40';
  }
  C.s32_fine = function(){
    var r = {B_thr_ms:bThr('s32', TRUE, 5)}, win = [];
    for(var dt = 0; dt <= 0.12; dt += 0.01){ var E = mk('s32', TRUE), o = run(E, 1.2, [[0, 0.015, 'A'], [dt, dt + 0.005, 'B']], ['B.Vm']); if(aps(o['B.Vm']).n) win.push(Math.round(dt * 1e3)); }
    r.preFirst_B5_fires_at_ms = win;
    return r;
  };
  C.s34_fine = function(){
    var thr = bThr('s34', TRUE, 9), r = {B_thr_ms:thr}, sh = Object.assign({}, TRUE, {bat:'short'});
    [0.5, 1, 1.5, 2, 2.5].forEach(function(dw){ var w = thr + dw; r['B' + w] = {need:need(TRUE, w), need_short:need(sh, w)}; });
    return r;
  };
  /* firing rate from the mean interval between Post APs from 2 s to 8 s */
  function rate2(cfg, holdA){
    var E = mk('s34', cfg), sch = [[0, 8, 'B']]; if(holdA) sch.push([0, 8, 'A']);
    var o = run(E, 8, sch, ['B.Vm', 'A.Vm']), from = Math.round(2 / DT);
    function hz(t){ return t.length < 2 ? (t.length ? '1 AP' : 0) : Math.round(10 * (t.length - 1) / (t[t.length - 1] - t[0])) / 10; }
    return {post:hz(aps(o['B.Vm'], from).t), pre:hz(aps(o['A.Vm'], from).t)};
  }
  C.s34_hz2 = function(){
    var r = {};
    [0, 6e3, 8e3].forEach(function(p){
      var cfg = Object.assign({}, TRUE, {rpotB:p}), sh = Object.assign({}, cfg, {bat:'short'});
      var a = rate2(cfg, false), b = rate2(cfg, true), c = rate2(sh, true);
      r['pot' + (p / 1e3) + 'k'] = {B:a.post, B_withA:b.post, pre:b.pre, B_withA_short:c.post, iB_uA:null};
    });
    return r;
  };

  function all(rp, keys, vp){
    RP = rp || 1e6; VP = vp || 7.0; var out = {rprobe:RP, vplus:VP};
    (keys || Object.keys(C)).forEach(function(k){ var t0 = performance.now(); out[k] = C[k](); out[k]._s = Math.round(performance.now() - t0) / 1e3; });
    return out;
  }
  return {all:all, checks:C};
})();
