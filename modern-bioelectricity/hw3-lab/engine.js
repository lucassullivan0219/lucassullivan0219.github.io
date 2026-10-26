/* HW3 synapse engine: the HW2 device models (../active-membrane-sim/engine.js, hw2-debug/sim/sim.py:
   modified nodal analysis, backward Euler, damped Newton, Ebers-Moll BJTs, 10 pF stray per node) on a
   netlist of two cells joined by a synapse board:

     Stimulator A -> pre active membrane -> synapse (excitatory / inhibitory) -> post -> Stimulator B

   post = 5 passive units (P1..P5, 1 uF || 100 kohm, 10 kohm apart; the synapse and Stimulator B enter P1)
        or active membrane 2.  Every instance is independent (SynEngine() returns a new one), so a sweep
   can run in the background while the live circuit keeps going.

   The boards have no pluggable contacts here (HW2's are merged): Leak, FI and SO sit directly on Vm.
   Node codes: SA.* / SB.* Stimulators, A.* pre membrane (A.Vm), B.* post membrane (B.Vm), SY.* synapse. */
var SynEngine = function(){
  var VT = 0.02585, EXPLIM = 40, GMIN = 1e-12, CPAR = 10e-12;
  var M3904 = {Is:6.7e-15, bf:200, br:0.74}, M4403 = {Is:1e-14, bf:150, br:4}, MD = {Is:2.52e-9, n:1.752};

  /* membrane variants, as HW2: kit = as built with the Slow out R2 = 1 Mohm (TA spec, every board now), true = HW2 true-AP add-ons */
  var MEM = {
    kit:{so_r2:1e6, qs:'pcb', r13p:0, rf:0, rs:0, rb:0},
    true:{so_r2:1e6, qs:'rx', r13p:11e3, rf:680e3, rs:56e3, rb:330e3}
  };

  var st = {
    vplus:8.44,              /* Stimulator battery (9 V cell). 8.44 V = our board, measured 2026-10-21 (was 7.0 V, an estimate from HW2 #2-2; 7.8 V was another group's board); also the synapse V+ through the header */
    vsyn:0,                  /* synapse V+ if it has its own battery (0 = same as vplus) */
    swA:false, swB:false, rpotA:700, rpotB:700,
    pre:'true', post:'passive', postMem:'true',
    syn:'exc',               /* 'exc' | 'inh' | 'none' */
    bat:'on',                /* inhibitory 1.5 V battery: 'on' | 'short' (removed, jumper) | 'open' (removed) */
    vbat:1.5,
    r1p:0,                   /* add-on across the synapse's 820k input resistor (0 = none) */
    r13A:0,                  /* Pre's FI emitter resistor R13 (0 = the PCB's 100k; the handout FI draws 1k) */
    r6:0,                    /* excitatory: resistor between D2 and the post cell; PCB = 0 (straight trace), handout 100k */
    r5:0,                    /* S -> GND resistor next to the 4.7 uF (0 = 200k: handout schematic and PCB image R5; our excitatory board's silkscreen says 100K-R15, photo 2026-10-26) */
    stimA:true, stimB:true,  /* Stimulator B plugged in */
    rprobe:1e6, ch1:'A.Vm', ch2:'P1'
  };

  var NODES = [], N = 0, IDX = {}, V, Vprev, F, J, dx, A;
  var R = [], C = [], D = [], Q = [], BAT = [];
  var t = 0, gmin = GMIN, lastH = 0, stat = {it:0, sub:false, ok:true};

  function memOf(v){ return MEM[v] || MEM.kit; }
  function nodeNames(){
    var a = ['SA.P','SA.K','SA.Q','SA.R'];
    a.push('A.Vm','A.FI.B3','A.FI.E3','A.FI.B4','A.FI.E4','A.SO.S','A.SO.B3','A.SO.B4','A.SO.C4');
    if(st.syn === 'exc') a.push('SY.A','SY.B','SY.E2','SY.C2','SY.E1','SY.S','SY.D');
    if(st.syn === 'inh') a.push('SY.A','SY.B','SY.E2','SY.C2','SY.E1','SY.C1','SY.S');
    if(st.post === 'passive') a.push('P1','P2','P3','P4','P5');
    else a.push('B.Vm','B.FI.B3','B.FI.E3','B.FI.B4','B.FI.E4','B.SO.S','B.SO.B3','B.SO.B4','B.SO.C4');
    if(st.stimB) a.push('SB.P','SB.K','SB.Q','SB.R');
    return a;
  }
  function alloc(names){
    var old = V, oldIdx = IDX;
    NODES = names; N = names.length; IDX = {'GND':-1, 'V+':-2, 'VS':-3};
    names.forEach(function(n, i){ IDX[n] = i; });
    V = new Float64Array(N); Vprev = new Float64Array(N);
    F = new Float64Array(N); J = new Float64Array(N * N); dx = new Float64Array(N); A = new Float64Array(N * (N + 1));
    if(old) names.forEach(function(n, i){ if(oldIdx[n] >= 0) V[i] = old[oldIdx[n]]; });
  }

  function build(){
    var names = nodeNames();
    if(names.join() !== NODES.join()) alloc(names);
    R = []; C = []; D = []; Q = []; BAT = [];
    function r(a, b, ohm, name){ R.push([IDX[a], IDX[b], 1 / ohm, name]); }
    function stim(p, out, sw, rpot, qs){
      if(sw) r('V+', p + '.P', 0.05, p + '.sw');
      r(p + '.P', p + '.K', Math.max(rpot, 1), p + '.pot');
      r(p + '.K', p + '.Q', 7e3, p + '.r7a');
      Q.push(['p', IDX[out], IDX[p + '.R'], IDX[p + '.Q'], M4403, p + '.pass']);
      Q.push(['p', IDX[p + '.R'], IDX[p + '.Q'], IDX['V+'], M4403, p + '.sense']);
      if(qs === 'rx') r(p + '.Q', p + '.R', st.rxv || 22e3, p + '.rx');   /* true AP: 22 kohm across Qpass E-B, no leak (st.rxv to tune) */
      r(p + '.R', 'GND', 7e3, p + '.r7b');
    }
    function membrane(p, m){
      var vm = p + '.Vm';
      var nlk = m.nlk || 1;                                                                 /* Leak: nlk Passive Units in parallel (SPIKE LAB stacks) */
      C.push([IDX[vm], -1, 1e-6 * nlk, p + '.lkc']); r(vm, 'GND', 1e5 / nlk, p + '.lkr');
      D.push([IDX[vm], IDX[p + '.FI.B3'], p + '.fid']);                                    /* Fast inward */
      r(p + '.FI.B3', 'GND', 3e6, p + '.fir3');
      Q.push(['n', IDX[p + '.FI.B4'], IDX[p + '.FI.B3'], IDX[p + '.FI.E3'], M3904, p + '.fi3904']);
      r(p + '.FI.E3', 'GND', 1e5, p + '.fire');
      Q.push(['p', IDX[vm], IDX[p + '.FI.B4'], IDX[p + '.FI.E4'], M4403, p + '.fi4403']);
      r(p + '.FI.E4', 'V+', p === 'A' && st.r13A ? st.r13A : 1e5, p + '.r13');
      r(vm, p + '.SO.S', 1e5, p + '.sor1');                                                /* Slow out */
      C.push([IDX[p + '.SO.S'], -1, 1e-6, p + '.soc']);
      D.push([IDX[p + '.SO.S'], IDX[p + '.SO.B3'], p + '.sod']);
      r(p + '.SO.B3', 'GND', m.so_r2, p + '.sor2');
      Q.push(['n', IDX[p + '.SO.B4'], IDX[p + '.SO.B3'], -1, M3904, p + '.so3904']);
      Q.push(['p', IDX[p + '.SO.C4'], IDX[p + '.SO.B4'], IDX[vm], M4403, p + '.so4403']);
      r(p + '.SO.C4', 'GND', 1e3, p + '.sor1k');
      if(m.r13p) r('V+', p + '.FI.E4', m.r13p, p + '.r13p');
      if(m.rf) r('V+', p + '.FI.E3', m.rf, p + '.rf');
      if(m.rb) r('V+', vm, m.rb, p + '.rb');
      if(m.rs) r(p + '.SO.S', 'GND', m.rs, p + '.rs');
    }
    var mA = memOf(st.pre), mB = memOf(st.postMem);
    var post = st.post === 'passive' ? 'P1' : 'B.Vm';
    var vs = st.vsyn ? 'VS' : 'V+';
    stim('SA', 'A.Vm', st.swA && st.stimA, st.rpotA, mA.qs);
    membrane('A', mA);
    if(st.syn === 'exc'){
      /* excitatory synapse PCB: 820k, D1, Q2 2N3904 (10 nF || 100k at B, 30k at E), Q1 2N4403 (1k to V+),
         S = 4.7 uF || 200k, D2 to the post cell (the PCB's trace is straight; the handout draws 100k after D2) */
      r('A.Vm', 'SY.A', 820e3, 'sy.r1'); if(st.r1p) r('A.Vm', 'SY.A', st.r1p, 'sy.r1p');
      D.push([IDX['SY.A'], IDX['SY.B'], 'sy.d1']);
      C.push([IDX['SY.B'], -1, 10e-9, 'sy.c1']); r('SY.B', 'GND', 1e5, 'sy.r2');
      Q.push(['n', IDX['SY.C2'], IDX['SY.B'], IDX['SY.E2'], M3904, 'sy.q2']); r('SY.E2', 'GND', 30e3, 'sy.r3');
      Q.push(['p', IDX['SY.S'], IDX['SY.C2'], IDX['SY.E1'], M4403, 'sy.q1']); r('SY.E1', vs, 1e3, 'sy.r4');
      C.push([IDX['SY.S'], -1, 4.7e-6, 'sy.c2']); r('SY.S', 'GND', st.r5 || 200e3, 'sy.r5');
      D.push([IDX['SY.S'], IDX['SY.D'], 'sy.d2']); r('SY.D', post, st.r6 || 0.05, 'sy.r6');
    } else if(st.syn === 'inh'){
      /* inhibitory synapse PCB: same input stage; Q1 E -> 1.5 V battery (+ at E, - at S), Q1 C -> 15k -> GND,
         S = 4.7 uF || 200k, 100k to the post cell (no diode) */
      r('A.Vm', 'SY.A', 820e3, 'sy.r1'); if(st.r1p) r('A.Vm', 'SY.A', st.r1p, 'sy.r1p');
      D.push([IDX['SY.A'], IDX['SY.B'], 'sy.d1']);
      C.push([IDX['SY.B'], -1, 10e-9, 'sy.c1']); r('SY.B', 'GND', 1e5, 'sy.r2');
      Q.push(['n', IDX['SY.C2'], IDX['SY.B'], IDX['SY.E2'], M3904, 'sy.q2']); r('SY.E2', 'GND', 30e3, 'sy.r3');
      Q.push(['p', IDX['SY.C1'], IDX['SY.C2'], IDX['SY.E1'], M4403, 'sy.q1']); r('SY.C1', 'GND', 15e3, 'sy.r4');
      if(st.bat === 'on') BAT.push([IDX['SY.S'], IDX['SY.E1'], st.vbat, 1, 'sy.bat']);   /* - at S, + at Q1 E */
      else if(st.bat === 'short') r('SY.S', 'SY.E1', 0.05, 'sy.bat');
      C.push([IDX['SY.S'], -1, 4.7e-6, 'sy.c2']); r('SY.S', 'GND', st.r5 || 200e3, 'sy.r5');
      r('SY.S', post, 100e3, 'sy.r6');
    }
    if(st.post === 'passive'){
      for(var k = 1; k <= 5; k++){
        C.push([IDX['P' + k], -1, 1e-6, 'pc' + k]); r('P' + k, 'GND', 1e5, 'pr' + k);
        if(k < 5) r('P' + k, 'P' + (k + 1), 1e4, 'ps' + k);
      }
    } else membrane('B', mB);
    if(st.stimB) stim('SB', post, st.swB, st.rpotB, st.post === 'passive' ? 'pcb' : mB.qs);
    r(st.ch1 || 'A.Vm', 'GND', st.rprobe, 'p1');
    if(st.ch2 && IDX[st.ch2] !== undefined) r(st.ch2, 'GND', st.rprobe, 'p2');
  }

  function gv(arr, i){
    if(i >= 0) return arr[i];
    if(i === -1) return 0;
    if(i === -2) return st.vplus;
    return st.vsyn || st.vplus;                    /* 'VS' */
  }
  function lexp(x){ if(x > EXPLIM){ var e = Math.exp(EXPLIM); return [e * (1 + x - EXPLIM), e]; } var e2 = Math.exp(x); return [e2, e2]; }

  var bo = {i:[0,0,0], d:[0,0,0,0,0,0,0,0,0]};
  function bjt(kind, vc, vb, ve, m){
    var k = 1 + 1 / m.br, ef, er, If, Ir, gf, gr, i = bo.i, d = bo.d;
    if(kind === 'n'){
      ef = lexp((vb - ve) / VT); er = lexp((vb - vc) / VT);
      If = m.Is * (ef[0] - 1); gf = m.Is * ef[1] / VT;
      Ir = m.Is * (er[0] - 1); gr = m.Is * er[1] / VT;
      i[0] = If - Ir * k; i[1] = If / m.bf + Ir / m.br;
    } else {
      ef = lexp((ve - vb) / VT); er = lexp((vc - vb) / VT);
      If = m.Is * (ef[0] - 1); gf = m.Is * ef[1] / VT;
      Ir = m.Is * (er[0] - 1); gr = m.Is * er[1] / VT;
      i[0] = -(If - Ir * k); i[1] = -(If / m.bf + Ir / m.br);
    }
    d[0] = gr * k;     d[1] = gf - gr * k;          d[2] = -gf;
    d[3] = -gr / m.br; d[4] = gf / m.bf + gr / m.br; d[5] = -gf / m.bf;
    i[2] = -i[0] - i[1];
    d[6] = -(d[0] + d[3]); d[7] = -(d[1] + d[4]); d[8] = -(d[2] + d[5]);
    return bo;
  }
  function stampG(a, b, g, ieq){
    var cur = g * (gv(V, a) - gv(V, b)) + ieq;
    if(a >= 0){ F[a] += cur; J[a * N + a] += g; if(b >= 0) J[a * N + b] -= g; }
    if(b >= 0){ F[b] -= cur; J[b * N + b] += g; if(a >= 0) J[b * N + a] -= g; }
  }

  function newton(dt, maxit){
    var nn = [0, 0, 0];
    for(var it = 0; it < maxit; it++){
      F.fill(0); J.fill(0);
      var k, e;
      for(k = 0; k < R.length; k++){ e = R[k]; stampG(e[0], e[1], e[2], 0); }
      /* battery (Norton): current neg -> pos through it = (V_neg - V_pos + vbat) / rint */
      for(k = 0; k < BAT.length; k++){ e = BAT[k]; stampG(e[0], e[1], 1 / e[3], e[2] / e[3]); }
      for(k = 0; k < N; k++) stampG(k, -1, gmin, 0);
      if(dt){ var gp = CPAR / dt; for(k = 0; k < N; k++) stampG(k, -1, gp, -gp * Vprev[k]); }
      if(dt){
        for(k = 0; k < C.length; k++){ e = C[k]; var g = e[2] / dt; stampG(e[0], e[1], g, -g * (gv(Vprev, e[0]) - gv(Vprev, e[1]))); }
      }
      for(k = 0; k < D.length; k++){
        e = D[k];
        var x = lexp((gv(V, e[0]) - gv(V, e[1])) / (MD.n * VT));
        var id = MD.Is * (x[0] - 1), gd = MD.Is * x[1] / (MD.n * VT), a = e[0], c = e[1];
        if(a >= 0){ F[a] += id; J[a * N + a] += gd; if(c >= 0) J[a * N + c] -= gd; }
        if(c >= 0){ F[c] -= id; J[c * N + c] += gd; if(a >= 0) J[c * N + a] -= gd; }
      }
      for(k = 0; k < Q.length; k++){
        e = Q[k]; nn[0] = e[1]; nn[1] = e[2]; nn[2] = e[3];
        var o = bjt(e[0], gv(V, e[1]), gv(V, e[2]), gv(V, e[3]), e[4]);
        for(var tt = 0; tt < 3; tt++){
          var row = nn[tt]; if(row < 0) continue;
          F[row] += o.i[tt];
          for(var s = 0; s < 3; s++){ var col = nn[s]; if(col >= 0) J[row * N + col] += o.d[tt * 3 + s]; }
        }
      }
      if(it >= 20){ var fm = 0; for(k = 0; k < N; k++) if(Math.abs(F[k]) > fm) fm = Math.abs(F[k]); if(fm < 1e-11){ stat.it = it + 1; return true; } }
      var W = N + 1, r, cc, p, q;
      for(r = 0; r < N; r++){ for(cc = 0; cc < N; cc++) A[r * W + cc] = J[r * N + cc]; A[r * W + N] = -F[r]; }
      for(cc = 0; cc < N; cc++){
        p = cc; var best = Math.abs(A[cc * W + cc]);
        for(r = cc + 1; r < N; r++){ var av = Math.abs(A[r * W + cc]); if(av > best){ best = av; p = r; } }
        if(p !== cc){ for(q = cc; q <= N; q++){ var tmp = A[cc * W + q]; A[cc * W + q] = A[p * W + q]; A[p * W + q] = tmp; } }
        var pv = A[cc * W + cc];
        for(r = cc + 1; r < N; r++){
          var f = A[r * W + cc] / pv; if(f === 0) continue;
          for(q = cc; q <= N; q++) A[r * W + q] -= f * A[cc * W + q];
        }
      }
      var mx = 0;
      for(r = N - 1; r >= 0; r--){
        var sum = A[r * W + N];
        for(q = r + 1; q < N; q++) sum -= A[r * W + q] * dx[q];
        dx[r] = sum / A[r * W + r];
        if(Math.abs(dx[r]) > mx) mx = Math.abs(dx[r]);
      }
      var sc = mx <= 0.1 ? 1 : 0.1 / mx;
      for(r = 0; r < N; r++) V[r] += sc * dx[r];
      if(mx < 1e-7){ stat.it = it + 1; return true; }
    }
    stat.it = maxit;
    return false;
  }
  function powerOn(){ V.fill(0); Vprev.fill(0); t = 0; lastH = 0; }
  function step(dt){
    Vprev.set(V);
    if(newton(dt, 80)){ t += dt; lastH = dt; stat.sub = false; stat.ok = true; return true; }
    V.set(Vprev);
    var ok = true;
    for(var k = 0; k < 10; k++){ Vprev.set(V); ok = newton(dt / 10, 400) && ok; }
    t += dt; lastH = dt / 10; stat.sub = true; stat.ok = ok;
    return ok;
  }
  function v(n){ var i = IDX[n]; return i === undefined ? NaN : gv(V, i); }
  function qCurrents(tag){
    for(var k = 0; k < Q.length; k++) if(Q[k][5] === tag){
      var e = Q[k], o = bjt(e[0], gv(V, e[1]), gv(V, e[2]), gv(V, e[3]), e[4]);
      return [o.i[0], o.i[1], o.i[2]];
    }
    return [0, 0, 0];
  }
  /* conventional current of a named two-terminal branch, first node -> second (A) */
  function branch(name){
    var k, e;
    for(k = 0; k < R.length; k++){ e = R[k]; if(e[3] === name) return e[2] * (gv(V, e[0]) - gv(V, e[1])); }
    for(k = 0; k < D.length; k++){ e = D[k]; if(e[2] === name){ var x = lexp((gv(V, e[0]) - gv(V, e[1])) / (MD.n * VT)); return MD.Is * (x[0] - 1); } }
    for(k = 0; k < BAT.length; k++){ e = BAT[k]; if(e[4] === name) return (gv(V, e[0]) - gv(V, e[1]) + e[2]) / e[3]; }
    return 0;
  }
  /* every named branch current at once, for the electron flow and the inspector (HW2's AM.currents()):
     two-terminal parts first node -> second (A), transistors [into C, into B, into E], batteries - -> +.
     Capacitors use the last step (backward Euler, like newton). */
  function currents(){
    var o = {}, k, e, x;
    for(k = 0; k < R.length; k++){ e = R[k]; if(e[3]) o[e[3]] = e[2] * (gv(V, e[0]) - gv(V, e[1])); }
    for(k = 0; k < C.length; k++){ e = C[k];
      if(e[3]) o[e[3]] = lastH ? e[2] / lastH * ((gv(V, e[0]) - gv(V, e[1])) - (gv(Vprev, e[0]) - gv(Vprev, e[1]))) : 0; }
    for(k = 0; k < D.length; k++){ e = D[k]; x = lexp((gv(V, e[0]) - gv(V, e[1])) / (MD.n * VT)); o[e[2]] = MD.Is * (x[0] - 1); }
    for(k = 0; k < Q.length; k++){ e = Q[k]; x = bjt(e[0], gv(V, e[1]), gv(V, e[2]), gv(V, e[3]), e[4]); o[e[5]] = [x.i[0], x.i[1], x.i[2]]; }
    for(k = 0; k < BAT.length; k++){ e = BAT[k]; o[e[4]] = (gv(V, e[0]) - gv(V, e[1]) + e[2]) / e[3]; }
    return o;
  }
  /* every element as built, for the inspector: node names in engine order, value, model */
  function nodeName(i){ return i >= 0 ? NODES[i] : ({'-1':'GND', '-2':'V+', '-3':'VS'})[i]; }
  function branches(){
    var o = [];
    R.forEach(function(e){ o.push({kind:'R', name:e[3], nodes:[nodeName(e[0]), nodeName(e[1])], val:1 / e[2]}); });
    C.forEach(function(e){ o.push({kind:'C', name:e[3], nodes:[nodeName(e[0]), nodeName(e[1])], val:e[2]}); });
    D.forEach(function(e){ o.push({kind:'D', name:e[2], nodes:[nodeName(e[0]), nodeName(e[1])], model:MD}); });
    Q.forEach(function(e){ o.push({kind:'Q', name:e[5], type:e[0], nodes:[nodeName(e[1]), nodeName(e[2]), nodeName(e[3])], model:e[4]}); });
    BAT.forEach(function(e){ o.push({kind:'B', name:e[4], nodes:[nodeName(e[0]), nodeName(e[1])], val:e[2], rint:e[3]}); });
    return o;
  }
  /* settle: run with every switch released until the circuit rests (power-on transient) */
  function settle(T, dt){ dt = dt || 2e-4; var n = Math.round(T / dt); for(var k = 0; k < n; k++) step(dt); t = 0; }
  alloc(nodeNames());
  return {
    st:st, MEM:MEM, build:build, powerOn:powerOn, step:step, settle:settle, v:function(n){ return n === 'GND' ? 0 : n === 'V+' ? st.vplus : n === 'VS' ? (st.vsyn || st.vplus) : v(n); },
    q:qCurrents, branch:branch, currents:currents,
    /* inspector: elements, previous-step voltage, step size, solver stats, constants and the solver's own functions */
    branches:branches, vprev:function(n){ var i = IDX[n]; return i === undefined ? NaN : gv(Vprev, i); }, h:function(){ return lastH; }, stat:stat,
    K:{VT:VT, EXPLIM:EXPLIM, GMIN:GMIN, CPAR:CPAR, M3904:M3904, M4403:M4403, MD:MD},
    fn:{build:build, newton:newton, stampG:stampG, bjt:bjt, lexp:lexp, step:step, currents:currents},
    time:function(){ return t; }, nodes:function(){ return NODES; }, has:function(n){ return IDX[n] !== undefined; },
    snapshot:function(){ return {V:Float64Array.from(V), t:t, names:NODES.slice()}; },
    restore:function(s){ if(s.names.join() !== NODES.join()) return false; V.set(s.V); Vprev.set(s.V); t = s.t; return true; }
  };
};
