/* SPIKE LAB — boards, assembly rules, and what the table means electrically.
   Reads ../circuits/circuits.js (the three circuit types) and drives either the HW2 engine
   (../active-membrane-sim/engine.js, global AM) or the HW3 engine (../hw3-lab/engine.js, SynEngine()).

   The table is one row of SPOTS spots, 0.95 apart.  A spot is bare table, one socket of a Base Board
   (5 sockets, 10 kΩ inside / 100 Ω outside between neighbours, no V+), or one side of a synapse board
   (left = PreSynapse, right = PostSynapse).  Boards stack on a spot; the Stimulator is always the top
   board of its stack, and inside a stack the current runs from top to bottom.

   HW2 (no synapse on the table): the Stimulator's stack is the start.
     - FI / SO (and a Passive Unit as the leak) stacked under it -> #2-2 (n = 0): one membrane node
     - on a Base Board                           -> follow the occupied sockets away from it; every socket is
                                                     one node, 10 kΩ apart; the last one is the membrane (Vm)
     - the kit has no separate Leak board: a Passive Unit on the membrane node IS the leak (100 kΩ ∥ 1 µF);
       on the Base Board the same board is one segment of the cable; two on one node = 50 kΩ ∥ 2 µF
     - FI gets V+ through the stacked header only in its own stack; otherwise it needs the V+ Flywire
   HW3 (a synapse board on the table): Pre = the stack on its left side (Stimulator A on top),
     Post = the stack on its right side (active membrane 2, Stimulator B on top), or the Base Board right
     next to it (5 Passive Units; a Stimulator on it is Stimulator B). */
var SL = (function(){
  'use strict';
  var C = CIRCUITS, TU = C.TUNE, SPOTS = 12, NS = SPOTS;
  var ISRC = {key:'isrc', min:5e-6, max:150e-6, step:1e-6, unit:'A', en:'Current while SW is held. The kit pot gives about 44–100 µA.'};
  function tn(k){ return k === 'isrc' ? ISRC : TU[k]; }

  /* ---------- catalog ---------- */
  /* vers: grp KIT / IDEAL; my:true marks the version on our real board (MY BUILD) */
  var PARTS = {
    battery:{name:'9 V Battery', color:'#ff9f1c', kind:'dock', blurb:'Powers every board through the stacked header.',
      vers:[{id:'kit', grp:'KIT', label:'9 V', st:{vplus:9}, desc:'A nominal 9 V cell.'},
            {id:'mine', grp:'KIT', my:true, label:'8.44 V', st:{vplus:8.44}, desc:'Our cell: 8.44 V on the multimeter, 2026-10-21.'}]},
    stim:{name:'Stimulator', silk:'Neuron Stimulator', color:'#ff5a4f', kind:'board', blurb:'Current source. Hold SW to inject current; the pot sets how much. Always the top board.',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Kit', desc:'As built: Q_sense sits before SW, so it leaks ~6 µA while SW is released.'},
            {id:'add', grp:'IDEAL', label:'+22 kΩ', tune:['rxv'], desc:'22 kΩ clipped across Q_pass E–B: no leak, no trace cut.'},
            {id:'bb', grp:'IDEAL', label:'Breadboard', desc:'Rebuilt on a breadboard: Q_sense after SW, a 1N4148 at the output, its own 9 V.'},
            {id:'src', grp:'IDEAL', label:'Ideal source', tune:['isrc'], desc:'An ideal current source while SW is held (no leak, pot ignored).'}]},
    fi:{name:'Fast Inward', silk:'Fast Inward', color:'#ffd23f', kind:'board', blurb:'Na⁺-like: a regenerative inward current above threshold.',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Kit', desc:'R13 = 100 kΩ: too weak, the "AP" only reaches ~2 V.'},
            {id:'true', grp:'IDEAL', label:'True AP', tune:['r13p', 'rf'], desc:'A resistor across R13 and one from R13 to FI.E3: strong, with a real threshold.'},
            {id:'r13', grp:'IDEAL', label:'R13 1 kΩ', desc:'R13 swapped for the 1 kΩ the handout draws.'}]},
    so:{name:'Slow Out', silk:'Slow Out.', color:'#b98cff', kind:'board', blurb:'K⁺-like: a slow outward current that repolarizes.',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Kit', desc:'R2 = 1 MΩ (the TA’s part on every board).'},
            {id:'true', grp:'IDEAL', label:'True AP', tune:['rs'], desc:'A resistor across C1: Slow Out stays off at rest and opens during the AP.'}]},
    passive:{name:'Passive Unit', silk:'Passive Unit', color:'#3fe0c5', kind:'board', blurb:'1 µF ∥ 100 kΩ. On the Base Board it is a piece of cable (10 kΩ apart); stacked with FI and SO it is the membrane’s leak (LK).',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Kit', desc:'1 µF ∥ 100 kΩ.'},
            {id:'true', grp:'IDEAL', label:'True AP', tune:['rb', 'ru'], desc:'Adds a resistor to V+: as the leak it lifts rest above where Slow Out can pull (330 kΩ); in the cable it keeps every unit at the same level (560 kΩ).'}]},
    base:{name:'Base Board', silk:'Extracellular Solution', color:'#9fb4d9', kind:'base', span:5, blurb:'5 sockets: 10 kΩ (inside) and 100 Ω (outside) between neighbours. Its V+ pins are not connected.',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Kit', desc:'Used in #2-1, #2-3, #3-1 and #3-3.'}]},
    syne:{name:'Excitatory Synapse', silk:'Excitatory Synapse', color:'#ff8fa3', kind:'base', span:2, blurb:'Pre plugs into its left side, Post into its right side.',
      vers:[{id:'kit', grp:'KIT', label:'Kit', desc:'820 kΩ : 100 kΩ divider: with the kit Pre, Q2 never turns on.'},
            {id:'mine', grp:'KIT', my:true, label:'+100 kΩ', st:{r1p:1e5}, desc:'Our fix of 2026-10-21: 100 kΩ across the 820 kΩ. The EPSP saturates at ~6.5 V.'},
            {id:'true', grp:'IDEAL', label:'True synapse', tune:['r1p'], st:{r1p:1.5e6}, desc:'A resistor across the 820 kΩ, sized so the EPSP passes without saturating.'}]},
    syni:{name:'Inhibitory Synapse', silk:'Inhibitory Synapse', color:'#7fd1ff', kind:'base', span:2, blurb:'Pre on the left, Post on the right. Clip the 1.5 V cell on for an IPSP.',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Kit', desc:'Same input stage as the excitatory board; Q1 drives S through the 1.5 V cell.'},
            {id:'true', grp:'IDEAL', label:'True synapse', tune:['r1p'], st:{r1p:1.5e6}, desc:'A resistor across the 820 kΩ so the Pre AP can open the synapse.'}]},
    cell:{name:'1.5 V Cell', color:'#c7e86b', kind:'clip', blurb:'Clips onto the Inhibitory Synapse: sets the reversal potential.',
      vers:[{id:'kit', grp:'KIT', my:true, label:'1.5 V', desc:'Battery in: S is pulled towards about −1.4 V.'}]},
    jumper:{name:'Jumper', color:'#e0e0e0', kind:'clip', blurb:'Replaces the 1.5 V cell on the Inhibitory Synapse (HW3 #3-4 Q4).',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Wire', desc:'Battery removed, its two pins shorted.'}]},
    wire:{name:'V+ Flywire', color:'#ff6bb5', kind:'wire', blurb:'From the Stimulator V+ to Fast Inward. Base Boards do not carry V+!',
      vers:[{id:'kit', grp:'KIT', my:true, label:'Red wire', desc:'Pulls V+ over to the Fast Inward board.'}]}
  };
  var MEMB = {fi:1, so:1}, RC = {passive:1};

  /* ---------- assembly ---------- */
  var uid = 1;
  function empty(){ return {spots:Array.apply(null, Array(NS)).map(function(){ return {stack:[]}; }), bases:[], battery:null, wire:null, cell:null, jumper:null}; }
  function mk(type, ver){ return {id:uid++, type:type, ver:ver || defaultVer(type), tune:{}}; }
  function defaultVer(type){ var v = PARTS[type].vers.filter(function(x){ return x.my; })[0]; return (v || PARTS[type].vers[0]).id; }
  function verOf(p){ var V = PARTS[p.type].vers; return V.filter(function(v){ return v.id === p.ver; })[0] || V[0]; }
  function baseAt(A, i){
    for(var k = 0; k < A.bases.length; k++){ var b = A.bases[k], sp = PARTS[b.type].span; if(i >= b.at && i < b.at + sp) return {b:b, seg:i - b.at}; }
    return null;
  }
  function find(A, id){
    var keys = ['battery', 'wire', 'cell', 'jumper'];
    for(var k = 0; k < keys.length; k++) if(A[keys[k]] && A[keys[k]].id === id) return {p:A[keys[k]], where:keys[k]};
    for(var b = 0; b < A.bases.length; b++) if(A.bases[b].id === id) return {p:A.bases[b], where:'base', idx:b};
    for(var i = 0; i < NS; i++){ var j = A.spots[i].stack.findIndex(function(p){ return p.id === id; }); if(j >= 0) return {p:A.spots[i].stack[j], where:'stack', spot:i, idx:j}; }
    return null;
  }
  function all(A){
    var o = [];
    ['battery', 'wire', 'cell', 'jumper'].forEach(function(k){ if(A[k]) o.push(A[k]); });
    A.bases.forEach(function(b){ o.push(b); });
    A.spots.forEach(function(s){ s.stack.forEach(function(p){ o.push(p); }); });
    return o;
  }
  /* place a part; spot may be null (auto).  returns {ok, msg, id} */
  function place(A, type, ver, spot){
    var P = PARTS[type], p = mk(type, ver);
    if(P.kind === 'dock'){ A.battery = p; return {ok:true, id:p.id, msg:'Battery on the dock'}; }
    if(P.kind === 'wire'){ A.wire = p; return {ok:true, id:p.id, msg:'Flywire attached'}; }
    if(P.kind === 'clip'){
      if(!A.bases.some(function(b){ return b.type === 'syni'; })) return {ok:false, msg:'Clip it onto an Inhibitory Synapse'};
      A.cell = null; A.jumper = null; A[type] = p; return {ok:true, id:p.id, msg:P.name + ' clipped on'};
    }
    if(P.kind === 'base'){
      var span = P.span;
      if(spot === null || spot === undefined) spot = freeRun(A, span);
      if(spot === null || spot < 0 || spot + span > NS) return {ok:false, msg:'No room for the ' + P.name};
      for(var i = spot; i < spot + span; i++) if(baseAt(A, i) || A.spots[i].stack.length) return {ok:false, msg:'Clear ' + span + ' free spots first'};
      p.at = spot; A.bases.push(p); return {ok:true, id:p.id, msg:P.name + ' placed'};
    }
    if(spot === null || spot === undefined) spot = autoSpot(A, type);
    if(spot === null || spot < 0) return {ok:false, msg:'No free spot for that'};
    var st = A.spots[spot].stack;
    if(st.length >= 6) return {ok:false, msg:'That stack is full'};
    if(type === 'stim'){
      if(st.length && st[st.length - 1].type === 'stim') return {ok:false, msg:'That stack already has a Stimulator'};
      st.push(p);
    } else if(st.length && st[st.length - 1].type === 'stim') st.splice(st.length - 1, 0, p);   /* the Stimulator stays on top */
    else st.push(p);
    return {ok:true, id:p.id};
  }
  function freeRun(A, span){
    for(var i = 1; i + span <= NS; i++){
      var ok = true;
      for(var k = i; k < i + span; k++) if(baseAt(A, k) || A.spots[k].stack.length){ ok = false; break; }
      if(ok) return i;
    }
    return null;
  }
  function autoSpot(A, type){
    var stims = stimSpots(A), first = stims.length ? stims[0] : -1;
    if(type === 'stim'){
      /* on top of a membrane stack without a Stimulator, else the first occupied base socket, else a bare spot */
      for(var i = 0; i < NS; i++){ var s = A.spots[i].stack; if(s.length && s[s.length - 1].type !== 'stim' && s.some(function(p){ return MEMB[p.type]; })) return i; }
      for(i = 0; i < NS; i++) if(baseAt(A, i) && !A.spots[i].stack.some(function(p){ return p.type === 'stim'; })) return i;
      return bare(A);
    }
    if(MEMB[type] || type === 'passive'){   /* FI, SO, Passive Unit */
      if(first >= 0 && !baseAt(A, first)) return first;                      /* #2-2: under the Stimulator */
      var bb = A.bases.filter(function(b){ return b.type === 'base'; })[0];
      if(bb){ for(i = bb.at; i < bb.at + 5; i++){ var t = A.spots[i].stack; if(!t.length || (type !== 'passive' && t.some(function(p){ return MEMB[p.type]; }))) return i; } }
      if(first >= 0) return first;
      return bare(A);
    }
    return bare(A);
  }
  function bare(A){ for(var i = 1; i < NS; i++) if(!baseAt(A, i) && !A.spots[i].stack.length) return i; return null; }
  function stimSpots(A){ var o = []; A.spots.forEach(function(s, i){ if(s.stack.length && s.stack[s.stack.length - 1].type === 'stim') o.push(i); }); return o; }
  function remove(A, id){
    var f = find(A, id); if(!f) return;
    if(f.where === 'stack') A.spots[f.spot].stack.splice(f.idx, 1);
    else if(f.where === 'base'){
      var b = f.p, sp = PARTS[b.type].span;
      for(var i = b.at; i < b.at + sp; i++) A.spots[i].stack = [];       /* boards on it come off with it */
      A.bases.splice(f.idx, 1);
      if(b.type === 'syni' && !A.bases.some(function(x){ return x.type === 'syni'; })){ A.cell = null; A.jumper = null; }
    } else A[f.where] = null;
  }
  function move(A, id, d){
    var f = find(A, id); if(!f) return 'Not found';
    if(f.where === 'base'){
      var b = f.p, sp = PARTS[b.type].span, to = b.at + d;
      if(to < 0 || to + sp > NS) return 'End of the table';
      for(var i = to; i < to + sp; i++){ var o = baseAt(A, i); if(o && o.b !== b) return 'Something is in the way'; if(!o && A.spots[i].stack.length) return 'Something is in the way'; }
      var stacks = []; for(i = b.at; i < b.at + sp; i++){ stacks.push(A.spots[i].stack); A.spots[i].stack = []; }
      b.at = to; stacks.forEach(function(s, k){ A.spots[to + k].stack = s; }); return null;
    }
    if(f.where !== 'stack') return 'This part does not move';
    var dest = f.spot + d; if(dest < 0 || dest >= NS) return 'End of the table';
    A.spots[f.spot].stack.splice(f.idx, 1);
    var t = A.spots[dest].stack;
    if(f.p.type === 'stim' || !t.length || t[t.length - 1].type !== 'stim') t.push(f.p); else t.splice(t.length - 1, 0, f.p);
    return null;
  }

  /* ---------- versions -> engine values ---------- */
  function tv(p, key){ var v = p.tune && p.tune[key]; return v !== undefined ? v : DEF[key]; }
  var DEF = {rxv:22e3, r13p:11e3, rf:680e3, rs:56e3, rb:330e3, ru:560e3, r1p:1.5e6, isrc:50e-6};
  function stimSt(p){
    if(!p) return {qs:'sw', src:'stim'};
    if(p.ver === 'add') return {qs:'rx', rxv:tv(p, 'rxv'), src:'stim'};
    if(p.ver === 'bb') return {qs:'sw', stdiode:true, src:'stim'};
    if(p.ver === 'src') return {qs:'rx', rxv:22e3, src:'ideal', isrc:tv(p, 'isrc')};
    return {qs:'pcb', src:'stim'};
  }
  function memSt(boards, stim){
    var m = {so_r2:1e6, qs:stimSt(stim).qs === 'pcb' ? 'pcb' : 'rx', r13p:0, rf:0, rs:0, rb:0, nlk:1};
    /* HW3: every Passive Unit on the membrane stack is one more leak in parallel (2 = 50 kOhm || 2 uF) */
    m.nlk = Math.max(1, boards.filter(function(p){ return p.type === 'passive'; }).length);
    boards.forEach(function(p){
      if(p.type === 'passive' && p.ver === 'true') m.rb = tv(p, 'rb');
      if(p.type === 'fi' && p.ver === 'true'){ m.r13p = tv(p, 'r13p'); m.rf = tv(p, 'rf'); }
      if(p.type === 'so' && p.ver === 'true') m.rs = tv(p, 'rs');
    });
    return m;
  }

  /* ---------- the table -> a circuit ---------- */
  function analyze(A){
    var msgs = [], boardNode = {}, used = {}, R = {msgs:msgs, boardNode:boardNode, used:used};
    var vbat = A.battery ? (verOf(A.battery).st.vplus) : 0;
    if(!A.battery) msgs.push(['bad', 'No battery: nothing has power. Drop the 9 V Battery on the dock.']);
    var syn = A.bases.filter(function(b){ return b.type === 'syne' || b.type === 'syni'; })[0];
    if(syn) return analyze3(A, syn, vbat, R);
    return analyze2(A, vbat, R);
  }
  function mark(R, list, node){ list.forEach(function(p){ R.used[p.id] = true; R.boardNode[p.id] = p.type === 'so' ? (node === 'Vm' ? 'SO.S' : node) : node; }); }

  function analyze2(A, vbat, R){
    var msgs = R.msgs, st = {vplus:vbat, chain:0, leak:false, lk2:false, fi_on:false, so_on:false, fi_supply:'stim', stdiode:false,
      r13:1e5, rfe:1e5, so_r2:1e6, r13p:0, rf:0, rs:0, rb:0, rl:0, ru:0, src:'stim', isrc:50e-6, qs:'pcb', rxv:22e3};
    R.hw = 2; R.st = st;
    var S = stimSpots(A);
    if(!S.length){ msgs.push(['bad', 'No Stimulator on top of a stack: nothing injects current.']); Object.assign(st, {qs:'sw'}); R.nodes = ['Vm']; R.ok = false; return R; }
    if(S.length > 1) msgs.push(['tip', 'Two Stimulators only make sense with a synapse board (HW3). Using the left one.']);
    var s0 = S[0], stim = A.spots[s0].stack[A.spots[s0].stack.length - 1];
    Object.assign(st, stimSt(stim)); R.used[stim.id] = true;
    if(stim.ver === 'bb') st.vplus = vbat ? 9 : 0;
    var own = A.spots[s0].stack.slice(0, -1), nodes = [], base = baseAt(A, s0), viaHeader = false;
    if(own.some(function(p){ return MEMB[p.type]; }) || !base){
      if(own.length) nodes.push(own);
      viaHeader = true;
      if(base) msgs.push(['tip', 'Membrane boards under the Stimulator: the Base Board is not used (#2-2 style).']);
    } else {
      var dir = (A.spots[s0 + 1] && baseAt(A, s0 + 1) && baseAt(A, s0 + 1).b === base.b && A.spots[s0 + 1].stack.length) ? 1
              : (A.spots[s0 - 1] && baseAt(A, s0 - 1) && baseAt(A, s0 - 1).b === base.b && A.spots[s0 - 1].stack.length) ? -1 : 1;
      if(own.length) nodes.push(own);
      for(var k = s0 + dir; k >= 0 && k < NS; k += dir){
        var o = baseAt(A, k); if(!o || o.b !== base.b) break;
        var t = A.spots[k].stack;
        if(!t.length){
          var more = false; for(var q = k + dir; q >= 0 && q < NS; q += dir){ var oo = baseAt(A, q); if(!oo || oo.b !== base.b) break; if(A.spots[q].stack.length) more = true; }
          if(more) msgs.push(['bad', 'Empty socket in the middle of the Base Board: the cable stops there.']);
          break;
        }
        if(t.some(function(p){ return p.type === 'stim'; })) break;
        nodes.push(t);
      }
    }
    if(!nodes.length){ msgs.push(['tip', 'Stack a Passive Unit (the leak), Fast Inward and Slow Out under the Stimulator (#2-2), or put Passive Units on a Base Board next to it (#2-1, #2-3).']); R.nodes = ['Vm']; R.ok = false; mark(R, [stim], 'Vm'); return R; }
    var vm = nodes[nodes.length - 1], n = nodes.length - 1;
    st.chain = n;
    nodes.slice(0, -1).forEach(function(t, i){
      mark(R, t.filter(function(p){ return RC[p.type]; }), 'PC' + (i + 1));
      if(t.some(function(p){ return p.type === 'fi' || p.type === 'so'; })) msgs.push(['tip', 'FI / SO only act on the last board group of the cable; the ones in the middle are ignored.']);
      if(t.filter(function(p){ return RC[p.type]; }).length > 1) msgs.push(['tip', 'Two Passive Units on one socket act as one (the model keeps one per socket).']);
    });
    var rcs = vm.filter(function(p){ return RC[p.type]; }), fi = vm.filter(function(p){ return p.type === 'fi'; })[0], so = vm.filter(function(p){ return p.type === 'so'; })[0];
    st.leak = rcs.length >= 1; st.lk2 = rcs.length >= 2;
    if(rcs.length > 2) msgs.push(['tip', 'More than two Passive Units on the membrane: the model keeps two.']);
    if(!rcs.length && (fi || so)) msgs.push(['tip', 'No leak: add a Passive Unit to the membrane stack (in the kit the leak is a Passive Unit).']);
    st.fi_on = !!fi; st.so_on = !!so;
    var m = memSt(vm, stim); st.rb = m.rb; st.r13p = m.r13p; st.rf = m.rf; st.rs = m.rs;
    if(fi && fi.ver === 'r13') st.r13 = 1e3;
    var pas = [].concat.apply([], nodes.slice(0, -1)).filter(function(p){ return p.type === 'passive' && p.ver === 'true'; });
    if(pas.length) st.ru = tv(pas[0], 'ru');
    st.fi_supply = (viaHeader && n === 0) ? 'stim' : (A.wire ? 'stim' : 'none');
    if(fi && st.fi_supply === 'none') msgs.push(['bad', 'Fast Inward has no V+! The Base Board does not carry it. Drop the V+ Flywire.']);
    if(A.wire && st.fi_supply === 'stim' && viaHeader && n === 0) msgs.push(['tip', 'Flywire not needed here: the stacked header already carries V+.']);
    mark(R, rcs.concat(fi ? [fi] : []), 'Vm'); if(so) mark(R, [so], 'Vm');
    R.boardNode[stim.id] = n ? 'PC1' : 'Vm';
    var nodesList = ['Vm']; for(var c = 1; c <= n; c++) nodesList.push('PC' + c); if(fi) nodesList.push('FI.E4'); if(so) nodesList.push('SO.S');
    R.nodes = nodesList; R.n = n; R.mem = {lk:rcs.length, fi:!!fi, so:!!so}; R.ok = true;
    var label = (n ? n + ' × Passive → ' : '') + '[' + vm.map(function(p){ return ({fi:'FI', so:'SO', passive:'LK'})[p.type]; }).join(' ') + ']';
    msgs.unshift([msgs.some(function(x){ return x[0] === 'bad'; }) ? 'tip' : 'ok', 'Stimulator → ' + label + (vbat ? ' · ' + st.vplus + ' V' : '')]);
    R.sig = {hw:2, n:n, lk:rcs.length, fi:!!fi, so:!!so, wire:st.fi_supply === 'stim'};
    return R;
  }

  function analyze3(A, syn, vbat, R){
    var msgs = R.msgs, p = syn.at, pre = A.spots[p].stack, post = A.spots[p + 1].stack;
    R.hw = 3; R.used[syn.id] = true;
    var stimA = pre.length && pre[pre.length - 1].type === 'stim' ? pre[pre.length - 1] : null;
    var MEM3 = {passive:1, fi:1, so:1}, preM = pre.filter(function(x){ return MEM3[x.type]; });
    var st = {vplus:vbat, syn:syn.type === 'syne' ? 'exc' : 'inh', r1p:0, r13A:0, r6:0, vsyn:0, stimA:!!stimA, stimB:false,
              post:'passive', pre:'cusA', postMem:'cusB', bat:A.cell ? 'on' : A.jumper ? 'short' : 'open', rxv:22e3, ch1:'A.Vm', ch2:'P1'};
    R.st = st;
    if(!stimA) msgs.push(['bad', 'Put Stimulator A on top of the Pre stack (left side of the synapse).']);
    var NM = {passive:'Passive Unit (leak)', fi:'Fast Inward', so:'Slow Out'};
    var need = ['passive', 'fi', 'so'].filter(function(t){ return !preM.some(function(x){ return x.type === t; }); });
    if(need.length) msgs.push(['tip', 'The HW3 model always has a full Pre membrane (Passive Unit as leak + FI + SO); missing here: ' + need.map(function(t){ return NM[t]; }).join(', ') + '.']);
    var sv = verOf(syn); if(syn.ver !== 'kit') st.r1p = syn.ver === 'true' ? tv(syn, 'r1p') : sv.st.r1p;
    if(A.wire) msgs.push(['tip', 'HW3 does not use the V+ Flywire: every membrane gets V+ through its own stack. Tap the red wire, then REMOVE.']);
    if(st.syn === 'inh' && st.bat === 'open') msgs.push(['tip', 'No 1.5 V cell (or jumper) on the Inhibitory Synapse: the synapse is open.']);
    var fiA = preM.filter(function(x){ return x.type === 'fi'; })[0];
    if(fiA && fiA.ver === 'r13') st.r13A = 1e3;
    R.memA = memSt(preM, stimA); if(stimA && stimA.ver === 'add') st.rxv = tv(stimA, 'rxv');
    mark(R, preM.concat(stimA ? [stimA] : []), 'A.Vm'); preM.forEach(function(x){ if(x.type === 'so') R.boardNode[x.id] = 'A.SO.S'; });
    R.boardNode[syn.id] = 'SY.S';
    var postM = post.filter(function(x){ return MEM3[x.type]; }), stimB = post.length && post[post.length - 1].type === 'stim' ? post[post.length - 1] : null;
    var nodes = ['A.Vm', 'SY.S'];
    if(postM.some(function(x){ return MEMB[x.type]; })){
      st.post = 'active'; st.stimB = !!stimB; st.ch2 = 'B.Vm';
      R.memB = memSt(postM, stimB);
      mark(R, postM.concat(stimB ? [stimB] : []), 'B.Vm'); postM.forEach(function(x){ if(x.type === 'so') R.boardNode[x.id] = 'B.SO.S'; });
      nodes.push('B.Vm');
      var needB = ['passive', 'fi', 'so'].filter(function(t){ return !postM.some(function(x){ return x.type === t; }); });
      if(needB.length) msgs.push(['tip', 'The HW3 model always has a full Post membrane (Passive Unit as leak + FI + SO); missing: ' + needB.map(function(t){ return NM[t]; }).join(', ') + '.']);
      R.sig = {hw:3, syn:st.syn, post:'active', bat:st.bat};
    } else {
      var bb = baseAt(A, p + 2), units = 0, sB = null;
      if(bb && bb.b.type === 'base' && bb.seg === 0){
        for(var k = 0; k < 5; k++){
          var t = A.spots[bb.b.at + k].stack; if(!t.length) break;
          var pu = t.filter(function(x){ return x.type === 'passive'; });
          if(pu.length){ units++; mark(R, pu, 'P' + Math.min(units, 5)); }
          if(t[t.length - 1].type === 'stim' && !sB){ sB = t[t.length - 1]; R.used[sB.id] = true; R.boardNode[sB.id] = 'P1'; }
        }
        R.used[bb.b.id] = true;
      }
      if(post.length && !postM.some(function(x){ return MEMB[x.type]; })) msgs.push(['tip', 'Only a membrane stack works on the Post side; for #3-1 / #3-3 put the Base Board right of the synapse.']);
      if(!units) msgs.push(['bad', 'Nothing on the Post side: put a Base Board with Passive Units right of the synapse, or an active membrane on its right side.']);
      else if(units !== 5) msgs.push(['tip', 'The HW3 model always has 5 Passive Units after the synapse (you have ' + units + ').']);
      st.post = 'passive'; st.stimB = !!sB;
      if(sB) R.memB = memSt([], sB);
      for(var u = 1; u <= 5; u++) nodes.push('P' + u);
      R.sig = {hw:3, syn:st.syn, post:'passive', units:units, bat:st.bat};
    }
    R.nodes = nodes; R.ok = !!stimA;
    msgs.unshift([msgs.some(function(x){ return x[0] === 'bad'; }) ? 'tip' : 'ok',
      'Pre → ' + (st.syn === 'exc' ? 'excitatory' : 'inhibitory') + ' synapse → ' + (st.post === 'active' ? 'active Post' : '5 × Passive') + (vbat ? ' · ' + vbat + ' V' : '')]);
    return R;
  }

  /* ---------- circuit types -> board versions ---------- */
  /* engine values of a circuits.js type (st) turned into versions + tune values for the boards on the table */
  function applySt(A, cst){
    var preSide = null, R0 = analyze(A), role = function(p){ var n = R0.boardNode[p.id]; return n === 'Vm' || n === 'A.Vm' || n === 'B.Vm' ? 'mem' : 'cable'; };
    var syn = A.bases.filter(function(b){ return b.type === 'syne' || b.type === 'syni'; })[0];
    if(syn) preSide = syn.at;
    all(A).forEach(function(p){
      var f = find(A, p.id), onPre = f && f.where === 'stack' && f.spot === preSide, hw3 = !!syn;
      var trueMem = hw3 ? (onPre ? cst.pre === 'true' : cst.postMem === 'true') : null;
      p.tune = {};
      switch(p.type){
        case 'stim':
          if(hw3) p.ver = trueMem ? 'add' : 'kit';
          else p.ver = cst.stdiode ? 'bb' : cst.qs === 'rx' ? 'add' : 'kit';
          if(p.ver === 'add' && cst.rxv) p.tune.rxv = cst.rxv;
          break;
        case 'fi':
          if(hw3) p.ver = trueMem ? 'true' : (onPre && cst.r13A ? 'r13' : 'kit');
          else p.ver = cst.r13p ? 'true' : cst.r13 === 1e3 ? 'r13' : 'kit';
          break;
        case 'so': p.ver = hw3 ? (trueMem ? 'true' : 'kit') : (cst.rs ? 'true' : 'kit'); break;
        case 'passive':
          if(role(p) === 'mem'){ p.ver = hw3 ? (trueMem ? 'true' : 'kit') : (cst.rb ? 'true' : 'kit'); if(!hw3 && cst.rb) p.tune.rb = cst.rb; }
          else { p.ver = !hw3 && cst.ru ? 'true' : 'kit'; if(!hw3 && cst.ru) p.tune.ru = cst.ru; }
          break;
        case 'syne': case 'syni':
          p.ver = !cst.r1p ? 'kit' : cst.r1p === 1e5 && p.type === 'syne' ? 'mine' : 'true';
          if(p.ver === 'true') p.tune.r1p = cst.r1p;
          break;
        case 'battery': p.ver = 'mine'; break;
      }
    });
  }
  function typeSt(cid, type, idealId){
    var c = C[cid]; if(type === 'kit') return c.kit.st; if(type === 'mine') return c.mine.st;
    var I = c.ideal.filter(function(i){ return idealId ? i.id === idealId : i.def; })[0] || c.ideal[c.ideal.length - 1];
    return I.st;
  }

  /* ---------- canonical builds of every homework circuit ---------- */
  function build(cid, opts){
    opts = opts || {};
    var A = empty(), n = opts.n === undefined ? 4 : opts.n;
    function put(type, spot){ var r = place(A, type, null, spot); return r.id; }
    A.battery = mk('battery', 'mine');
    function membraneOn(spot, stim){ put('so', spot); put('fi', spot); put('passive', spot); if(stim) put('stim', spot); }
    if(cid === 'c22' || (cid === 'c23' && n === 0)){ membraneOn(2, true); if(cid === 'c23') A.wire = mk('wire'); }
    else if(cid === 'c21' || cid === 'c23'){
      place(A, 'base', null, 1);
      if(cid === 'c21'){ put('passive', 1); put('stim', 1); for(var i = 2; i <= 5; i++) put('passive', i); }
      else {
        put('passive', 1); put('stim', 1);
        for(i = 2; i <= n; i++) put('passive', i);
        membraneOn(n + 1, false); A.wire = mk('wire');
      }
    } else {
      var exc = cid === 'c31' || cid === 'c32', active = cid === 'c32' || cid === 'c34';
      place(A, exc ? 'syne' : 'syni', null, 1);
      membraneOn(1, true);
      if(!exc) A.cell = mk('cell');
      if(active) membraneOn(2, true);
      else { place(A, 'base', null, 3); for(i = 3; i <= 7; i++) put('passive', i); put('stim', 3); }
    }
    return A;
  }

  return {PARTS:PARTS, SPOTS:NS, tn:tn, DEF:DEF, empty:empty, mk:mk, verOf:verOf, baseAt:baseAt, find:find, all:all, place:place, remove:remove, move:move,
          stimSpots:stimSpots, analyze:analyze, applySt:applySt, typeSt:typeSt, build:build, MEMB:MEMB};
})();
