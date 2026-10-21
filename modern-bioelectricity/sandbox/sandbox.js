/* Sandbox! — build HW2 kit circuits from boards, view them in 3D or as a schematic, probe them with a scope.
   The circuit is the same engine as the HW2 bench (../active-membrane-sim/engine.js, global AM) and the
   same schematic (../active-membrane-sim/schematic.js, global MembraneSchematic).

   Assembly rules (how the boards connect):
   - The bench has 6 slots.  Boards dropped on a slot stack on top of each other (stacked headers).
   - The slot with the Stimulator is the start.  Leak / Fast Inward / Slow Out boards stacked on the Stimulator
     form the active membrane right there (HW2 #2-2).  Otherwise the slots to the right, touching each other,
     carry Passive Units until the first slot with membrane boards (HW2 #2-1 / #2-3).
   - An empty slot breaks the chain.  The battery sits on the dock.  Passive bases do not carry V+, so with
     Passive Units in between, FI only gets V+ through the V+ Flywire. */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const DT = 2e-4, NSLOT = 6, MAXSTACK = 4;
const MEMB = {leak:1, fi:1, so:1};

/* ---------------------------------------------------------------- parts catalog */
const PARTS = {
  battery:{name:'Battery', color:'#ff9f1c', blurb:'Powers every board through the stacked header.', where:'dock',
    vers:[{id:'7.8', label:'7.8 V', desc:'HW2 bench default (another group\'s board).', st:{vplus:7.8}},
          {id:'8.44', label:'8.44 V', desc:'Our multimeter reading on 2026-10-21.', st:{vplus:8.44}},
          {id:'9', label:'9 V', desc:'A fresh 9 V battery.', st:{vplus:9}}]},
  stim:{name:'Stimulator', color:'#ff5a4f', blurb:'Current source. Hold SW to inject current; the pot sets how much.',
    vers:[{id:'kit', label:'KIT', desc:'As built: Q_sense sits before SW, so it leaks about 6 µA when SW is released.', st:{qs:'pcb', src:'stim'}},
          {id:'fix', label:'+22 kΩ', desc:'22 kΩ clipped across Q_pass E–B: the leak is gone. Add-on only, no trace cutting.', st:{qs:'rx', src:'stim'}, mod:1},
          {id:'ideal', label:'IDEAL', desc:'An ideal 50 µA source while SW is held (no leak, pot ignored).', st:{qs:'rx', src:'ideal', isrc:50e-6}, mod:1}]},
  leak:{name:'Leak (LK)', color:'#4ea8ff', blurb:'Membrane R and C: 100 kΩ ∥ 1 µF, τ = 100 ms.',
    vers:[{id:'kit', label:'KIT', desc:'100 kΩ ∥ 1 µF. Stack two for 50 kΩ ∥ 2 µF.', st:{}},
          {id:'true', label:'TRUE AP', desc:'Adds 330 kΩ from V+ to Vm: rest ≈ 1.19 V, above what Slow Out can pull to.', st:{rb:330e3}, mod:1}]},
  fi:{name:'Fast Inward (FI)', color:'#ffd23f', blurb:'Na⁺-like: a regenerative inward current above threshold.',
    vers:[{id:'kit', label:'KIT', desc:'R13 = 100 kΩ: too weak, the "AP" only reaches about 2 V.', st:{}},
          {id:'true', label:'TRUE AP', desc:'11 kΩ across R13 + 680 kΩ to FI.E3: strong, threshold ≈ 1.66 V.', st:{r13p:11e3, rf:680e3}, mod:1},
          {id:'r13', label:'R13 1 kΩ', desc:'R13 swapped for 1 kΩ (the handout value).', st:{r13:1e3}, mod:1}]},
  so:{name:'Slow Out (SO)', color:'#b98cff', blurb:'K⁺-like: a slow outward current that repolarizes.',
    vers:[{id:'kit', label:'KIT', desc:'R2 = 1 MΩ (the TA\'s part on every board).', st:{}},
          {id:'true', label:'TRUE AP', desc:'56 kΩ across C1: Slow Out stays off at rest and opens during the AP.', st:{rs:56e3}, mod:1}]},
  passive:{name:'Passive Unit', color:'#3fe0c5', blurb:'A patch of passive cable: 1 µF ∥ 100 kΩ, 10 kΩ to the next one.',
    vers:[{id:'kit', label:'KIT', desc:'1 µF ∥ 100 kΩ.', st:{}},
          {id:'true', label:'TRUE AP', desc:'Adds 560 kΩ to V+ so every unit rests at the same level.', st:{ru:560e3}, mod:1}]},
  wire:{name:'V+ Flywire', color:'#ff6bb5', blurb:'A jumper from the Stimulator V+ to FI. Passive bases do not carry V+!', where:'wire',
    vers:[{id:'red', label:'RED WIRE', desc:'Pulls V+ over to the Fast Inward board.', st:{}}]}
};
const ICON = {
  battery:'<rect x="10" y="12" width="28" height="30" rx="4" fill="#2b2b2b" stroke="#0a111d" stroke-width="3"/><rect x="10" y="22" width="28" height="9" fill="#ffcf3f"/><rect x="15" y="6" width="7" height="7" fill="#c9c9c9" stroke="#0a111d" stroke-width="2"/><rect x="27" y="6" width="7" height="7" fill="#c9c9c9" stroke="#0a111d" stroke-width="2"/>',
  stim:'<rect x="5" y="9" width="38" height="30" rx="4" fill="#1f7a3a" stroke="#0a111d" stroke-width="3"/><circle cx="17" cy="24" r="7" fill="#ff5a4f" stroke="#0a111d" stroke-width="3"/><rect x="28" y="17" width="10" height="13" fill="#3b6fe0" stroke="#0a111d" stroke-width="2"/>',
  leak:'<rect x="5" y="9" width="38" height="30" rx="4" fill="#1f7a3a" stroke="#0a111d" stroke-width="3"/><rect x="12" y="15" width="10" height="18" fill="#ffd23f" stroke="#0a111d" stroke-width="2"/><rect x="28" y="20" width="10" height="8" rx="3" fill="#e8d3a8" stroke="#0a111d" stroke-width="2"/>',
  fi:'<rect x="5" y="9" width="38" height="30" rx="4" fill="#1f7a3a" stroke="#0a111d" stroke-width="3"/><path d="M24 14v16m-6-6 6 6 6-6" stroke="#ffd23f" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  so:'<rect x="5" y="9" width="38" height="30" rx="4" fill="#1f7a3a" stroke="#0a111d" stroke-width="3"/><path d="M24 34V18m-6 6 6-6 6 6" stroke="#b98cff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  passive:'<rect x="5" y="9" width="38" height="30" rx="4" fill="#1f7a3a" stroke="#0a111d" stroke-width="3"/><circle cx="17" cy="24" r="7" fill="#3b6fe0" stroke="#0a111d" stroke-width="2"/><rect x="28" y="20" width="10" height="8" rx="3" fill="#e8d3a8" stroke="#0a111d" stroke-width="2"/>',
  wire:'<path d="M8 38C8 14 40 34 40 10" stroke="#0a111d" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M8 38C8 14 40 34 40 10" stroke="#ff5a4f" stroke-width="4" fill="none" stroke-linecap="round"/>'
};
const BLUEPRINTS = [
  {id:'22true', name:'#2-2 · True AP', bat:'8.44', slots:[[['stim', 'fix'], ['leak', 'true'], ['fi', 'true'], ['so', 'true']]]},
  {id:'22kit', name:'#2-2 · Kit membrane', bat:'8.44', slots:[[['stim', 'kit'], ['leak', 'kit'], ['fi', 'kit'], ['so', 'kit']]]},
  {id:'21', name:'#2-1 · Passive cable', bat:'8.44', slots:[[['stim', 'kit']], [['passive', 'kit']], [['passive', 'kit']], [['passive', 'kit']], [['passive', 'kit']], [['leak', 'kit']]]},
  {id:'23kit', name:'#2-3 · n = 2, flywire', bat:'8.44', wire:true, slots:[[['stim', 'kit']], [['passive', 'kit']], [['passive', 'kit']], [['leak', 'kit'], ['fi', 'kit'], ['so', 'kit']]]},
  {id:'23true', name:'#2-3 · n = 2, True AP', bat:'8.44', wire:true, slots:[[['stim', 'fix']], [['passive', 'true']], [['passive', 'true']], [['leak', 'true'], ['fi', 'true'], ['so', 'true']]]},
  {id:'empty', name:'Empty bench', bat:null, slots:[]}
];
/* engine defaults: the boards as built (hw2-lab BASE_ST), x1 probe 1 Mohm */
const BASE = {vplus:8.44, rpot:700, r13:1e5, rfe:1e5, qs:'pcb', so_r2:1e6, rprobe:1e6, ch1:'Vm', ch2:'',
  r13p:0, rf:0, rb:0, rs:0, rl:0, ru:0, chain:0, src:'stim', isrc:50e-6, fi_supply:'stim',
  leak:true, fi_vm:true, fi_vplus:true, fi_gnd:true, so_vm:true, so_gnd:true, fi_on:true, so_on:true, lk2:false, leak2:true, stdiode:false};

/* ---------------------------------------------------------------- assembly state */
let uid = 1;
const A = {slots:Array.from({length:NSLOT}, () => []), battery:null, wire:null};
const pick = {};                                    /* version chosen in the drawer, per part type */
Object.keys(PARTS).forEach(t => pick[t] = PARTS[t].vers[t === 'battery' ? 1 : 0].id);
const mk = (type, ver) => ({id:uid++, type, ver:ver || pick[type]});
const verOf = p => PARTS[p.type].vers.find(v => v.id === p.ver) || PARTS[p.type].vers[0];
const fresh = new Set();                            /* ids that just arrived: drop-in animation */
let POWER = true, swDown = false, pulseEnd = null, rpot = 700, selId = null;
let CUR = null;                                     /* interpretation of the assembly */
let probe = ['Vm', 'SO.S'];

function findPart(id){
  if(A.battery && A.battery.id === id) return {p:A.battery, where:'dock'};
  if(A.wire && A.wire.id === id) return {p:A.wire, where:'wire'};
  for(let i = 0; i < NSLOT; i++){ const j = A.slots[i].findIndex(p => p.id === id); if(j >= 0) return {p:A.slots[i][j], where:'slot', slot:i, idx:j}; }
  return null;
}
const stimSlot = () => A.slots.findIndex(s => s.some(p => p.type === 'stim'));

function autoSlot(type){
  const S = stimSlot(), empty = i => !A.slots[i].length;
  if(type === 'stim'){ for(let i = 0; i < NSLOT; i++) if(empty(i)) return i; return -1; }
  if(S < 0){ for(let i = 0; i < NSLOT; i++) if(empty(i)) return i; return -1; }
  let j = S + 1; while(j < NSLOT && A.slots[j].length && !A.slots[j].some(p => MEMB[p.type])) j++;
  const M = A.slots[S].some(p => MEMB[p.type]) ? S : (j < NSLOT && A.slots[j].some(p => MEMB[p.type]) ? j : -1);
  if(MEMB[type]){
    if(M >= 0) return M;
    return j === S + 1 ? S : (j < NSLOT ? j : -1);  /* nothing in between: stack on the Stimulator (#2-2) */
  }
  if(type === 'passive'){
    if(M === S){ return -2; }                       /* would have to unstack the membrane: let the player do it */
    if(M > S){                                      /* shift the membrane right by one slot */
      if(A.slots[NSLOT - 1].length && NSLOT - 1 !== M) return -1;
      if(M === NSLOT - 1) return -1;
      for(let i = NSLOT - 1; i > M; i--) A.slots[i] = A.slots[i - 1];
      A.slots[M] = []; return M;
    }
    return j < NSLOT ? j : -1;
  }
  return -1;
}
function place(type, ver, slot){
  const P = PARTS[type];
  if(P.where === 'dock'){ A.battery = mk(type, ver); fresh.add(A.battery.id); toast('Battery ' + verOf(A.battery).label + ' on the dock'); return changed(); }
  if(P.where === 'wire'){ A.wire = mk(type, ver); fresh.add(A.wire.id); toast('Flywire attached'); return changed(); }
  if(type === 'stim' && stimSlot() >= 0 && !(slot >= 0 && A.slots[slot].some(p => p.type === 'stim'))){ toast('One Stimulator per bench (this prototype)'); return; }
  if(slot === undefined || slot === null) slot = autoSlot(type);
  if(slot === -2){ toast('Unstack the membrane from the Stimulator first'); return; }
  if(slot < 0){ toast('No free slot for that'); return; }
  if(A.slots[slot].length >= MAXSTACK){ toast('Stack is full (' + MAXSTACK + ' boards)'); return; }
  if(type === 'stim' && A.slots[slot].length){ toast('The Stimulator goes at the bottom of a stack'); A.slots[slot].unshift(mk(type, ver)); }
  else A.slots[slot].push(mk(type, ver));
  fresh.add(A.slots[slot][type === 'stim' ? 0 : A.slots[slot].length - 1].id);
  changed();
}
function removePart(id){
  const f = findPart(id); if(!f) return;
  if(f.where === 'dock') A.battery = null; else if(f.where === 'wire') A.wire = null; else A.slots[f.slot].splice(f.idx, 1);
  if(selId === id) select(null);
  changed();
}
function movePart(id, d){
  const f = findPart(id); if(!f || f.where !== 'slot') return;
  const to = f.slot + d; if(to < 0 || to >= NSLOT){ toast('End of the bench'); return; }
  if(A.slots[to].length >= MAXSTACK){ toast('That stack is full'); return; }
  A.slots[f.slot].splice(f.idx, 1);
  if(f.p.type === 'stim') A.slots[to].unshift(f.p); else A.slots[to].push(f.p);
  fresh.add(id); changed();
}
function loadBlueprint(id){
  const b = BLUEPRINTS.find(x => x.id === id); if(!b) return;
  A.slots = Array.from({length:NSLOT}, (_, i) => (b.slots[i] || []).map(([t, v]) => { const p = mk(t, v); fresh.add(p.id); return p; }));
  A.battery = b.bat ? mk('battery', b.bat) : null; if(A.battery) fresh.add(A.battery.id);
  A.wire = b.wire ? mk('wire', 'red') : null;
  select(null); changed(true); toast(b.name);
}

/* ---------------------------------------------------------------- assembly -> circuit */
function interpret(){
  const st = Object.assign({}, BASE), msgs = [], used = new Set();
  const S = stimSlot();
  let M = -1, n = 0, gap = -1, passVers = [];
  const units = [];                                 /* passive unit part ids in chain order (PC1..PCn) */
  if(S >= 0){
    A.slots[S].forEach(p => { if(p.type === 'stim' || MEMB[p.type]) used.add(p.id); });
    if(A.slots[S].some(p => MEMB[p.type])) M = S;
    else for(let j = S + 1; j < NSLOT; j++){
      const sl = A.slots[j];
      if(!sl.length){ if(A.slots.slice(j + 1).some(s => s.length)) gap = j; break; }
      if(sl.some(p => MEMB[p.type])){ M = j; sl.forEach(p => { if(MEMB[p.type]) used.add(p.id); }); break; }
      sl.forEach(p => { if(p.type === 'passive'){ used.add(p.id); n++; passVers.push(p.ver); units.push(p.id); } });
    }
  }
  const mem = M >= 0 ? A.slots[M].filter(p => MEMB[p.type]) : [];
  const lk = mem.filter(p => p.type === 'leak'), fi = mem.find(p => p.type === 'fi'), so = mem.find(p => p.type === 'so');
  const stim = S >= 0 ? A.slots[S].find(p => p.type === 'stim') : null;
  if(stim) Object.assign(st, verOf(stim).st); else Object.assign(st, {qs:'sw', src:'stim'});
  st.vplus = A.battery ? verOf(A.battery).st.vplus : 0;
  st.chain = n;
  st.leak = lk.length >= 1; st.lk2 = lk.length >= 2;
  lk.forEach(p => Object.assign(st, verOf(p).st));
  st.fi_on = !!fi; if(fi) Object.assign(st, verOf(fi).st);
  st.so_on = !!so; if(so) Object.assign(st, verOf(so).st);
  if(passVers.includes('true')) st.ru = 560e3;
  st.fi_supply = n === 0 ? 'stim' : (A.wire ? 'stim' : 'none');
  st.rpot = rpot;

  /* messages, worst first */
  if(!A.battery) msgs.push(['bad', '⚡', 'No battery: nothing has power. Drop a Battery on the dock.']);
  if(S < 0) msgs.push(['bad', '!', 'No Stimulator: nothing injects current.']);
  if(gap >= 0) msgs.push(['bad', '!', 'Gap at slot ' + (gap + 1) + ': boards must touch to connect.']);
  if(fi && n >= 1 && !A.wire) msgs.push(['bad', '⚡', 'FI has no V+! Passive bases don\'t carry it. Drop a V+ Flywire.']);
  if(A.wire && (n === 0 || !fi)) msgs.push(['tip', 'i', n === 0 ? 'Flywire not needed: the stacked header already carries V+ to FI.' : 'The flywire has no FI board to feed.']);
  if(S >= 0 && M < 0 && !n) msgs.push(['tip', 'i', 'Stack Leak / FI / SO on the Stimulator (#2-2), or chain Passive Units first (#2-1, #2-3).']);
  const loose = [];
  A.slots.forEach(s => s.forEach(p => { if(!used.has(p.id)) loose.push(p); }));
  if(loose.length) msgs.push(['tip', 'i', loose.length + ' board' + (loose.length > 1 ? 's' : '') + ' not connected: ' + loose.map(p => PARTS[p.type].name).join(', ') + '.']);
  if(stim && stim.ver === 'kit') msgs.push(['tip', 'i', 'Kit Stimulator leaks ~6 µA while SW is released.']);
  if(S >= 0){
    const m = mem.length ? '[' + mem.map(p => ({leak:'LK', fi:'FI', so:'SO'})[p.type]).join(' + ') + ']' : 'nothing';
    const bad = msgs.some(x => x[0] === 'bad');
    msgs.unshift([bad ? 'tip' : 'ok', bad ? '…' : '✔', 'Stimulator → ' + (n ? n + ' × Passive → ' : '') + m + (A.battery ? ' · ' + st.vplus + ' V' : '')]);
  }
  /* nodes worth probing */
  const nodes = ['Vm'];
  for(let k = 1; k <= n; k++) nodes.push('PC' + k);
  if(fi) nodes.push('FI.E4', 'FI.E3');
  if(so) nodes.push('SO.S');
  if(stim) nodes.push('ST.R');
  return {st, msgs, S, M, n, units, hasStim:!!stim, used, nodes, mem};
}

/* ---------------------------------------------------------------- engine */
function applyEngine(replug){
  const st = CUR.st;
  for(const k in st) AM.st[k] = st[k];
  if(!CUR.nodes.includes(probe[0])) probe[0] = 'Vm';
  if(probe[1] && !CUR.nodes.includes(probe[1])) probe[1] = CUR.n ? 'PC1' : CUR.nodes.includes('SO.S') ? 'SO.S' : '';
  AM.st.ch1 = probe[0]; AM.st.ch2 = probe[1];
  AM.st.vplus = POWER ? st.vplus : 0;
  AM.st.sw = swDown && CUR.hasStim;
  AM.build();
  if(replug) AM.powerOn();
}
function setSW(on){
  if(on && !CUR.hasStim){ toast('Add a Stimulator first'); return; }
  swDown = on; AM.st.sw = on && CUR.hasStim; AM.build();
  $('#swbig').classList.toggle('down', on);
  if(SWMESH) SWMESH.position.y = SWMESH.userData.y0 - (on ? 0.05 : 0);
  if(SCH) syncSchema();
}
function pressFor(T){ setSW(true); if(swDown) pulseEnd = AM.time() + T; }

function changed(replug){
  CUR = interpret();
  applyEngine(true);
  renderStatus(); renderStrip(); renderProbes(); build3D(); drawSchema();
  if(selId && !findPart(selId)) select(null); else if(selId) select(selId);
}

/* ---------------------------------------------------------------- UI: drawer, status, strip, probes */
function partCard(type){
  const P = PARTS[type], d = document.createElement('div');
  d.className = 'part'; d.draggable = true; d.style.setProperty('--pc', P.color); d.dataset.type = type;
  d.innerHTML = '<div class="ic"><svg viewBox="0 0 48 48">' + ICON[type] + '</svg></div><h3>' + P.name + '</h3><p>' + P.blurb + '</p><div class="vers"></div>' +
    '<button type="button" class="add" title="Add to the bench">＋</button>';
  const vb = $('.vers', d);
  P.vers.forEach(v => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = v.label; b.title = v.desc;
    b.addEventListener('click', e => { e.stopPropagation(); pick[type] = v.id; $$('button', vb).forEach(x => x.classList.toggle('on', x === b)); });
    if(v.id === pick[type]) b.classList.add('on');
    vb.appendChild(b);
  });
  $('.add', d).addEventListener('click', e => { e.stopPropagation(); place(type, pick[type]); });
  d.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'part:' + type + ':' + pick[type]); e.dataTransfer.effectAllowed = 'copy'; d.classList.add('dragging'); DRAG = type; });
  d.addEventListener('dragend', () => { d.classList.remove('dragging'); DRAG = null; showGhost(null); $('#stage').classList.remove('dragover'); });
  return d;
}
let DRAG = null;
Object.keys(PARTS).forEach(t => $('#parts').appendChild(partCard(t)));

function renderStatus(){
  $('#status').innerHTML = CUR.msgs.slice(0, 4).map(m => '<div class="msg ' + m[0] + '"><b class="i">' + m[1] + '</b><span>' + m[2] + '</span></div>').join('');
}
function boardChip(p){
  const v = verOf(p);
  return '<span class="bd" style="--pc:' + PARTS[p.type].color + '" data-id="' + p.id + '">' + PARTS[p.type].name.replace(/ \(.*\)/, '') +
    ' <i>' + v.label + '</i><button type="button" data-del="' + p.id + '" aria-label="Remove">✕</button></span>';
}
function renderStrip(){
  let h = '<div class="slotcard dock' + (A.battery ? '' : ' empty') + '"><div class="sl">DOCK</div>' + (A.battery ? boardChip(A.battery) : '') + '</div>';
  A.slots.forEach((s, i) => {
    h += '<div class="slotcard' + (s.length ? '' : ' empty') + '"><div class="sl">SLOT ' + (i + 1) + '</div>' + s.slice().reverse().map(boardChip).join('') + '</div>';
  });
  h += '<div class="slotcard' + (A.wire ? '' : ' empty') + '"><div class="sl">WIRE</div>' + (A.wire ? boardChip(A.wire) : '') + '</div>';
  $('#strip').innerHTML = h;
}
$('#strip').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'); if(del){ removePart(+del.dataset.del); return; }
  const bd = e.target.closest('.bd'); if(bd) select(+bd.dataset.id);
});
function renderProbes(){
  [0, 1].forEach(c => {
    const box = $('#nodes' + (c + 1)), list = (c ? [''] : []).concat(CUR.nodes);
    box.innerHTML = list.map(n => '<button type="button" data-n="' + n + '" style="--pc:' + (c ? '#4de4ff' : '#ffe14d') + '"' + (probe[c] === n ? ' class="on"' : '') + '>' + (n || 'OFF') + '</button>').join('');
  });
  SCOPE.setLabels(probe);
}
[0, 1].forEach(c => $('#nodes' + (c + 1)).addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  probe[c] = b.dataset.n; applyEngine(false); renderProbes(); if(SCH) syncSchema();
}));

/* selection panel */
function select(id){
  selId = id; const f = id ? findPart(id) : null, sp = $('#selpanel');
  if(!f){ sp.hidden = true; selId = null; highlight3D(); return; }
  const P = PARTS[f.p.type], v = verOf(f.p);
  sp.hidden = false; sp.style.setProperty('--pc', P.color);
  $('#sp-name').textContent = P.name; $('#sp-desc').textContent = v.desc;
  $('#sp-vers').innerHTML = P.vers.map(x => '<button type="button" data-v="' + x.id + '"' + (x.id === f.p.ver ? ' class="on"' : '') + ' title="' + x.desc + '">' + x.label + '</button>').join('');
  $('#sp-left').hidden = $('#sp-right').hidden = f.where !== 'slot';
  highlight3D();
}
$('#sp-vers').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b || !selId) return;
  const f = findPart(selId); f.p.ver = b.dataset.v; fresh.add(f.p.id); changed();
});
$('#sp-x').addEventListener('click', () => select(null));
$('#sp-del').addEventListener('click', () => selId && removePart(selId));
$('#sp-left').addEventListener('click', () => selId && movePart(selId, -1));
$('#sp-right').addEventListener('click', () => selId && movePart(selId, 1));

let toastT = 0;
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1600); }

/* ---------------------------------------------------------------- HUD, pad, panels */
$$('.seg button').forEach(b => b.addEventListener('click', () => {
  $$('.seg button').forEach(x => x.classList.toggle('on', x === b));
  $('#view-3d').classList.toggle('on', b.dataset.view === '3d'); $('#view-schema').classList.toggle('on', b.dataset.view === 'schema');
  if(b.dataset.view === 'schema') drawSchema(); else resize3D();
}));
const bpSel = $('#blueprint');
bpSel.innerHTML = '<option value="">Load…</option>' + BLUEPRINTS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('');
bpSel.addEventListener('change', () => { if(bpSel.value) loadBlueprint(bpSel.value); bpSel.value = ''; });
$('#btn-clear').addEventListener('click', () => { loadBlueprint('empty'); });
$('#btn-power').addEventListener('click', () => {
  POWER = !POWER; const b = $('#btn-power'); b.classList.toggle('on', POWER); b.setAttribute('aria-pressed', POWER);
  applyEngine(POWER); toast(POWER ? 'Power ON' : 'Power OFF');
});
const potEl = $('#pot');
function potUI(){
  rpot = +potEl.value * 1e3;
  $('#pot-v').textContent = (+potEl.value).toFixed(1) + ' kΩ';
  $('#pot-i').textContent = CUR && CUR.st.src === 'ideal' ? 'ideal 50 µA' : '≈ ' + Math.round(0.56 / (rpot + 7e3) * 1e6) + ' µA';
}
potEl.addEventListener('input', () => { potUI(); if(CUR){ CUR.st.rpot = rpot; AM.st.rpot = rpot; AM.build(); } });
$('#pulses').innerHTML = [0.01, 0.1, 1].map(T => '<button type="button" class="chip" data-t="' + T + '">' + (T >= 1 ? T + ' s' : T * 1e3 + ' ms') + '</button>').join('');
$('#pulses').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if(b) pressFor(+b.dataset.t); });
const swb = $('#swbig');
swb.addEventListener('pointerdown', e => { swb.setPointerCapture(e.pointerId); pulseEnd = null; setSW(true); });
const swUp = () => { if(swDown && pulseEnd === null) setSW(false); };
swb.addEventListener('pointerup', swUp); swb.addEventListener('pointercancel', swUp);
window.addEventListener('keydown', e => { if(e.code === 'Space' && !e.repeat && e.target === document.body){ e.preventDefault(); pulseEnd = null; setSW(true); } });
window.addEventListener('keyup', e => { if(e.code === 'Space' && e.target === document.body){ e.preventDefault(); swUp(); } });

function togglePanel(cls, tab, open, close){
  const closed = document.body.classList.toggle(cls);
  tab.textContent = closed ? open : close;
  setTimeout(resize3D, 420);
}
$('#tab-drawer').addEventListener('click', () => togglePanel('dclosed', $('#tab-drawer'), '▶', '◀'));
$('#tab-bay').addEventListener('click', () => togglePanel('bclosed', $('#tab-bay'), '◀', '▶'));
if(innerWidth < 860){ document.body.classList.add('dclosed', 'bclosed'); $('#tab-drawer').textContent = '▶'; $('#tab-bay').textContent = '◀'; }

/* ---------------------------------------------------------------- oscilloscope */
const SCOPE = Scope($('#scope'));
function fitScope(){
  const w = $('#scopefit').clientWidth, s = Math.min(1.2, w / 566);
  $('#scope').firstChild.style.transform = 'scale(' + s + ')';
  $('#scopefit').style.height = Math.round(380 * s) + 'px';
}
new ResizeObserver(fitScope).observe($('#scopefit'));
function renderMeas(){
  const m = SCOPE.measure(), f = v => v === undefined || v === null ? '—' : v.toFixed(3) + ' V';
  const cell = (c, k, l) => '<div><b>CH' + c + ' ' + l + '</b>' + (m['c' + c] ? f(m['c' + c][k]) : '—') + '</div>';
  $('#meas').innerHTML = cell(1, 'max', 'MAX') + cell(1, 'min', 'MIN') + cell(1, 'pp', 'Vpp') + cell(2, 'max', 'MAX') + cell(2, 'min', 'MIN') + cell(2, 'pp', 'Vpp');
}

/* ---------------------------------------------------------------- schema view */
let SCH = null;
const ZH = [   /* the shared schematic labels some parts in Chinese; this page is English */
  ['V+ 飛線到 FI（Passive 底板沒串 V+）', 'V+ flywire to FI (passive bases do not carry V+)'],
  ['V+（疊接排針，Stimulator → FI）', 'V+ (stacked header, Stimulator → FI)'],
  ['GND（Stimulator 的 −，示波器地線夾這裡）', 'GND (Stimulator −, scope ground clip)'],
  ['GND（Extracellular，接在 Stimulator 的 −）', 'GND (extracellular, to Stimulator −)'],
  ['電子（逆著電流、往電池 + 極走；越快＝電流越大）', 'electrons (against the current; faster = more current)'],
  ['（active 端細胞外）', '(active-end extracellular)'], ['和原版電路不同', 'differs from the kit'],
  ['理想電流源', 'ideal current source'], ['切換接點', 'toggle contact'], ['FI 自帶', 'FI own'], ['電池', 'battery'], ['斷開', 'open'], ['　', '  ']
];
function english(svg){
  const w = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
  for(let n = w.nextNode(); n; n = w.nextNode()){
    let s = n.nodeValue; if(!/[　-鿿＀-￯]/.test(s)) continue;
    ZH.forEach(([a, b]) => { s = s.split(a).join(b); }); n.nodeValue = s;
  }
  $$('[aria-label]', svg).forEach(e => { let s = e.getAttribute('aria-label'); ZH.forEach(([a, b]) => { s = s.split(a).join(b); }); e.setAttribute('aria-label', s); });
}
function drawSchema(){
  const wrap = $('#schwrap'), svg = $('#sch');
  if(!$('#view-schema').classList.contains('on')) return;
  if(!CUR.hasStim){ wrap.classList.add('none'); SCH = null; svg.innerHTML = ''; return; }
  wrap.classList.remove('none');
  SCH = MembraneSchematic(svg, {live:true, chain:CUR.st.chain, lk2:CUR.st.lk2});
  syncSchema(); english(svg);
}
function syncSchema(){
  if(!SCH) return;
  const st = Object.assign({}, CUR.st, {sw:AM.st.sw});
  SCH.setContacts(st); SCH.setQsense(st.qs); SCH.setResistors(st.r13, st.rfe, st.so_r2); SCH.setAddons(st);
  SCH.setSupply(st.fi_supply); SCH.setSource(st.src); SCH.setBoards({lk:st.leak, fi:st.fi_on, so:st.so_on});
  SCH.setProbes([probe[0], probe[1]]);
}

/* ---------------------------------------------------------------- 3D bench */
const canvas = $('#c3d');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
camera.position.set(0.8, 11.5, 10.5);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0.4, 0.8, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.46;
controls.minDistance = 5; controls.maxDistance = 46; controls.update();
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x4a3420, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(5, 14, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left:-11, right:11, top:8, bottom:-8, near:1, far:40}); sun.shadow.bias = -0.0005;
scene.add(sun);

const SX = i => -4.0 + i * 1.95, DOCKX = -6.35, BW = 1.5, BD = 1.9, BT = 0.07, LIFT = 0.45, PITCH = 0.5;
function canvasTex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/* table + cutting mat with painted slots */
const table = new THREE.Mesh(new THREE.BoxGeometry(17.5, 0.7, 8.4), new THREE.MeshStandardMaterial({color:0x9a6537, roughness:.8,
  map:canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#a56d3c'; g.fillRect(0, 0, w, h);
    for(let i = 0; i < 40; i++){ g.strokeStyle = 'rgba(70,40,15,' + (0.08 + Math.random() * .12) + ')'; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + 8 - Math.random() * 16, 2 * w / 3, y + 8 - Math.random() * 16, w, y); g.stroke(); }
    for(let i = 1; i < 4; i++){ g.fillStyle = 'rgba(40,22,8,.5)'; g.fillRect(0, i * h / 4, w, 2); } })}));
table.position.y = -0.36; table.receiveShadow = true; scene.add(table);
const drawMat = (g, w, h) => {
    g.fillStyle = '#1f5a46'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    for(let x = 0; x < w; x += 20){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for(let y = 0; y < h; y += 20){ g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const px = x => (x + 7.8) * 100, pz = z => (z + 3.3) * 100;
    g.setLineDash([14, 10]); g.lineWidth = 5; g.font = '64px "Lilita One", sans-serif'; g.textAlign = 'center';
    for(let i = 0; i < NSLOT; i++){
      g.strokeStyle = 'rgba(255,230,140,.75)'; g.strokeRect(px(SX(i) - 0.85), pz(-1.08), 170, 216);
      g.fillStyle = 'rgba(255,230,140,.85)'; g.fillText(String(i + 1), px(SX(i)), pz(1.75));
    }
    g.strokeStyle = 'rgba(255,170,80,.85)'; g.strokeRect(px(DOCKX - 0.6), pz(-1.08), 120, 216);
    g.fillStyle = 'rgba(255,170,80,.9)'; g.font = '30px "Lilita One", sans-serif'; g.fillText('POWER', px(DOCKX), pz(1.62)); g.fillText('DOCK', px(DOCKX), pz(1.92));
    g.setLineDash([]); g.font = '34px "Lilita One", sans-serif'; g.fillStyle = 'rgba(255,255,255,.35)'; g.textAlign = 'left';
    g.fillText('SANDBOX! BUILD MAT  ·  boards stack on a slot  ·  neighbouring slots connect', 30, 50);
};
const mat = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 6.6), new THREE.MeshStandardMaterial({roughness:.95, map:canvasTex(1560, 660, drawMat)}));
mat.rotation.x = -Math.PI / 2; mat.position.y = 0.002; mat.receiveShadow = true; scene.add(mat);
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/* shared geometry / materials */
const G = {
  pcb:new THREE.BoxGeometry(BW, BT, BD), pin:new THREE.BoxGeometry(0.035, LIFT - 0.02, 0.035), hdr:new THREE.BoxGeometry(0.16, 0.1, 0.16),
  res:new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), lead:new THREE.BoxGeometry(0.46, 0.015, 0.015),
  to92:new THREE.CylinderGeometry(0.09, 0.09, 0.2, 16, 1, false, 0, Math.PI), capE:new THREE.CylinderGeometry(0.15, 0.15, 0.34, 20),
  capF:new THREE.BoxGeometry(0.3, 0.26, 0.14), btnB:new THREE.BoxGeometry(0.34, 0.1, 0.34), btnC:new THREE.CylinderGeometry(0.11, 0.11, 0.1, 20),
  pot:new THREE.BoxGeometry(0.3, 0.16, 0.3), potK:new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), led:new THREE.SphereGeometry(0.075, 16, 12),
  chip:new THREE.BoxGeometry(0.42, 0.06, 0.26), diode:new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10),
  bat:new THREE.BoxGeometry(0.9, 1.35, 0.55), batT:new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12), glow:new THREE.BoxGeometry(BW + 0.16, BT + 0.12, BD + 0.16)
};
const Mt = {
  pcbSide:new THREE.MeshStandardMaterial({color:0x1d6b35, roughness:.6}), gold:new THREE.MeshStandardMaterial({color:0xd8b25a, metalness:.8, roughness:.3}),
  black:new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:.5}), res:new THREE.MeshStandardMaterial({color:0xd8c19a, roughness:.6}),
  mod:new THREE.MeshStandardMaterial({color:0xff4fd0, emissive:0x8a0f6c, emissiveIntensity:.8, roughness:.4}),
  lead:new THREE.MeshStandardMaterial({color:0xcfd4da, metalness:.9, roughness:.3}), capE:new THREE.MeshStandardMaterial({color:0x2f5fd0, roughness:.4}),
  capF:new THREE.MeshStandardMaterial({color:0xf2c632, roughness:.5}), red:new THREE.MeshStandardMaterial({color:0xe5372b, roughness:.35}),
  pot:new THREE.MeshStandardMaterial({color:0x2a64d8, roughness:.5}), white:new THREE.MeshStandardMaterial({color:0xf2f2f2, roughness:.5}),
  diode:new THREE.MeshStandardMaterial({color:0xe07b2a, roughness:.3}), bat:new THREE.MeshStandardMaterial({color:0x262626, roughness:.55}),
  wire:new THREE.MeshStandardMaterial({color:0xe5372b, roughness:.45}), wireB:new THREE.MeshStandardMaterial({color:0x202020, roughness:.45}),
  glow:new THREE.MeshBasicMaterial({color:0x7cffb2, transparent:true, opacity:.35, depthWrite:false}),
  ghost:new THREE.MeshBasicMaterial({color:0xffe066, transparent:true, opacity:.35, depthWrite:false})
};
const topTex = {};
function boardTop(p){
  const key = p.type + ':' + p.ver;
  if(topTex[key]) return topTex[key];
  const P = PARTS[p.type], v = verOf(p);
  const tex = canvasTex(300, 380, (g, w, h) => {
    g.fillStyle = '#1f7a3a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,230,150,.25)'; g.lineWidth = 6;
    for(let i = 0; i < 7; i++){ g.beginPath(); g.moveTo(20 + i * 40, h - 20); g.lineTo(20 + i * 40, 150 + (i % 3) * 30); g.lineTo(w - 30, 120 + i * 10); g.stroke(); }
    g.fillStyle = P.color; g.fillRect(0, 0, w, 64);
    g.fillStyle = '#111'; g.font = '40px "Lilita One", sans-serif'; g.textAlign = 'center';
    g.fillText(P.name.replace(/ \(.*\)/, '').toUpperCase(), w / 2, 47);
    g.fillStyle = v.mod ? '#ff4fd0' : '#f2efe6'; g.font = '34px "Lilita One", sans-serif'; g.fillText(v.label, w / 2, h - 22);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.strokeRect(10, 74, w - 20, h - 130);
  });
  return (topTex[key] = new THREE.MeshStandardMaterial({map:tex, roughness:.55}));
}
const batTex = {};
function batMat(v){
  return batTex[v.id] || (batTex[v.id] = new THREE.MeshStandardMaterial({roughness:.5, map:canvasTex(180, 270, (g, w, h) => {
    g.fillStyle = '#262626'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff9f1c'; g.fillRect(0, 80, w, 110);
    g.fillStyle = '#111'; g.font = '62px "Lilita One", sans-serif'; g.textAlign = 'center'; g.fillText(v.label.replace(' ', ''), w / 2, 160);
    g.fillStyle = '#ddd'; g.font = '22px "Lilita One", sans-serif'; g.fillText('SANDBOX CELL', w / 2, 60);
  })}));
}
const BOARD = new THREE.Group(); scene.add(BOARD);
let PICKABLE = [], LEDS = [], SWMESH = null, GHOST = null, GLOW = null, animT0 = new Map();

function addRes(g, x, z, rot, mod){
  const r = new THREE.Mesh(G.res, mod ? Mt.mod : Mt.res); r.rotation.z = Math.PI / 2; r.rotation.y = rot || 0; r.position.set(x, BT / 2 + 0.07, z); r.castShadow = true; g.add(r);
  const l = new THREE.Mesh(G.lead, Mt.lead); l.rotation.y = rot || 0; l.position.set(x, BT / 2 + 0.07, z); g.add(l);
}
function addTr(g, x, z){ const t = new THREE.Mesh(G.to92, Mt.black); t.position.set(x, BT / 2 + 0.1, z); t.rotation.y = Math.PI / 2; t.castShadow = true; g.add(t); }
function addLed(g, x, z, node, color){
  const m = new THREE.MeshStandardMaterial({color, emissive:color, emissiveIntensity:0, roughness:.3});
  const s = new THREE.Mesh(G.led, m); s.position.set(x, BT / 2 + 0.08, z); g.add(s); LEDS.push({m, node});
}
function makeBoard(p, unitNode){
  const g = new THREE.Group(), v = verOf(p);
  const top = boardTop(p), mats = [Mt.pcbSide, Mt.pcbSide, top, Mt.pcbSide, Mt.pcbSide, Mt.pcbSide];
  const pcb = new THREE.Mesh(G.pcb, mats); pcb.castShadow = true; pcb.receiveShadow = true; g.add(pcb);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const pin = new THREE.Mesh(G.pin, Mt.gold); pin.position.set(sx * (BW / 2 - 0.14), -LIFT / 2, sz * (BD / 2 - 0.14)); g.add(pin);
    const h = new THREE.Mesh(G.hdr, Mt.black); h.position.set(sx * (BW / 2 - 0.14), BT / 2 + 0.05, sz * (BD / 2 - 0.14)); h.castShadow = true; g.add(h);
  });
  const T = p.type;
  if(T === 'stim'){
    const b = new THREE.Mesh(G.btnB, Mt.black); b.position.set(-0.32, BT / 2 + 0.05, 0.32); g.add(b);
    const c = new THREE.Mesh(G.btnC, Mt.red); c.position.set(-0.32, BT / 2 + 0.14, 0.32); c.userData = {sw:true, y0:BT / 2 + 0.14}; c.castShadow = true; g.add(c); SWMESH = c;
    const pt = new THREE.Mesh(G.pot, Mt.pot); pt.position.set(0.32, BT / 2 + 0.08, 0.32); g.add(pt);
    const pk = new THREE.Mesh(G.potK, Mt.white); pk.position.set(0.32, BT / 2 + 0.18, 0.32); g.add(pk);
    addTr(g, -0.3, -0.25); addTr(g, 0.1, -0.25); addRes(g, -0.1, -0.6, 0); addRes(g, 0.42, -0.2, Math.PI / 2);
    if(p.ver === 'fix') addRes(g, 0.05, 0.0, 0, true);
    if(p.ver === 'ideal'){ const ch = new THREE.Mesh(G.chip, Mt.mod); ch.position.set(0.05, BT / 2 + 0.03, 0.0); g.add(ch); }
  } else if(T === 'leak'){
    const f = new THREE.Mesh(G.capF, Mt.capF); f.position.set(-0.2, BT / 2 + 0.13, 0.15); f.castShadow = true; g.add(f);
    addRes(g, 0.25, 0.15, Math.PI / 2); addRes(g, 0, -0.5, 0);
    if(p.ver === 'true') addRes(g, 0.0, 0.55, 0, true);
    addLed(g, 0.5, -0.72, 'Vm', 0x4ea8ff);
  } else if(T === 'fi'){
    addTr(g, -0.32, 0.3); addTr(g, 0.22, 0.3);
    const d = new THREE.Mesh(G.diode, Mt.diode); d.rotation.z = Math.PI / 2; d.position.set(-0.3, BT / 2 + 0.05, -0.3); g.add(d);
    addRes(g, 0.2, -0.3, 0); addRes(g, 0.0, -0.62, 0);
    if(p.ver === 'true'){ addRes(g, 0.45, 0.0, Math.PI / 2, true); addRes(g, -0.05, 0.0, 0, true); }
    if(p.ver === 'r13') addRes(g, 0.2, -0.3, 0, true);
    addLed(g, 0.52, 0.72, 'Vm', 0xffd23f);
  } else if(T === 'so'){
    addTr(g, -0.3, 0.32); addTr(g, 0.3, 0.32);
    const c = new THREE.Mesh(G.capE, Mt.capE); c.position.set(-0.25, BT / 2 + 0.17, -0.3); c.castShadow = true; g.add(c);
    addRes(g, 0.3, -0.3, Math.PI / 2); addRes(g, 0.0, -0.66, 0);
    if(p.ver === 'true') addRes(g, -0.25, 0.0, 0, true);
    addLed(g, 0.52, 0.72, 'SO.S', 0xb98cff);
  } else if(T === 'passive'){
    const c = new THREE.Mesh(G.capE, Mt.capE); c.position.set(-0.25, BT / 2 + 0.17, 0.1); c.castShadow = true; g.add(c);
    addRes(g, 0.3, 0.1, Math.PI / 2); addRes(g, 0.0, -0.55, 0);
    if(p.ver === 'true') addRes(g, 0.0, 0.55, 0, true);
    if(unitNode) addLed(g, 0.52, -0.72, unitNode, 0x3fe0c5);
  }
  g.traverse(o => { if(o.isMesh) o.userData.partId = o.userData.partId || p.id; });
  g.userData.partId = p.id;
  return g;
}
function tube(a, b, h, m, r){
  const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + h;
  const curve = new THREE.CatmullRomCurve3([a, a.clone().setY(a.y + h * 0.4), mid, b.clone().setY(b.y + h * 0.4), b]);
  const t = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r || 0.045, 10, false), m); t.castShadow = true; t.userData.dispose = true; return t;
}
function build3D(){
  /* clear old meshes (shared geometry stays; LED materials and tubes are per build) */
  BOARD.traverse(o => { if(o.userData.dispose && o.geometry) o.geometry.dispose(); });
  LEDS.forEach(l => l.m.dispose());
  BOARD.clear(); PICKABLE = []; LEDS = []; SWMESH = null; GLOW = null;
  const unitOf = {}; CUR.units.forEach((id, k) => unitOf[id] = 'PC' + (k + 1));
  const now = performance.now();
  let stimTop = null, fiPos = null;
  A.slots.forEach((s, i) => s.forEach((p, j) => {
    const g = makeBoard(p, unitOf[p.id]);
    g.position.set(SX(i), LIFT + j * PITCH, 0); g.userData.y = g.position.y;
    if(!CUR.used.has(p.id)){ g.traverse(o => { if(o.isMesh && o.material === Mt.pcbSide) o.material = Mt.pcbSide; }); g.rotation.y = 0.12; }
    if(fresh.has(p.id)){ animT0.set(p.id, now); fresh.delete(p.id); }
    BOARD.add(g); PICKABLE.push(g);
    if(p.type === 'stim') stimTop = new THREE.Vector3(SX(i) - BW / 2 + 0.14, g.position.y + 0.12, -BD / 2 + 0.14);
    if(p.type === 'fi' && CUR.used.has(p.id)) fiPos = new THREE.Vector3(SX(i) - BW / 2 + 0.14, g.position.y + 0.12, -BD / 2 + 0.14);
  }));
  if(A.battery){
    const v = verOf(A.battery), g = new THREE.Group();
    const side = batMat(v), body = new THREE.Mesh(G.bat, [Mt.bat, Mt.bat, Mt.bat, Mt.bat, side, side]); body.castShadow = true; g.add(body);
    [-0.2, 0.2].forEach(x => { const t = new THREE.Mesh(G.batT, Mt.lead); t.position.set(x, 0.72, 0); g.add(t); });
    g.position.set(DOCKX, 0.68, 0); g.userData.y = 0.68; g.userData.partId = A.battery.id; g.traverse(o => { if(o.isMesh) o.userData.partId = A.battery.id; });
    if(fresh.has(A.battery.id)){ animT0.set(A.battery.id, now); fresh.delete(A.battery.id); }
    BOARD.add(g); PICKABLE.push(g);
    const S = stimSlot();
    if(S >= 0){   /* battery clip to the Stimulator header */
      const st = A.slots[S].findIndex(p => p.type === 'stim'), y = LIFT + st * PITCH + 0.1, zx = SX(S) - BW / 2 + 0.14;
      BOARD.add(tube(new THREE.Vector3(DOCKX - 0.2, 1.42, 0), new THREE.Vector3(zx, y, BD / 2 - 0.14), 0.9, Mt.wire, 0.035));
      BOARD.add(tube(new THREE.Vector3(DOCKX + 0.2, 1.42, 0), new THREE.Vector3(zx, y, BD / 2 - 0.4), 0.7, Mt.wireB, 0.035));
    }
  }
  if(A.wire){
    const a = stimTop || new THREE.Vector3(SX(0), 1.2, -1), b = fiPos || new THREE.Vector3(SX(2), 1.0, -1.4);
    const t = tube(a, b, 1.3, Mt.wire, 0.05); t.userData.partId = A.wire.id;
    const g = new THREE.Group(); g.add(t); g.userData.partId = A.wire.id; g.userData.y = 0; BOARD.add(g); PICKABLE.push(g);
  }
  highlight3D();
}
function highlight3D(){
  if(GLOW){ GLOW.parent && GLOW.parent.remove(GLOW); GLOW = null; }
  if(!selId) return;
  const g = PICKABLE.find(x => x.userData.partId === selId); if(!g) return;
  const f = findPart(selId);
  GLOW = new THREE.Mesh(f && f.where === 'dock' ? new THREE.BoxGeometry(1.05, 1.5, 0.7) : G.glow, Mt.glow);
  if(f && f.where === 'dock') GLOW.userData.dispose = true;
  if(f && f.where === 'wire') return;
  g.add(GLOW);
}
/* ghost while dragging from the drawer */
function showGhost(at){
  if(GHOST){ scene.remove(GHOST); GHOST = null; }
  if(!at) return;
  GHOST = new THREE.Mesh(at.dock ? new THREE.BoxGeometry(0.9, 1.35, 0.55) : G.pcb, Mt.ghost);
  if(at.dock) GHOST.position.set(DOCKX, 0.68, 0); else GHOST.position.set(SX(at.slot), LIFT + A.slots[at.slot].length * PITCH, 0);
  scene.add(GHOST);
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function rayAt(e){
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  camera.updateMatrixWorld(); BOARD.updateMatrixWorld(true);   /* picking must not depend on the last rendered frame */
  ray.setFromCamera(ndc, camera);
}
function slotAt(e){
  rayAt(e); const hit = new THREE.Vector3();
  if(!ray.ray.intersectPlane(plane, hit)) return null;
  if(Math.abs(hit.z) > 2.2) return null;
  let best = -1, bd = 1.1;
  for(let i = 0; i < NSLOT; i++){ const d = Math.abs(hit.x - SX(i)); if(d < bd){ bd = d; best = i; } }
  return best >= 0 ? best : null;
}
/* drag and drop onto the stage (both views) */
const stage = $('#stage');
stage.addEventListener('dragover', e => {
  if(!DRAG) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; stage.classList.add('dragover');
  if($('#view-3d').classList.contains('on')){
    const w = PARTS[DRAG].where;
    if(w === 'dock') showGhost({dock:true}); else if(w === 'wire') showGhost(null);
    else { const s = slotAt(e); showGhost(s === null ? null : {slot:s}); }
  }
});
stage.addEventListener('dragleave', e => { if(e.target === stage || !stage.contains(e.relatedTarget)){ stage.classList.remove('dragover'); showGhost(null); } });
stage.addEventListener('drop', e => {
  const d = e.dataTransfer.getData('text/plain'); stage.classList.remove('dragover'); showGhost(null);
  if(!d.startsWith('part:')) return; e.preventDefault();
  const [, type, ver] = d.split(':');
  const slot = $('#view-3d').classList.contains('on') && !PARTS[type].where ? slotAt(e) : null;
  place(type, ver, slot);
});
/* click to select, press the red SW */
let down = null;
canvas.addEventListener('pointerdown', e => {
  down = {x:e.clientX, y:e.clientY};
  rayAt(e);
  if(SWMESH){
    const h = ray.intersectObject(SWMESH, false);
    if(h.length){ controls.enabled = false; pulseEnd = null; setSW(true); down.sw = true; canvas.setPointerCapture(e.pointerId); }
  }
});
canvas.addEventListener('pointerup', e => {
  if(!down) return;
  if(down.sw){ setSW(false); controls.enabled = true; down = null; return; }
  if(Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5){
    rayAt(e);
    const hits = ray.intersectObjects(PICKABLE, true).filter(h => h.object.material !== Mt.glow);
    select(hits.length ? hits[0].object.userData.partId || null : null);
  }
  down = null;
});
canvas.addEventListener('pointermove', e => {
  if(down) return; rayAt(e);
  const over = SWMESH && ray.intersectObject(SWMESH, false).length;
  canvas.style.cursor = over ? 'pointer' : 'grab';
});
function resize3D(){
  const w = canvas.clientWidth, h = canvas.clientHeight; if(!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  /* keep the whole bench in view: move the camera along its current direction */
  const vf = camera.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
  const d = Math.max(8.6 / Math.tan(hf), 5.2 / Math.tan(vf)) * 0.92;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, Math.min(d, controls.maxDistance));
}
new ResizeObserver(resize3D).observe(stage);
const bounce = x => { const n = 7.5625, d = 2.75; if(x < 1 / d) return n * x * x; if(x < 2 / d) return n * (x -= 1.5 / d) * x + .75; if(x < 2.5 / d) return n * (x -= 2.25 / d) * x + .9375; return n * (x -= 2.625 / d) * x + .984375; };

/* ---------------------------------------------------------------- main loop */
let last = performance.now(), carry = 0, lastUI = 0, lastSch = 0;
function frame(now){
  const real = Math.min(now - last, 50) / 1000; last = now;
  carry += real;
  let n = Math.floor(carry / DT); carry -= n * DT; if(n > 300){ n = 300; carry = 0; }
  const c1 = AM.st.ch1, c2 = AM.st.ch2;
  for(let k = 0; k < n; k++){
    AM.step(DT);
    if(pulseEnd !== null && AM.time() >= pulseEnd){ pulseEnd = null; setSW(false); }
    SCOPE.push(AM.time(), AM.v(c1), c2 ? AM.v(c2) : NaN);
  }
  SCOPE.draw();
  if($('#view-3d').classList.contains('on')){
    LEDS.forEach(l => { const v = AM.has(l.node) ? AM.v(l.node) : 0; l.m.emissiveIntensity = Math.max(0, Math.min(3, v / 2.2)); });
    PICKABLE.forEach(g => {
      const t0 = animT0.get(g.userData.partId); if(t0 === undefined) return;
      const p = Math.min(1, (now - t0) / 550); g.position.y = g.userData.y + (1 - bounce(p)) * 3.2;
      if(p >= 1) animT0.delete(g.userData.partId);
    });
    if(GLOW) GLOW.material.opacity = 0.25 + 0.15 * Math.sin(now / 180);
    controls.update(); renderer.render(scene, camera);
  } else if(SCH){
    SCH.flow(real, AM.currents());
    if(now - lastSch > 120){ SCH.setValues(code => AM.has(code) ? AM.v(code) : null); lastSch = now; }
  }
  if(now - lastUI > 200){ renderMeas(); lastUI = now; }
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- start */
potUI();
document.fonts && document.fonts.load('40px "Lilita One"').then(() => { mat.material.map.dispose(); mat.material.map = canvasTex(1560, 660, drawMat); mat.material.needsUpdate = true; Object.keys(topTex).forEach(k => delete topTex[k]); Object.keys(batTex).forEach(k => delete batTex[k]); if(CUR) build3D(); });
loadBlueprint('22true');
resize3D(); fitScope();
requestAnimationFrame(frame);
window.SANDBOX = {A, AM, interpret:() => CUR, place, loadBlueprint, SCOPE, camera, SX, LIFT, PITCH, THREE,
  pick:(x, y) => { rayAt({clientX:x, clientY:y}); return ray.intersectObjects(PICKABLE, true).slice(0, 3).map(h => [h.object.userData.partId, h.distance.toFixed(2)]); }, sel:() => selId};   /* for debugging in the console */
