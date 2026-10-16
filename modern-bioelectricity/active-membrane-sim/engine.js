/* Membrane circuit engine, same model as hw2-debug/sim/sim.py.
   Shared by active-membrane-sim/ (#2-2) and passive-active-sim/ (#2-3).
   Node codes follow hw2-debug/nodes.html.  'V+' and 'GND' are fixed (battery).
   st.chain = n >= 1 puts n passive units between the Stimulator and the active
   membrane (sim.py chain=n): PC1..PCn intracellular, PX2..PXn and AX extracellular.
   st.src = 'ideal' replaces the Stimulator's switch by an ideal current source st.isrc
   (sim.py check_23.py: a fixed node at 1e9 x I volts through 1 Gohm); the Stimulator
   stays in place with SW released, so its leak is still there.
   st.fi_supply = 'local' gives FI its own battery between FI.V+ and its extracellular
   node (handout simulator; sim.py fi_supply='local', a Norton source: 1 ohm in parallel
   with vplus/1 ohm amps from fixed nodes 'BAT+'/'BAT-' at +-vplus*1e9 V through 1 Gohm).
   Default 'stim': FI.V+ is wired to the Stimulator's battery. */
var AM = (function(){
  var VT = 0.02585, EXPLIM = 40, GMIN = 1e-12, SHORT = 0.05, OPEN = 1e13, CPAR = 10e-12;
  var M3904 = {Is:6.7e-15, bf:200, br:0.74}, M4403 = {Is:1e-14, bf:150, br:4}, MD = {Is:2.52e-9, n:1.752};
  /* 1N4148: 'std' the usual SPICE model; 'fit' drops ~50 mV more at uA currents (0.33 vs 0.27 V at 1 uA), which
     reproduces the HW2 measurements of held-SW firing (round 3, stacked LK) that 'std' does not */
  var MDS = {std:MD, fit:{Is:1.2e-9, n:1.87}};
  var BASE = ['ST.P','ST.K','ST.Q','ST.R','Vm','LK.Vm','FI.Vm','FI.V+','FI.GND','FI.B3','FI.E3','FI.B4','FI.E4',
              'SO.Vm','SO.GND','SO.S','SO.B3','SO.B4','SO.C4'];
  var NODES = [], N = 0, IDX = {};

  var st = {
    vplus:7.8, sw:false, rpot:0, r13:1e5, rfe:1e5, qs:'pcb', so_r2:1e6, rprobe:1e7, ch2:'',
    r13p:0, rf:0, rb:0, rs:0, rl:0, ru:0,           /* add-ons clipped on, 0 = not fitted; ru: V+ -> every passive unit */
    chain:0, src:'stim', isrc:50e-6, fi_supply:'stim',   /* #2-3: passive units, source, FI battery */
    leak:true, fi_vm:true, fi_vplus:true, fi_gnd:true, so_vm:true, so_gnd:true,
    fi_on:true, so_on:true, ch1:'Vm',               /* board plugged in at all (sim.py fi=/so=); CH1 probe node */
    lk2:false, leak2:true,                          /* a second Leak board stacked on the first; its header contact */
    diode:'std'                                     /* 1N4148 model, see MDS */
  };
  var V, Vprev, F, J, dx, A;
  /* node list for the current st.chain; node voltages carry over by name */
  function nodeNames(){
    var a = BASE.slice();
    for(var k = 1; k <= st.chain; k++){ a.push('PC' + k); if(k > 1) a.push('PX' + k); }
    if(st.chain) a.push('AX');
    if(st.lk2) a.push('LK2.Vm');
    if(st.fi_supply === 'local') a.push('FI.BAT');
    return a;
  }
  function alloc(names){
    var old = V, oldIdx = IDX;
    NODES = names; N = names.length; IDX = {'GND':-1, 'V+':-2, 'IS':-3, 'BAT+':-4, 'BAT-':-5};
    names.forEach(function(n, i){ IDX[n] = i; });
    V = new Float64Array(N); Vprev = new Float64Array(N);
    F = new Float64Array(N); J = new Float64Array(N * N); dx = new Float64Array(N); A = new Float64Array(N * (N + 1));
    if(old) names.forEach(function(n, i){ if(oldIdx[n] >= 0) V[i] = old[oldIdx[n]]; });
  }
  var R = [], C = [], D = [], Q = [];
  var t = 0, gmin = GMIN, lastH = 0;                /* lastH: last accepted step, for capacitor currents */
  var stat = {it:0, sub:false, ok:true};            /* last step: Newton iterations, whether it fell back to 10 sub-steps */

  function link(ok){ return ok ? SHORT : OPEN; }
  function build(){
    var names = nodeNames();
    if(names.join() !== NODES.join()) alloc(names);
    R = []; C = []; D = []; Q = [];
    MD = MDS[st.diode] || MDS.std;
    function r(a, b, ohm, name){ R.push([IDX[a], IDX[b], 1 / ohm, name]); }   /* name: branch id for currents() */
    var out = st.chain ? 'PC1' : 'Vm', ax = st.chain ? 'AX' : 'GND';
    /* Stimulator */
    r('V+', 'ST.P', link(st.sw && st.src !== 'ideal'), 'sw');
    r('ST.P', 'ST.K', Math.max(st.rpot, 1), 'pot');
    r('ST.K', 'ST.Q', 7e3, 'r7a');
    Q.push(['p', IDX[out], IDX['ST.R'], IDX['ST.Q'], M4403, 'pass']);
    Q.push(['p', IDX['ST.R'], IDX['ST.Q'], st.qs === 'sw' ? IDX['ST.P'] : IDX['V+'], M4403, 'sense']);
    if(st.qs === 'rx') r('ST.Q', 'ST.R', 22e3, 'rx');      /* fix: 22 kohm across Qpass E-B */
    if(st.qs === 'rx10') r('ST.Q', 'ST.R', 10e3, 'rx');    /* 10 kohm there: pot range ~41-0.3 uA */
    if(st.qs === 'rx12') r('ST.Q', 'ST.R', 12e3, 'rx');    /* 12 kohm there: pot range ~51-2.6 uA (#2-3 I_min, true AP) */
    r('ST.R', 'GND', 7e3, 'r7b');
    /* Leak */
    r('Vm', 'LK.Vm', link(st.leak), 'lk');
    C.push([IDX['LK.Vm'], IDX[ax], 1e-6, 'lkc']); r('LK.Vm', ax, 1e5, 'lkr');
    if(st.lk2){                                     /* second Leak stacked on the header: straight onto Vm, no 10k / 100 ohm */
      r('Vm', 'LK2.Vm', link(st.leak2), 'lk2');
      C.push([IDX['LK2.Vm'], IDX[ax], 1e-6, 'lk2c']); r('LK2.Vm', ax, 1e5, 'lk2r');
    }
    /* Fast inward */
    if(st.fi_on){
    r('FI.Vm', 'Vm', link(st.fi_vm), 'fivm'); r('FI.V+', st.fi_supply === 'local' ? 'FI.BAT' : 'V+', link(st.fi_vplus), 'fivp'); r('FI.GND', ax, link(st.fi_gnd), 'figd');
    D.push([IDX['FI.Vm'], IDX['FI.B3'], 'fid']);
    r('FI.B3', 'FI.GND', 3e6, 'fir3');
    Q.push(['n', IDX['FI.B4'], IDX['FI.B3'], IDX['FI.E3'], M3904, 'fi3904']);
    r('FI.E3', 'FI.GND', st.rfe, 'fire');
    Q.push(['p', IDX['FI.Vm'], IDX['FI.B4'], IDX['FI.E4'], M4403, 'fi4403']);
    r('FI.E4', 'FI.V+', st.r13, 'r13');
    if(st.fi_supply === 'local'){                   /* FI's own battery, floating on its extracellular node */
      r('FI.BAT', ax, 1); r('BAT+', 'FI.BAT', 1e9); r('BAT-', ax, 1e9);
    }
    }
    /* Slow out */
    if(st.so_on){
    r('SO.Vm', 'Vm', link(st.so_vm), 'sovm'); r('SO.GND', ax, link(st.so_gnd), 'sogd');
    r('SO.Vm', 'SO.S', 1e5, 'sor1');
    C.push([IDX['SO.S'], IDX['SO.GND'], 1e-6, 'soc']);
    D.push([IDX['SO.S'], IDX['SO.B3'], 'sod']);
    r('SO.B3', 'SO.GND', st.so_r2, 'sor2');                 /* 3M-R2 position: TA 1 Mohm on every board */
    Q.push(['n', IDX['SO.B4'], IDX['SO.B3'], IDX['SO.GND'], M3904, 'so3904']);
    Q.push(['p', IDX['SO.C4'], IDX['SO.B4'], IDX['SO.Vm'], M4403, 'so4403']);
    r('SO.C4', 'SO.GND', 1e3, 'sor1k');
    }
    /* add-ons: resistors clipped onto existing legs (sim.py extra=, check_ap.py) */
    if(st.r13p && st.fi_on) r('FI.V+', 'FI.E4', st.r13p, 'r13p');   /* across R13 */
    if(st.rf && st.fi_on) r('FI.V+', 'FI.E3', st.rf, 'rf');        /* R13 lower end to 100K-R2 upper end */
    if(st.rb) r('V+', 'Vm', st.rb, 'rb');                          /* breadboard V+ row to Vm row */
    if(st.rl) r('Vm', 'GND', st.rl, 'rl');                         /* extra leak: Vm row to GND row */
    if(st.rs && st.so_on) r('SO.S', 'SO.GND', st.rs, 'rs');        /* across SO C1 */
    /* #2-3 passive units: 1 uF || 100 kohm each, 10 kohm apart, 100 ohm extracellular */
    for(var k = 1; k <= st.chain; k++){
      var pc = 'PC' + k, px = k === 1 ? 'GND' : 'PX' + k;
      C.push([IDX[pc], IDX[px], 1e-6, 'pc' + k]); r(pc, px, 1e5, 'pr' + k);
      if(st.ru) r('V+', pc, st.ru, 'ru' + k);                 /* add-on: unit rests at the same level as the active end */
      r(pc, k < st.chain ? 'PC' + (k + 1) : 'Vm', 1e4, 'ps' + k);
      r(px, k < st.chain ? 'PX' + (k + 1) : 'AX', 100, 'px' + k);
    }
    if(st.src === 'ideal') r('IS', out, 1e9, 'is');       /* ideal current source */
    /* probes */
    r(st.ch1 || 'Vm', 'GND', st.rprobe, 'p1');
    if(st.ch2) r(st.ch2, 'GND', st.rprobe, 'p2');
  }

  function gv(arr, i){
    if(i >= 0) return arr[i];
    if(i === -1) return 0;
    if(i === -2) return st.vplus;
    if(i === -4) return st.vplus * 1e9;              /* 'BAT+' */
    if(i === -5) return -st.vplus * 1e9;             /* 'BAT-' */
    return st.sw && st.src === 'ideal' ? st.isrc * 1e9 : 0;   /* 'IS' */
  }
  function lexp(x){ if(x > EXPLIM){ var e = Math.exp(EXPLIM); return [e * (1 + x - EXPLIM), e]; } var e2 = Math.exp(x); return [e2, e2]; }

  /* currents INTO (c,b,e) and their Jacobian rows */
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
      for(k = 0; k < N; k++) stampG(k, -1, gmin, 0);
      /* 10 pF stray capacitance from every node to GND (x10 probe ~10-15 pF, wiring): without it a
         node with no capacitor (Vm with the Leak unplugged) has no dynamics and a latch has no
         unique step solution; tau = 10 pF x 100 kohm = 1 us, far below the 0.2 ms step */
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
      /* nearly floating nodes (FI.B4 with the Fast inward off, no Leak) can keep the step above
         0.1 uV for hundreds of iterations; accept once KCL holds to 10 pA at every node */
      if(it >= 20){ var fm = 0; for(k = 0; k < N; k++) if(Math.abs(F[k]) > fm) fm = Math.abs(F[k]); if(fm < 1e-11){ stat.it = it + 1; return true; } }
      /* solve J dx = -F (Gaussian elimination, partial pivoting) */
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

  /* DC operating point, same strategy as sim.py: plain Newton, then gmin stepping */
  function dcSolve(guess){
    V.fill(0);
    if(guess) for(var n in guess) if(IDX[n] >= 0) V[IDX[n]] = guess[n];
    gmin = GMIN;
    if(newton(0, 3000)) return true;
    for(var g = guess ? 1e-9 : 1e-4; g > GMIN * 1.01; g /= 10){ gmin = g; newton(0, 3000); }
    gmin = GMIN;
    return newton(0, 3000);
  }
  /* power on: every capacitor (and node) at 0 V, like plugging in the battery */
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
  function v(n){ return gv(V, IDX[n]); }
  /* conventional current of every named branch, first node -> second node (amps); transistors by
     tag as [into C, into B, into E].  Capacitors use the last step (backward Euler, like newton). */
  function currents(){
    var o = {}, k, e, x;
    for(k = 0; k < R.length; k++){ e = R[k]; if(e[3]) o[e[3]] = e[2] * (gv(V, e[0]) - gv(V, e[1])); }
    for(k = 0; k < C.length; k++){ e = C[k];
      if(e[3]) o[e[3]] = lastH ? e[2] / lastH * ((gv(V, e[0]) - gv(V, e[1])) - (gv(Vprev, e[0]) - gv(Vprev, e[1]))) : 0; }
    for(k = 0; k < D.length; k++){ e = D[k];
      if(e[2]){ x = lexp((gv(V, e[0]) - gv(V, e[1])) / (MD.n * VT)); o[e[2]] = MD.Is * (x[0] - 1); } }
    for(k = 0; k < Q.length; k++){ e = Q[k]; x = bjt(e[0], gv(V, e[1]), gv(V, e[2]), gv(V, e[3]), e[4]); o[e[5]] = [x.i[0], x.i[1], x.i[2]]; }
    return o;
  }
  function qCurrents(tag){
    for(var k = 0; k < Q.length; k++) if(Q[k][5] === tag){
      var e = Q[k], o = bjt(e[0], gv(V, e[1]), gv(V, e[2]), gv(V, e[3]), e[4]);
      return [o.i[0], o.i[1], o.i[2]];
    }
    return [0, 0, 0];
  }
  /* every element as built, for the circuit inspector: node names in engine order, value, model */
  function nodeName(i){ return i >= 0 ? NODES[i] : ({'-1':'GND', '-2':'V+', '-3':'IS', '-4':'BAT+', '-5':'BAT-'})[i]; }
  function branches(){
    var o = [];
    R.forEach(function(e){ o.push({kind:'R', name:e[3], nodes:[nodeName(e[0]), nodeName(e[1])], val:1 / e[2]}); });
    C.forEach(function(e){ o.push({kind:'C', name:e[3], nodes:[nodeName(e[0]), nodeName(e[1])], val:e[2]}); });
    D.forEach(function(e){ o.push({kind:'D', name:e[2], nodes:[nodeName(e[0]), nodeName(e[1])], model:MD}); });
    Q.forEach(function(e){ o.push({kind:'Q', name:e[5], type:e[0], nodes:[nodeName(e[1]), nodeName(e[2]), nodeName(e[3])], model:e[4]}); });
    return o;
  }
  alloc(nodeNames());
  return {
    st:st, build:build, dc:dcSolve, powerOn:powerOn, step:step, v:v, q:qCurrents, currents:currents,
    time:function(){ return t; }, setTime:function(x){ t = x; }, nodes:function(){ return NODES; },
    has:function(n){ return IDX[n] !== undefined; },
    /* inspector: elements, previous-step voltage, step size, solver stats, constants and the solver's own functions */
    branches:branches, vprev:function(n){ return gv(Vprev, IDX[n]); }, h:function(){ return lastH; }, stat:stat,
    K:{VT:VT, EXPLIM:EXPLIM, GMIN:GMIN, SHORT:SHORT, OPEN:OPEN, CPAR:CPAR, M3904:M3904, M4403:M4403, MD:MD},
    fn:{build:build, newton:newton, stampG:stampG, bjt:bjt, lexp:lexp, step:step, currents:currents, dcSolve:dcSolve, link:link}
  };
})();
