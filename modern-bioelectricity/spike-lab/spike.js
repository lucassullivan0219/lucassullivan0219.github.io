/* SPIKE LAB — the game.  Rules and catalog: parts.js (SL).  Levels: levels.js (LEVELS).
   Circuits: HW2 engine (global AM) or a fresh SynEngine() for HW3; the scope: scope.js (Scope). */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const P = SL.PARTS, DT = 2e-4, NSP = SL.SPOTS;
const BASE2 = {rprobe:1e6, r13:1e5, rfe:1e5, so_r2:1e6, rl:0, leak2:true, fi_vm:true, fi_vplus:true, fi_gnd:true, so_vm:true, so_gnd:true, isrc:50e-6};

/* ================================================================ state */
let MODE = 'free', LV = null, A = SL.empty(), R = null, ENG = null;
let CT = 'mine', IDEAL = null, custom = false;
let probes = ['Vm', ''];
const sw = {A:false, B:false}, pulseEnd = {A:null, B:null}, rpot = {A:700, B:700};
let selId = null, holding = null, isi = 200;
const fresh = new Set();
let lvState = null;                       /* {hints, wrong, done, tutStep, tutT} */
let progress = {};
try{ progress = JSON.parse(localStorage.getItem('spikelab.v1') || '{}'); }catch(e){ progress = {}; }
if(!progress.stars) progress.stars = {};
function save(){ try{ localStorage.setItem('spikelab.v1', JSON.stringify(progress)); }catch(e){} }

/* ================================================================ screens */
function show(id){
  ['scr-title', 'scr-map', 'scr-game'].forEach(s => $('#' + s).hidden = s !== id);
  document.body.classList.toggle('on-title', id === 'scr-title');
  if(id === 'scr-game') setTimeout(() => { resize3D(); fitScope(); }, 30);
}
$('#btn-play').addEventListener('click', () => { renderMap(); show('scr-map'); });
$('#btn-free').addEventListener('click', () => startFree());
$$('[data-go="title"]').forEach(b => b.addEventListener('click', () => show('scr-title')));
$('#btn-back').addEventListener('click', () => { endTutorial(); if(MODE === 'campaign'){ renderMap(); show('scr-map'); } else show('scr-title'); });
$('.title-spark').innerHTML = '<svg viewBox="0 0 800 80" preserveAspectRatio="none"><path d="M0 60 H90 Q100 60 104 50 L112 6 L122 74 L130 52 Q136 44 150 60 H490 Q500 60 504 50 L512 6 L522 74 L530 52 Q536 44 550 60 H800" fill="none" stroke="#ffcf3f" stroke-width="4" stroke-linejoin="round"/></svg>';

function totalStars(){ return Object.values(progress.stars).reduce((a, b) => a + b, 0); }
function renderMap(){
  $('#starsum').textContent = '★ ' + totalStars() + ' / ' + LEVELS.length * 3;
  const ch = {START:'Getting started', HW2:'Homework 2 · membranes and cables', HW3:'Homework 3 · synapses'};
  $('#chapters').innerHTML = Object.keys(ch).map(c => '<div class="chapter"><h3>' + (c === 'START' ? 'START' : c) + '<small>' + ch[c] + '</small></h3><div class="lvls">' +
    LEVELS.filter(l => l.ch === c).map(l => {
      const s = progress.stars[l.id] || 0;
      return '<button type="button" class="lvl" data-lv="' + l.id + '"><span class="code">' + l.code + '</span><b>' + l.title + '</b><span class="kind ' + l.kind + '">' + l.kind.toUpperCase() + '</span>' +
        '<span class="st">' + [1, 2, 3].map(i => '<span class="' + (i <= s ? 'on' : '') + '">★</span>').join('') + '</span></button>';
    }).join('') + '</div></div>').join('');
}
$('#chapters').addEventListener('click', e => { const b = e.target.closest('[data-lv]'); if(b) startLevel(LEVELS.find(l => l.id === b.dataset.lv)); });

/* ================================================================ start a mode */
function startFree(){
  endTutorial();
  MODE = 'free'; LV = null; document.body.classList.remove('campaign');
  $('#goal').hidden = true; $('#bpwrap').hidden = false; $('#btn-clear').hidden = false; $('#vtoggle').hidden = false;
  $('#btn-back').textContent = '◀ TITLE';
  A = SL.build('c22'); CT = 'mine'; IDEAL = null; markFresh();
  applyType(false);
  renderDrawer(Object.keys(P));
  show('scr-game'); changed(true);
}
function startLevel(lv){
  endTutorial();
  MODE = 'campaign'; LV = lv; document.body.classList.add('campaign');
  $('#bpwrap').hidden = true; $('#btn-clear').hidden = !(lv.kind === 'build' || lv.kind === 'tutorial'); $('#vtoggle').hidden = true;
  document.body.classList.remove('showvers'); $('#showvers').checked = false;
  $('#btn-back').textContent = '◀ MAP';
  lvState = {hints:0, wrong:0, done:false, tutStep:0, tutT:0, tutPressed:false};
  CT = 'mine'; IDEAL = null;
  if((lv.kind === 'build' && !lv.keep) || lv.kind === 'tutorial') A = SL.empty();
  else { A = SL.build(lv.cid, {n:lv.n}); markFresh(); applyType(false); }
  probes = (lv.probes || []).slice();
  renderDrawer(lv.parts || []);
  if(!(lv.parts || []).length){ document.body.classList.add('dclosed'); $('#tab-drawer').textContent = '▶'; }
  else if(innerWidth >= 860){ document.body.classList.remove('dclosed'); $('#tab-drawer').textContent = '◀'; }
  show('scr-game'); changed(true); renderGoal();
  if(lv.kind === 'tutorial') startTutorial();
}
function markFresh(){ SL.all(A).forEach(p => fresh.add(p.id)); }

/* ================================================================ circuit types */
function cidOf(){
  if(LV) return LV.cid;
  if(!R) return 'c22';
  if(R.hw === 3) return R.st.syn === 'exc' ? (R.st.post === 'active' ? 'c32' : 'c31') : (R.st.post === 'active' ? 'c34' : 'c33');
  return !R.n ? 'c22' : R.mem && R.mem.fi ? 'c23' : 'c21';
}
function applyType(redraw){
  const cid = cidOf();
  SL.applySt(A, SL.typeSt(cid, CT, IDEAL));
  custom = false;
  if(redraw !== false){ markFresh(); changed(false); }
  renderCT();
}
function renderCT(){
  $$('#ctype button').forEach(b => b.classList.toggle('on', !custom && b.dataset.ct === CT));
  const sel = $('#idealsel'), c = CIRCUITS[cidOf()];
  if(CT === 'ideal' && !custom && c && c.ideal.length > 1){
    sel.hidden = false;
    const cur = IDEAL || (c.ideal.find(i => i.def) || c.ideal[0]).id;
    sel.innerHTML = c.ideal.map(i => '<option value="' + i.id + '"' + (i.id === cur ? ' selected' : '') + '>' + i.en + '</option>').join('');
  } else sel.hidden = true;
}
$$('#ctype button').forEach(b => b.addEventListener('click', () => { CT = b.dataset.ct; IDEAL = null; applyType(); toast({kit:'KIT: the class wiring', mine:'MY BUILD: what we actually built', ideal:'IDEAL: the best circuit the simulation found'}[CT]); }));
$('#idealsel').addEventListener('change', e => { IDEAL = e.target.value; applyType(); });

/* ================================================================ assembly changes */
function changed(replug){
  R = SL.analyze(A);
  if(selId && !SL.find(A, selId)) selId = null;
  fixProbes();
  applyEngine(replug !== false);
  renderStatus(); renderPad(); renderClips(); build3D(); drawSchema(); renderSel(); renderCT();
  if(MODE === 'campaign') checkLive();
}
function fixProbes(){
  const nodes = R.nodes || ['Vm'];
  const def = R.hw === 3 ? ['A.Vm', R.st.post === 'active' ? 'B.Vm' : 'P1'] : ['Vm', R.n ? 'PC1' : (R.mem && R.mem.so ? 'SO.S' : '')];
  [0, 1].forEach(c => { if(!probes[c] || (nodes.indexOf(probes[c]) < 0 && !(c === 1 && probes[c] === ''))) probes[c] = def[c]; });
  if(probes[1] && nodes.indexOf(probes[1]) < 0) probes[1] = def[1];
}
function place(type, ver, spot){
  const r = SL.place(A, type, ver, spot);
  if(!r.ok){ toast(r.msg); return false; }
  fresh.add(r.id); if(r.msg) toast(r.msg);
  custom = custom || MODE === 'free' && !!ver && ver !== SL.verOf({type, ver:'__'}).id;
  if(MODE === 'free'){ const p = SL.find(A, r.id).p; if(CT && !ver) SL.applySt({spots:[{stack:[p]}], bases:[], battery:null}, SL.typeSt(cidOf(), CT, IDEAL)); }
  changed(true);
  return true;
}

/* ================================================================ engines */
function applyEngine(replug){
  if(!R) return;
  if(!ENG || ENG.hw !== R.hw || (R.hw === 3 && (ENG.syn !== R.st.syn || ENG.post !== R.st.post))){
    ENG = R.hw === 3 ? {hw:3, E:SynEngine(), syn:R.st.syn, post:R.st.post} : {hw:2, E:AM};
    replug = true;
  }
  const E = ENG.E;
  if(R.hw === 2){
    for(const k in BASE2) E.st[k] = BASE2[k];
    for(const k in R.st) E.st[k] = R.st[k];
    E.st.rpot = rpot.A; E.st.sw = sw.A && R.ok; E.st.ch1 = probes[0]; E.st.ch2 = probes[1];
  } else {
    E.MEM.cusA = Object.assign({}, R.memA || E.MEM.kit); E.MEM.cusB = Object.assign({}, R.memB || E.MEM.kit);
    for(const k in R.st) E.st[k] = R.st[k];
    Object.assign(E.st, {rprobe:1e6, rpotA:rpot.A, rpotB:rpot.B, swA:sw.A, swB:sw.B && R.st.stimB, ch1:probes[0], ch2:probes[1]});
  }
  E.build();
  if(replug){ E.powerOn(); SCOPE.clear(); REC.reset(); }
}
function setSW(who, on){
  if(on && !(R && R.ok)){ toast(R && R.hw === 3 ? 'Stimulator A must sit on the Pre stack' : 'Add a Stimulator (on top of a stack) first'); return; }
  if(on && who === 'B' && !(R.hw === 3 && R.st.stimB)){ toast('No Stimulator B on the Post side'); return; }
  sw[who] = on;
  const E = ENG.E;
  if(R.hw === 2) E.st.sw = on; else { E.st.swA = sw.A; E.st.swB = sw.B; }
  E.build();
  $$('[data-sw="' + who + '"]').forEach(b => b.classList.toggle('down', on));
  if(on){ REC.press(E.time()); if(lvState) lvState.tutPressed = true; }
  pressAnim(who, on);
  if(SCH) syncSchema();
}
function pressFor(who, T){ setSW(who, true); if(sw[who]) pulseEnd[who] = ENG.E.time() + T; }
function train(n, gap, T){
  /* A pulses: n presses of T s, gap ms apart (start to start), scheduled on simulation time */
  if(!(R && R.ok)) return;
  const t0 = ENG.E.time();
  trainQ = []; for(let i = 0; i < n; i++) trainQ.push({on:t0 + i * gap / 1e3, off:t0 + i * gap / 1e3 + T});
}
let trainQ = [];

/* ================================================================ trial recorder (for MEASURE levels) */
const REC = {
  ring:[], trial:null, last:null,
  reset(){ this.ring = []; this.trial = null; this.last = null; },
  press(t){
    if(this.trial && t <= this.trial.tEnd){ this.trial.tEnd = t + 1.5; return; }
    const pre = this.ring.filter(s => s[0] >= t - 0.02);
    const base = [0, 1].map(c => { const v = pre.map(s => s[c + 1]).filter(x => !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; });
    this.trial = {tPress:t, tEnd:t + 1.5, base, max:[-Infinity, -Infinity], min:[Infinity, Infinity], tmax:[t, t]};
  },
  push(t, a, b){
    this.ring.push([t, a, b]); if(this.ring.length > 200) this.ring.splice(0, this.ring.length - 200);
    const tr = this.trial; if(!tr) return;
    [a, b].forEach((v, c) => { if(isNaN(v)) return; if(v > tr.max[c]){ tr.max[c] = v; tr.tmax[c] = t; } if(v < tr.min[c]) tr.min[c] = v; });
    this.last = this.metrics(tr);
    if(t > tr.tEnd) this.trial = null;
  },
  metrics(tr){
    return [0, 1].map(c => ({base:tr.base[c], peak:tr.max[c], amp:tr.max[c] - tr.base[c], dip:tr.base[c] - tr.min[c], tpeak:(tr.tmax[c] - tr.tPress) * 1e3}));
  }
};

/* ================================================================ drawer */
function renderDrawer(types){
  const box = $('#parts'); box.innerHTML = '';
  document.body.classList.toggle('noparts', !types.length);
  if(!types.length){ box.innerHTML = '<p class="small" style="color:var(--muted);font:700 13px Nunito;margin:6px 4px">No parts needed: everything is already on the table.</p>'; return; }
  types.forEach(t => box.appendChild(partCard(t)));
}
const ICON = {
  battery:'<rect x="12" y="10" width="24" height="32" rx="4" fill="#262626" stroke="#0a111d" stroke-width="3"/><rect x="12" y="20" width="24" height="10" fill="#ff9f1c"/><rect x="16" y="5" width="6" height="6" fill="#c9c9c9" stroke="#0a111d" stroke-width="2"/><rect x="26" y="5" width="6" height="6" fill="#c9c9c9" stroke="#0a111d" stroke-width="2"/>',
  stim:'<rect x="4" y="12" width="40" height="24" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><rect x="11" y="18" width="10" height="10" fill="#cfd4da" stroke="#0a111d" stroke-width="2"/><circle cx="32" cy="23" r="6" fill="#1a1a1a" stroke="#0a111d" stroke-width="2"/>',
  leak:'<rect x="4" y="12" width="40" height="24" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><rect x="12" y="17" width="9" height="13" fill="#f2c632" stroke="#0a111d" stroke-width="2"/><rect x="26" y="21" width="12" height="6" rx="3" fill="#8fc3f0" stroke="#0a111d" stroke-width="2"/>',
  fi:'<rect x="4" y="12" width="40" height="24" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><path d="M24 15v13m-5-5 5 5 5-5" stroke="#ffd23f" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  so:'<rect x="4" y="12" width="40" height="24" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><path d="M24 33V20m-5 5 5-5 5 5" stroke="#d6b8ff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  passive:'<rect x="4" y="12" width="40" height="24" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><circle cx="17" cy="24" r="5" fill="#f2c632" stroke="#0a111d" stroke-width="2"/><rect x="26" y="21" width="12" height="6" rx="3" fill="#8fc3f0" stroke="#0a111d" stroke-width="2"/>',
  base:'<rect x="2" y="18" width="44" height="14" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><g fill="#111">' + [8, 16, 24, 32, 40].map(x => '<rect x="' + (x - 2) + '" y="21" width="4" height="4"/>').join('') + '</g>',
  syne:'<rect x="6" y="8" width="36" height="32" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><text x="24" y="30" font-size="16" text-anchor="middle" fill="#ff8fa3" font-family="Lilita One">E</text>',
  syni:'<rect x="6" y="8" width="36" height="32" rx="3" fill="#1d4fb5" stroke="#0a111d" stroke-width="3"/><text x="24" y="30" font-size="16" text-anchor="middle" fill="#7fd1ff" font-family="Lilita One">I</text>',
  cell:'<rect x="9" y="17" width="30" height="14" rx="5" fill="#7bb33a" stroke="#0a111d" stroke-width="3"/><rect x="39" y="21" width="4" height="6" fill="#c9c9c9" stroke="#0a111d" stroke-width="2"/>',
  jumper:'<path d="M8 34C8 12 40 12 40 34" stroke="#0a111d" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M8 34C8 12 40 12 40 34" stroke="#f2f2f2" stroke-width="3" fill="none" stroke-linecap="round"/>',
  wire:'<path d="M8 38C8 14 40 34 40 10" stroke="#0a111d" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M8 38C8 14 40 34 40 10" stroke="#ff5a4f" stroke-width="4" fill="none" stroke-linecap="round"/>'
};
const pick = {};
function partCard(type){
  const p = P[type], d = document.createElement('div');
  d.className = 'part'; d.dataset.type = type; d.style.setProperty('--pc', p.color);
  d.dataset.name = ({battery:'Battery', stim:'Stimulator', fi:'Fast In', so:'Slow Out', passive:'Passive', base:'Base', syne:'Exc. syn.', syni:'Inh. syn.', cell:'1.5 V', jumper:'Jumper', wire:'Flywire'})[type] || p.name;
  d.innerHTML = '<div class="ic"><svg viewBox="0 0 48 48">' + ICON[type] + '</svg></div><h3>' + p.name + '</h3><p>' + p.blurb + '</p><div class="vers"></div>' +
    '<button type="button" class="add" title="Add to the table">＋</button>';
  const vb = $('.vers', d);
  let lastGrp = '';
  p.vers.forEach(v => {
    const g = v.my ? 'MY BUILD' : v.grp;
    if(g !== lastGrp){ const s = document.createElement('span'); s.className = 'grp'; s.textContent = g; vb.appendChild(s); lastGrp = g; }
    const b = document.createElement('button'); b.type = 'button'; b.textContent = v.label; b.title = v.desc; b.dataset.v = v.id;
    if((pick[type] || '') === v.id) b.classList.add('on');
    b.addEventListener('click', e => { e.stopPropagation(); pick[type] = pick[type] === v.id ? '' : v.id; $$('button', vb).forEach(x => x.classList.toggle('on', x.dataset.v === pick[type])); });
    vb.appendChild(b);
  });
  $('.add', d).addEventListener('click', e => { e.stopPropagation(); place(type, pick[type] || null, null); });
  dragSource(d, () => ({type, ver:pick[type] || null, label:p.name}));
  return d;
}
$('#showvers').addEventListener('change', e => document.body.classList.toggle('showvers', e.target.checked));

/* ---------------- pointer drag (mouse and touch) + tap-to-hold ---------------- */
let DRAG = null;
function dragSource(el, what){
  let st = null, timer = 0;
  el.addEventListener('pointerdown', e => {
    if(e.target.closest('button')) return;
    st = {x:e.clientX, y:e.clientY, id:e.pointerId, touch:e.pointerType !== 'mouse', armed:e.pointerType === 'mouse'};
    if(st.touch) timer = setTimeout(() => { if(st){ st.armed = true; startDrag(what(), e.clientX, e.clientY); try{ el.setPointerCapture(st.id); }catch(err){} } }, 280);
  });
  el.addEventListener('pointermove', e => {
    if(!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if(!DRAG && st.armed && Math.hypot(dx, dy) > 8){ startDrag(what(), e.clientX, e.clientY); try{ el.setPointerCapture(st.id); }catch(err){} }
    const scrollD = document.body.classList.contains('phone') ? Math.abs(dx) : Math.abs(dy);   /* the tray scrolls sideways on a phone */
    if(!DRAG && st.touch && scrollD > 10){ clearTimeout(timer); st = null; return; }
    if(DRAG) moveDrag(e.clientX, e.clientY);
  });
  const end = e => {
    clearTimeout(timer);
    if(!st) return;
    if(DRAG) endDrag(e.clientX, e.clientY);
    else if(Math.hypot(e.clientX - st.x, e.clientY - st.y) < 8) hold(what());
    st = null;
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', () => { clearTimeout(timer); if(DRAG) cancelDrag(); st = null; });
}
function startDrag(w, x, y){ DRAG = w; const g = $('#dragghost'); g.textContent = w.label; g.hidden = false; moveDrag(x, y); }
function moveDrag(x, y){
  const g = $('#dragghost'); g.style.left = x + 'px'; g.style.top = y + 'px';
  const over = overStage(x, y); $('#stage').classList.toggle('dragover', over);
  if(over && $('#view-3d').classList.contains('on')) ghostAt(DRAG, spotAt(x, y)); else ghostAt(null);
}
function endDrag(x, y){
  const w = DRAG; cancelDrag();
  if(!overStage(x, y)) return;
  drop(w, x, y);
}
function cancelDrag(){ DRAG = null; $('#dragghost').hidden = true; $('#stage').classList.remove('dragover'); ghostAt(null); }
function overStage(x, y){ const r = $('#stage').getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
function drop(w, x, y){
  if(w.clip !== undefined){ clipTo(w.clip, x, y); return; }
  const kind = P[w.type].kind, in3d = $('#view-3d').classList.contains('on');
  const spot = in3d && (kind === 'board' || kind === 'base') ? spotAt(x, y) : null;
  place(w.type, w.ver, spot);
}
function hold(w){
  holding = w;
  const h = $('#holding'); h.hidden = false;
  h.innerHTML = 'Holding: ' + w.label + ' — tap the table <button type="button">✕</button>';
  $('button', h).addEventListener('click', () => { holding = null; h.hidden = true; $$('.clip').forEach(c => c.classList.remove('held')); });
}
function releaseHold(){ holding = null; $('#holding').hidden = true; $$('.clip').forEach(c => c.classList.remove('held')); }
$('#view-schema').addEventListener('click', () => { if(holding && holding.type){ const w = holding; releaseHold(); place(w.type, w.ver, null); } });

/* ================================================================ status, pad, probes, selection */
function renderStatus(){
  $('#status').innerHTML = R.msgs.slice(0, 3).map(m => '<div class="msg ' + m[0] + '"><b class="i">' + ({ok:'✔', bad:'!', tip:'i'})[m[0]] + '</b><span>' + m[1] + '</span></div>').join('');
}
function potRow(who){
  const v = rpot[who] / 1e3;
  return '<div class="pot"><div class="pot-l">POT ' + who + ' <b data-potv="' + who + '">' + v.toFixed(1) + ' kΩ</b><small data-poti="' + who + '"></small></div>' +
    '<input type="range" min="0" max="10" step="0.1" value="' + v + '" data-pot="' + who + '" aria-label="Stimulator ' + who + ' pot (kΩ)"></div>';
}
function renderPad(){
  const pad = $('#pad');
  if(!R || !R.ok){ pad.hidden = true; return; }
  pad.hidden = false;
  const pulses = (who, list) => '<div class="pulses">' + list.map(T => '<button type="button" class="chip" data-pulse="' + who + '" data-t="' + T + '">' + (who === 'B' ? 'B ' : '') + (T >= 1 ? T + ' s' : T * 1e3 + ' ms') + '</button>').join('') + '</div>';
  const swb = (who, cls) => '<button type="button" class="swbig' + cls + '" data-sw="' + who + '" id="sw' + who + '">SW' + (R.hw === 3 ? ' ' + who : '') + '<small>HOLD</small></button>';
  let h;
  if(R.hw === 2) h = '<div class="padrow">' + potRow('A') + pulses('A', [0.01, 0.1, 1]) + swb('A', '') + '</div>';
  else {
    h = '<div class="padrow">' + potRow('A') + pulses('A', [0.02, 0.1]) +
      '<div class="train"><button type="button" class="chip" data-train>A × 2</button><select data-isi aria-label="Interval">' +
      [50, 100, 200, 500, 1000].map(v => '<option value="' + v + '"' + (v === isi ? ' selected' : '') + '>' + v + ' ms</option>').join('') + '</select></div>' + swb('A', ' sm') + '</div>';
    if(R.st.stimB) h += '<div class="padrow">' + potRow('B') + pulses('B', [0.01, 0.02]) + swb('B', ' b sm') + '</div>';
  }
  pad.innerHTML = h; potLabels();
  $$('[data-pot]', pad).forEach(i => i.addEventListener('input', () => { rpot[i.dataset.pot] = +i.value * 1e3; potLabels(); applyEngine(false); }));
  $$('[data-pulse]', pad).forEach(b => b.addEventListener('click', () => pressFor(b.dataset.pulse, +b.dataset.t)));
  $$('[data-sw]', pad).forEach(b => {
    const who = b.dataset.sw;
    b.addEventListener('pointerdown', e => { try{ b.setPointerCapture(e.pointerId); }catch(err){} pulseEnd[who] = null; setSW(who, true); });
    const up = () => { if(sw[who] && pulseEnd[who] === null) setSW(who, false); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  const tb = $('[data-train]', pad); if(tb) tb.addEventListener('click', () => train(2, isi, 0.02));
  const is = $('[data-isi]', pad); if(is) is.addEventListener('change', () => { isi = +is.value; });
}
function potLabels(){
  ['A', 'B'].forEach(w => {
    const v = $('[data-potv="' + w + '"]'), i = $('[data-poti="' + w + '"]'); if(!v) return;
    v.textContent = (rpot[w] / 1e3).toFixed(1) + ' kΩ';
    i.textContent = R.hw === 2 && R.st.src === 'ideal' ? 'ideal source' : '≈ ' + Math.round(0.56 / (rpot[w] + 7e3) * 1e6) + ' µA';
  });
}
window.addEventListener('keydown', e => { if(e.code === 'Space' && !e.repeat && e.target === document.body && !$('#scr-game').hidden){ e.preventDefault(); pulseEnd.A = null; setSW('A', true); } });
window.addEventListener('keyup', e => { if(e.code === 'Space' && e.target === document.body && sw.A){ e.preventDefault(); setSW('A', false); } });

function nodeLabel(n){
  if(!n) return 'OFF';
  const m = {'Vm':'Vm', 'SO.S':'SO.S', 'FI.E4':'FI.E4', 'A.Vm':'Pre Vm', 'B.Vm':'Post Vm', 'SY.S':'Synapse S', 'A.SO.S':'Pre SO.S', 'B.SO.S':'Post SO.S'};
  if(m[n]) return m[n];
  if(/^PC\d/.test(n)) return 'unit ' + n.slice(2);
  if(/^P\d/.test(n)) return 'unit #' + n.slice(1);
  return n;
}
function renderClips(){
  $('#clip1').textContent = nodeLabel(probes[0]); $('#clip2').textContent = nodeLabel(probes[1]);
  SCOPE.setLabels([nodeLabel(probes[0]), probes[1] ? nodeLabel(probes[1]) : '']);
}
$$('.clip').forEach(c => {
  const ch = +c.dataset.clip;
  dragSource(c, () => ({clip:ch, label:'CH' + (ch + 1) + ' clip'}));
});
function clipTo(ch, x, y){
  if(!$('#view-3d').classList.contains('on')){ toast('Switch to 3D to clip a probe on a board'); return; }
  const id = pickAt(x, y);
  if(!id){ if(ch === 1){ probes[1] = ''; afterProbe(); toast('CH2 off'); } return; }
  const n = R.boardNode[id];
  if(!n){ toast('That board is not part of the circuit'); return; }
  probes[ch] = n; afterProbe(); toast('CH' + (ch + 1) + ' → ' + nodeLabel(n));
}
function afterProbe(){ applyEngine(false); SCOPE.clear(); renderClips(); build3D(); if(SCH) syncSchema(); if(MODE === 'campaign') checkLive(); }

function select(id){ selId = id; renderSel(); highlight3D(); }
function renderSel(){
  const sp = $('#selpanel'), f = selId ? SL.find(A, selId) : null;
  if(!f){ sp.hidden = true; return; }
  const p = f.p, PT = P[p.type], v = SL.verOf(p);
  sp.hidden = false; sp.style.setProperty('--pc', PT.color);
  $('#sp-name').textContent = PT.name; $('#sp-desc').textContent = v.desc;
  const free = MODE === 'free';
  let vh = '';
  if(free && PT.vers.length > 1){
    let last = '';
    PT.vers.forEach(x => {
      const g = x.grp;
      if(g !== last){ vh += '<div class="g">' + g + '</div>'; last = g; }
      vh += '<button type="button" data-v="' + x.id + '"' + (x.id === p.ver ? ' class="on"' : '') + ' title="' + x.desc + '">' + x.label + (x.my ? ' ★' : '') + '</button>';
    });
    vh += '<div class="g my">★ = MY BUILD (our real board)</div>';
  }
  $('#sp-vers').innerHTML = vh;
  let th = '';
  let keys = v.tune || [];
  if(p.type === 'passive' && keys.length) keys = /Vm$/.test(R.boardNode[p.id] || '') ? ['rb'] : ['ru'];
  if(free) keys.forEach(k => {
    const t = SL.tn(k), val = p.tune[k] !== undefined ? p.tune[k] : SL.DEF[k];
    th += '<div class="tr"><div class="tl"><span>' + label(k) + '</span><span data-tv="' + k + '">' + fmt(val, t.unit) + '</span></div>' +
      '<input type="range" min="' + t.min + '" max="' + t.max + '" step="' + t.step + '" value="' + val + '" data-tune="' + k + '"><p>' + t.en + '</p></div>';
  });
  $('#sp-tune').innerHTML = th;
  $('#sp-left').hidden = $('#sp-right').hidden = !(f.where === 'stack' || f.where === 'base');
  $('#sp-del').hidden = MODE === 'campaign' && LV && LV.kind !== 'build' && LV.kind !== 'tutorial' && !(LV.require);
}
function label(k){ return ({rxv:'Q_pass E–B resistor', r13p:'Across R13', rf:'R13 → FI.E3', rs:'Across SO C1', rb:'V+ → Vm', ru:'V+ → each unit', r1p:'Across the 820 kΩ', isrc:'Source current'})[k] || k; }
function fmt(v, u){ if(u === 'A') return (v * 1e6).toFixed(0) + ' µA'; return v >= 1e6 ? +(v / 1e6).toFixed(2) + ' MΩ' : +(v / 1e3).toFixed(1) + ' kΩ'; }
$('#sp-vers').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b || !selId) return;
  const f = SL.find(A, selId); f.p.ver = b.dataset.v; f.p.tune = {}; custom = true; fresh.add(f.p.id); changed(false);
});
$('#sp-tune').addEventListener('input', e => {
  const i = e.target.closest('[data-tune]'); if(!i || !selId) return;
  const f = SL.find(A, selId), k = i.dataset.tune; f.p.tune[k] = +i.value; custom = true;
  $('[data-tv="' + k + '"]').textContent = fmt(+i.value, SL.tn(k).unit);
  R = SL.analyze(A); applyEngine(false); if(SCH) syncSchema(); renderCT();
});
$('#sp-x').addEventListener('click', () => select(null));
$('#sp-del').addEventListener('click', () => { if(!selId) return; SL.remove(A, selId); selId = null; changed(true); });
$('#sp-left').addEventListener('click', () => { const m = selId && SL.move(A, selId, -1); if(m) toast(m); else { fresh.add(selId); changed(true); } });
$('#sp-right').addEventListener('click', () => { const m = selId && SL.move(A, selId, 1); if(m) toast(m); else { fresh.add(selId); changed(true); } });

/* blueprint + clear (free build) */
const BP = [['c22', '#2-2 Active'], ['c21', '#2-1 Passive'], ['c23:1', '#2-3 n = 1'], ['c23:2', '#2-3 n = 2'], ['c23:4', '#2-3 n = 4'], ['c31', '#3-1 Excitatory → passive'], ['c32', '#3-2 Excitatory → active'], ['c33', '#3-3 Inhibitory → passive'], ['c34', '#3-4 Inhibitory → active'], ['empty', 'Empty table']];
$('#blueprint').innerHTML = '<option value="">Load…</option>' + BP.map(b => '<option value="' + b[0] + '">' + b[1] + '</option>').join('');
$('#blueprint').addEventListener('change', e => {
  const v = e.target.value; e.target.value = ''; if(!v) return;
  if(v === 'empty') A = SL.empty();
  else { const [cid, n] = v.split(':'); A = SL.build(cid, {n:n === undefined ? 4 : +n}); }
  markFresh(); selId = null; R = SL.analyze(A); applyType(false); changed(true); toast(BP.find(b => b[0] === v)[1]);
});
$('#btn-clear').addEventListener('click', () => { A = SL.empty(); selId = null; changed(true); toast('Table cleared'); });

let toastT = 0;
function toast(m){ if(!m) return; const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1700); }

/* panels and views */
$$('.seg[role="tablist"] button').forEach(b => b.addEventListener('click', () => {
  $$('.seg[role="tablist"] button').forEach(x => x.classList.toggle('on', x === b));
  $('#view-3d').classList.toggle('on', b.dataset.view === '3d'); $('#view-schema').classList.toggle('on', b.dataset.view === 'schema');
  if(b.dataset.view === 'schema') drawSchema(); else resize3D();
}));
function togglePanel(cls, tab, open, close){ const c = document.body.classList.toggle(cls); tab.textContent = c ? open : close; setTimeout(() => { resize3D(); fitScope(); }, 420); }
$('#tab-drawer').addEventListener('click', () => togglePanel('dclosed', $('#tab-drawer'), '▶', '◀'));
$('#tab-bay').addEventListener('click', () => togglePanel('bclosed', $('#tab-bay'), '◀', '▶'));
if(innerWidth < 860){ document.body.classList.add('dclosed', 'bclosed'); $('#tab-drawer').textContent = '▶'; $('#tab-bay').textContent = '◀'; }

/* ---------------- phones: landscape only, a game HUD ----------------
   portrait -> a full-screen "rotate" card (plus a fullscreen + landscape-lock button where the browser allows it).
   landscape: the bench fills the screen; parts = a tray at the bottom left; SW pad at the bottom right;
   the scope = a mini screen top right (tap to enlarge); view / blueprint / clear in the ⚙ menu. */
const FORCE_PHONE = /[?&]phone=1/.test(location.search);
function isPhone(){ return FORCE_PHONE || (Math.min(innerWidth, innerHeight) <= 540 && matchMedia('(pointer:coarse)').matches); }
const menu = document.createElement('div'); menu.className = 'phonemenu'; menu.id = 'phonemenu'; menu.hidden = true; $('#scr-game').appendChild(menu);
const homeOf = new Map();
function setPhone(){
  const ph = isPhone(), portrait = innerHeight > innerWidth;
  document.body.classList.toggle('phone', ph);
  document.body.classList.toggle('phone-portrait', ph && portrait);
  const movers = [$('.seg[role="tablist"]'), $('#bpwrap'), $('#btn-clear')];
  movers.forEach(el => {
    if(!homeOf.has(el)) homeOf.set(el, {parent:el.parentNode, next:el.nextSibling});
    if(ph && el.parentNode !== menu) menu.appendChild(el);
    if(!ph && el.parentNode === menu){ const h = homeOf.get(el); h.parent.insertBefore(el, h.next); }
  });
  if(!ph){ menu.hidden = true; document.body.classList.remove('scopebig'); }
  if(ph && !$('#goal').hidden && !lvState?.phoneGoalOpen) $('#goal').classList.add('mini');
  setTimeout(() => { resize3D(true); fitScope(); }, 60);
}
$('#btn-menu').addEventListener('click', () => { menu.hidden = !menu.hidden; });
menu.addEventListener('click', e => { if(e.target.closest('button') && !e.target.closest('.seg')) menu.hidden = true; });
$('#scope-catch').addEventListener('click', () => { document.body.classList.add('scopebig'); setTimeout(fitScope, 30); });
$('#scope-close').addEventListener('click', () => { document.body.classList.remove('scopebig'); setTimeout(fitScope, 30); });
$('#btn-rotate').addEventListener('click', async () => {
  try{ await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); }
  catch(e){ toast('Turn your phone sideways'); }
});
window.addEventListener('resize', setPhone);
window.addEventListener('orientationchange', setPhone);
setPhone();

/* ================================================================ oscilloscope */
const SCOPE = Scope($('#scope'));
function fitScope(){
  let w = $('#scopefit').clientWidth; if(!w) return;
  if(document.body.classList.contains('scopebig')) w = Math.min(w, (innerHeight - 64) * 566 / 380);
  const s = Math.min(1.2, w / 566);
  $('#scope').firstChild.style.transform = 'scale(' + s + ')'; $('#scopefit').style.height = Math.round(380 * s) + 'px';
}
new ResizeObserver(fitScope).observe($('#scopefit'));
function renderMeas(){
  const m = SCOPE.measure(), f = v => v === undefined || v === null ? '—' : v.toFixed(3) + ' V';
  const cell = (c, k, l) => '<div><b>CH' + c + ' ' + l + '</b>' + (m['c' + c] ? f(m['c' + c][k]) : '—') + '</div>';
  $('#meas').innerHTML = cell(1, 'max', 'MAX') + cell(1, 'min', 'MIN') + cell(1, 'pp', 'Vpp') + cell(2, 'max', 'MAX') + cell(2, 'min', 'MIN') + cell(2, 'pp', 'Vpp');
}

/* ================================================================ schematic view */
let SCH = null;
const ZH = [
  ['V+ 飛線到 FI（Passive 底板沒串 V+）', 'V+ flywire to FI (base boards do not carry V+)'], ['V+（疊接排針，Stimulator → FI）', 'V+ (stacked header, Stimulator → FI)'],
  ['GND（Stimulator 的 −，示波器地線夾這裡）', 'GND (Stimulator −, scope ground clip)'], ['GND（Extracellular，接在 Stimulator 的 −）', 'GND (extracellular, to Stimulator −)'],
  ['GND（Extracellular，兩列是同一條，接在兩個 Stimulator 的 −）', 'GND (extracellular, both rows, to both Stimulators −)'],
  ['電子（逆著電流、往電池 + 極走；越快＝電流越大）', 'electrons (against the current; faster = more current)'], ['（active 端細胞外）', '(active-end extracellular)'],
  ['突觸輸出 → #1（和 Stimulator B 接在同一點）', 'synapse output → #1 (same node as Stimulator B)'], ['突觸輸出 → Post Vm', 'synapse output → Post Vm'],
  ['active membrane：HW2 真正的 AP', 'active membrane: HW2 true AP'], ['active membrane：原版', 'active membrane: kit'],
  ['V+（排針，同 Stimulator A 電池）', 'V+ (header, Stimulator A battery)'], ['V 電池（講義圖）', 'V battery (handout)'], ['拔掉（開路）', 'removed (open)'],
  ['和原版電路不同', 'differs from the kit'], ['理想電流源', 'ideal current source'], ['切換接點', 'toggle contact'], ['FI 自帶', 'FI own'],
  ['拔掉', 'removed'], ['跳線', 'jumper'], ['獨立', 'own'], ['電池', 'battery'], ['斷開', 'open'], ['並', '∥'], ['　', '  ']
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
  if(!R || !R.ok){ wrap.classList.add('none'); SCH = null; svg.innerHTML = ''; return; }
  wrap.classList.remove('none');
  SCH = R.hw === 3 ? SynSchematic(svg, {syn:R.st.syn, post:R.st.post}) : MembraneSchematic(svg, {live:true, chain:R.st.chain, lk2:R.st.lk2});
  syncSchema(); english(svg);
}
function syncSchema(){
  if(!SCH) return;
  if(R.hw === 3){ SCH.setState(Object.assign({}, ENG.E.st, {MEM:ENG.E.MEM})); SCH.setProbes([probes[0], probes[1]]); return; }
  const st = Object.assign({}, BASE2, R.st, {sw:ENG.E.st.sw});
  SCH.setContacts(st); SCH.setQsense(st.qs); SCH.setResistors(st.r13, st.rfe, st.so_r2); SCH.setAddons(st);
  SCH.setSupply(st.fi_supply); SCH.setSource(st.src); SCH.setBoards({lk:st.leak, fi:st.fi_on, so:st.so_on}); SCH.setProbes([probes[0], probes[1]]);
}

/* ================================================================ 3D bench */
const canvas = $('#c3d');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
camera.position.set(0.4, 9.5, 9.0);
const controls = new OrbitControls(camera, canvas);
controls.target.set(-0.2, 0.7, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 4; controls.maxDistance = 46; controls.update();
scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x4a3420, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(4, 13, 7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left:-10, right:10, top:7, bottom:-7, near:1, far:40}); sun.shadow.bias = -0.0005; scene.add(sun);

const SPX = i => -5.25 + i * 0.95, DOCKX = -6.75, BW = 0.78, BL = 2.3, BT = 0.05, PITCH = 0.42, BASEY = 0.15;
function surfY(i){ return SL.baseAt(A, i) ? BASEY + BT / 2 : 0; }
function boardY(i, j){ return surfY(i) + PITCH + j * PITCH; }
function canvasTex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const table = new THREE.Mesh(new THREE.BoxGeometry(16.5, 0.7, 7.4), new THREE.MeshStandardMaterial({color:0x9a6537, roughness:.8,
  map:canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#a56d3c'; g.fillRect(0, 0, w, h);
    for(let i = 0; i < 40; i++){ g.strokeStyle = 'rgba(70,40,15,' + (0.08 + Math.random() * .12) + ')'; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + 8 - Math.random() * 16, 2 * w / 3, y + 8 - Math.random() * 16, w, y); g.stroke(); } })}));
table.position.y = -0.36; table.receiveShadow = true; scene.add(table);
const drawMat = (g, w, h) => {
  g.fillStyle = '#1f2a33'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
  for(let x = 0; x < w; x += 20){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for(let y = 0; y < h; y += 20){ g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  const px = x => (x + 7.6) * 100, pz = z => (z + 3.1) * 100;
  g.setLineDash([12, 9]); g.lineWidth = 4; g.textAlign = 'center';
  for(let i = 0; i < NSP; i++){ g.strokeStyle = 'rgba(255,230,140,.45)'; g.strokeRect(px(SPX(i) - 0.43), pz(-1.25), 86, 250); }
  g.font = '40px "Lilita One", sans-serif'; g.fillStyle = 'rgba(255,230,140,.6)';
  for(let i = 0; i < NSP; i++) g.fillText(String(i + 1), px(SPX(i)), pz(1.75));
  g.strokeStyle = 'rgba(255,170,80,.85)'; g.strokeRect(px(DOCKX - 0.55), pz(-1.0), 110, 200);
  g.fillStyle = 'rgba(255,170,80,.9)'; g.font = '26px "Lilita One", sans-serif'; g.fillText('POWER', px(DOCKX), pz(1.42)); g.fillText('DOCK', px(DOCKX), pz(1.7));
  g.setLineDash([]); g.font = '30px "Lilita One", sans-serif'; g.fillStyle = 'rgba(255,255,255,.3)'; g.textAlign = 'left';
  g.fillText('SPIKE LAB  ·  boards stack on a spot, the Stimulator on top  ·  base boards link their sockets', 24, 44);
};
const mat = new THREE.Mesh(new THREE.PlaneGeometry(15.2, 6.2), new THREE.MeshStandardMaterial({roughness:.95, map:canvasTex(1520, 620, drawMat)}));
mat.rotation.x = -Math.PI / 2; mat.position.y = 0.002; mat.receiveShadow = true; scene.add(mat);
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const G = {
  pcb:new THREE.BoxGeometry(BW, BT, BL), pin:new THREE.BoxGeometry(0.03, PITCH - 0.02, 0.03), h22:new THREE.BoxGeometry(0.24, 0.13, 0.24), h12:new THREE.BoxGeometry(0.13, 0.13, 0.24),
  res:new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12), lead:new THREE.BoxGeometry(0.4, 0.014, 0.014), band:new THREE.CylinderGeometry(0.047, 0.047, 0.025, 12),
  to92:new THREE.CylinderGeometry(0.085, 0.085, 0.18, 16, 1, false, 0, Math.PI), capE:new THREE.CylinderGeometry(0.12, 0.12, 0.28, 18), capF:new THREE.BoxGeometry(0.26, 0.22, 0.12),
  capC:new THREE.CylinderGeometry(0.1, 0.1, 0.05, 18), tact:new THREE.BoxGeometry(0.26, 0.12, 0.26), stem:new THREE.CylinderGeometry(0.055, 0.055, 0.22, 14),
  potB:new THREE.BoxGeometry(0.3, 0.2, 0.28), knob:new THREE.CylinderGeometry(0.1, 0.11, 0.32, 20), diode:new THREE.CylinderGeometry(0.035, 0.035, 0.18, 10),
  bat:new THREE.BoxGeometry(0.9, 1.35, 0.55), batT:new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12), cell:new THREE.CylinderGeometry(0.12, 0.12, 0.5, 18),
  glow:new THREE.BoxGeometry(BW + 0.14, BT + 0.1, BL + 0.14), clip:new THREE.ConeGeometry(0.12, 0.3, 14)
};
const Mt = {
  side:new THREE.MeshStandardMaterial({color:0x173f93, roughness:.55}), gold:new THREE.MeshStandardMaterial({color:0xd8b25a, metalness:.8, roughness:.3}),
  black:new THREE.MeshStandardMaterial({color:0x151515, roughness:.5}), resB:new THREE.MeshStandardMaterial({color:0x8fc3f0, roughness:.5}),
  band1:new THREE.MeshStandardMaterial({color:0x6b3e1f}), band2:new THREE.MeshStandardMaterial({color:0x111111}), band3:new THREE.MeshStandardMaterial({color:0xd4a017}),
  mod:new THREE.MeshStandardMaterial({color:0xff4fd0, emissive:0x8a0f6c, emissiveIntensity:.8, roughness:.4}), lead:new THREE.MeshStandardMaterial({color:0xcfd4da, metalness:.9, roughness:.3}),
  capE:new THREE.MeshStandardMaterial({color:0x2f5fd0, roughness:.4}), capF:new THREE.MeshStandardMaterial({color:0xf2c632, roughness:.5}), capC:new THREE.MeshStandardMaterial({color:0xf2b632, roughness:.45}),
  silver:new THREE.MeshStandardMaterial({color:0xc9ced6, metalness:.75, roughness:.3}), knob:new THREE.MeshStandardMaterial({color:0x1b1b1b, roughness:.6}),
  diode:new THREE.MeshStandardMaterial({color:0xe07b2a, roughness:.25, transparent:true, opacity:.85}), bat:new THREE.MeshStandardMaterial({color:0x262626, roughness:.55}),
  wire:new THREE.MeshStandardMaterial({color:0xe5372b, roughness:.45}), wireB:new THREE.MeshStandardMaterial({color:0x202020, roughness:.45}), white:new THREE.MeshStandardMaterial({color:0xf2f2f2, roughness:.5}),
  cell:new THREE.MeshStandardMaterial({color:0x7bb33a, roughness:.45}),
  glow:new THREE.MeshBasicMaterial({color:0x7cffb2, transparent:true, opacity:.35, depthWrite:false}),
  ghost:new THREE.MeshBasicMaterial({color:0xffe066, transparent:true, opacity:.35, depthWrite:false}),
  c1:new THREE.MeshStandardMaterial({color:0xffe14d, emissive:0x806a00, emissiveIntensity:.6}), c2:new THREE.MeshStandardMaterial({color:0x4de4ff, emissive:0x00606f, emissiveIntensity:.6})
};
const texCache = {};
function silk(key, w, h, draw){ return texCache[key] || (texCache[key] = new THREE.MeshStandardMaterial({roughness:.5, map:canvasTex(w, h, draw)})); }
function pcbBase(g, w, h){
  g.fillStyle = '#1d4fb5'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,170,255,.35)'; g.lineWidth = 5;
  for(let i = 0; i < 6; i++){ g.beginPath(); g.moveTo(10 + i * 28, 20); g.lineTo(10 + i * 28, h * .4 + i * 12); g.lineTo(w - 12, h * .55 + i * 14); g.stroke(); }
}
function boardTop(p){
  const v = SL.verOf(p), PT = P[p.type];
  return silk('b:' + p.type + ':' + p.ver, 160, 470, (g, w, h) => {
    pcbBase(g, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
    g.fillStyle = '#f4f4f4'; g.font = '34px "Nunito", sans-serif'; g.textAlign = 'center'; g.fillText(PT.silk || PT.name, 0, -26);
    g.font = '17px "Nunito", sans-serif'; g.fillText('Extracellular', -160, 62); g.fillText('Intracellular', 160, 62);
    g.font = '26px "Lilita One", sans-serif'; g.fillStyle = v.grp === 'IDEAL' ? '#ff6fe0' : '#fff3a0'; g.fillText(v.my ? v.label + ' ★' : v.label, 0, 62);
    g.restore();
  });
}
const BOARD = new THREE.Group(); scene.add(BOARD);
let PICK = [], SW3 = {}, GHOST = null, GLOW = null, CLIPS = [];
const animT0 = new Map();

function addRes(g, x, z, rot, mod){
  const r = new THREE.Mesh(G.res, mod ? Mt.mod : Mt.resB); r.rotation.z = Math.PI / 2; r.position.set(x, BT / 2 + 0.06, z); r.rotation.y = rot || 0; r.castShadow = true; g.add(r);
  const l = new THREE.Mesh(G.lead, Mt.lead); l.position.set(x, BT / 2 + 0.06, z); l.rotation.y = rot || 0; g.add(l);
  if(!mod) [-0.07, 0, 0.07].forEach((o, k) => { const b = new THREE.Mesh(G.band, [Mt.band1, Mt.band2, Mt.band3][k]); b.rotation.z = Math.PI / 2; b.rotation.y = rot || 0;
    b.position.set(x + Math.cos(rot || 0) * o, BT / 2 + 0.06, z - Math.sin(rot || 0) * o); g.add(b); });
}
function addTr(g, x, z){ const t = new THREE.Mesh(G.to92, Mt.black); t.position.set(x, BT / 2 + 0.09, z); t.castShadow = true; g.add(t); }
function addDiode(g, x, z){ const d = new THREE.Mesh(G.diode, Mt.diode); d.rotation.z = Math.PI / 2; d.position.set(x, BT / 2 + 0.04, z); g.add(d); }
function headers(g, below){
  const a = new THREE.Mesh(G.h22, Mt.black); a.position.set(0, BT / 2 + 0.065, -BL / 2 + 0.2); a.castShadow = true; g.add(a);
  const b = new THREE.Mesh(G.h12, Mt.black); b.position.set(0, BT / 2 + 0.065, BL / 2 - 0.2); b.castShadow = true; g.add(b);
  if(below) [[-0.06, -BL / 2 + 0.14], [0.06, -BL / 2 + 0.14], [-0.06, -BL / 2 + 0.26], [0.06, -BL / 2 + 0.26], [-0.03, BL / 2 - 0.2], [0.03, BL / 2 - 0.2]].forEach(([x, z]) => {
    const pn = new THREE.Mesh(G.pin, Mt.gold); pn.position.set(x, -PITCH / 2, z); g.add(pn); });
}
function makeBoard(p){
  const g = new THREE.Group(), top = boardTop(p);
  const pcb = new THREE.Mesh(G.pcb, [Mt.side, Mt.side, top, Mt.side, Mt.side, Mt.side]); pcb.castShadow = true; pcb.receiveShadow = true; g.add(pcb);
  headers(g, true);
  const t = p.type, ideal = SL.verOf(p).grp === 'IDEAL';
  if(t === 'stim'){
    const tb = new THREE.Mesh(G.tact, Mt.silver); tb.position.set(-0.17, BT / 2 + 0.06, -0.55); g.add(tb);
    const st = new THREE.Mesh(G.stem, Mt.knob); st.position.set(-0.17, BT / 2 + 0.2, -0.55); st.userData = {sw:true, y0:BT / 2 + 0.2}; st.castShadow = true; g.add(st); g.userData.stem = st;
    const pb = new THREE.Mesh(G.potB, Mt.silver); pb.position.set(0.1, BT / 2 + 0.1, 0.12); g.add(pb);
    const kn = new THREE.Mesh(G.knob, Mt.knob); kn.position.set(0.1, BT / 2 + 0.36, 0.12); kn.castShadow = true; g.add(kn);
    addTr(g, -0.2, 0.62); addTr(g, 0.2, 0.78); addRes(g, -0.05, -0.88, 0); addRes(g, 0, 0.95, 0);
    if(p.ver === 'add') addRes(g, 0.2, -0.2, Math.PI / 2, true);
    if(p.ver === 'bb'){ const bb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.7), new THREE.MeshStandardMaterial({color:0xf3f0e6})); bb.position.set(0, BT / 2 + 0.03, 0.12); bb.userData.dispose = true; g.add(bb); }
    if(p.ver === 'src') addRes(g, 0.2, -0.2, Math.PI / 2, true);
  } else if(t === 'leak'){
    const f = new THREE.Mesh(G.capF, Mt.capF); f.position.set(0, BT / 2 + 0.11, -0.25); f.castShadow = true; g.add(f);
    addRes(g, 0, 0.35, 0); if(ideal) addRes(g, 0, 0.75, 0, true);
  } else if(t === 'passive'){
    const c = new THREE.Mesh(G.capC, Mt.capC); c.rotation.x = Math.PI / 2; c.position.set(0, BT / 2 + 0.13, -0.05); g.add(c);
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.012), Mt.lead); l1.position.set(-0.04, BT / 2 + 0.06, -0.05); l1.userData.dispose = true; g.add(l1);
    addRes(g, 0, 0.4, 0); if(ideal) addRes(g, 0, 0.75, 0, true);
  } else if(t === 'fi'){
    addTr(g, -0.17, -0.3); addTr(g, 0.17, 0.25); addDiode(g, 0, -0.75); addRes(g, 0, 0.65, 0); addRes(g, 0, 0.92, 0);
    if(p.ver === 'true'){ addRes(g, -0.2, 0.0, Math.PI / 2, true); addRes(g, 0.2, -0.65, Math.PI / 2, true); }
    if(p.ver === 'r13') addRes(g, 0, 0.65, 0, true);
  } else if(t === 'so'){
    addTr(g, -0.17, -0.25); addTr(g, 0.17, 0.3); addDiode(g, 0, -0.72);
    const c = new THREE.Mesh(G.capE, Mt.capE); c.position.set(-0.2, BT / 2 + 0.15, 0.7); c.castShadow = true; g.add(c);
    addRes(g, 0.1, 0.95, 0); if(ideal) addRes(g, 0.2, 0.62, Math.PI / 2, true);
  }
  g.traverse(o => { if(o.isMesh) o.userData.partId = o.userData.partId || p.id; });
  g.userData.partId = p.id;
  return g;
}
function makeBase(b){
  const PT = P[b.type], span = PT.span, w = span * 0.95 - 0.06, d = b.type === 'base' ? 2.75 : 2.6, g = new THREE.Group();
  const top = silk('base:' + b.type + ':' + b.ver, Math.round(w * 140), Math.round(d * 140), (cx, W, H) => {
    pcbBase(cx, W, H); cx.fillStyle = '#f4f4f4'; cx.textAlign = 'center';
    if(b.type === 'base'){ cx.font = '26px "Nunito", sans-serif'; cx.fillText('Extracellular Solution', W / 2, H - 16); cx.fillText('Intracellular Solution', W / 2, 30); }
    else {
      cx.font = '24px "Nunito", sans-serif'; cx.fillText(PT.silk, W / 2, H / 2 + 8);
      cx.save(); cx.translate(18, H / 2); cx.rotate(-Math.PI / 2); cx.font = '18px "Nunito", sans-serif'; cx.fillText('PreSynapse', 0, 0); cx.restore();
      cx.save(); cx.translate(W - 18, H / 2); cx.rotate(Math.PI / 2); cx.font = '18px "Nunito", sans-serif'; cx.fillText('PostSynapse', 0, 0); cx.restore();
      const v = SL.verOf(b); cx.font = '22px "Lilita One", sans-serif'; cx.fillStyle = v.grp === 'IDEAL' ? '#ff6fe0' : '#fff3a0'; cx.fillText(v.my ? v.label + ' ★' : v.label, W / 2, H / 2 + 40);
    }
  });
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(w, BT, d), [Mt.side, Mt.side, top, Mt.side, Mt.side, Mt.side]); pcb.userData.dispose = true; pcb.castShadow = true; pcb.receiveShadow = true; g.add(pcb);
  for(let k = 0; k < span; k++){
    const x = -w / 2 + 0.95 * k + 0.95 / 2 - 0.03;
    const a = new THREE.Mesh(G.h22, Mt.black); a.position.set(x, BT / 2 + 0.065, -BL / 2 + 0.2); g.add(a);
    const c = new THREE.Mesh(G.h12, Mt.black); c.position.set(x, BT / 2 + 0.065, BL / 2 - 0.2); g.add(c);
    if(b.type === 'base' && k < span - 1){ addRes(g, x + 0.475, -d / 2 + 0.18, 0); addRes(g, x + 0.475, d / 2 - 0.18, 0); }
  }
  if(b.type !== 'base'){
    const cx0 = 0;
    addRes(g, cx0, -0.55, Math.PI / 2); addDiode(g, cx0, -0.1); addTr(g, cx0 - 0.15, 0.3); addTr(g, cx0 + 0.15, 0.55);
    const c = new THREE.Mesh(G.capE, Mt.capE); c.position.set(cx0, BT / 2 + 0.15, 0.9); g.add(c);
    if(b.ver === 'mine' || b.ver === 'true') addRes(g, cx0 + 0.2, -0.55, Math.PI / 2, true);
  }
  [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]].forEach(([x, z]) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, BASEY, 8), Mt.gold); s.userData.dispose = true; s.position.set(x, -BASEY / 2, z); g.add(s); });
  g.traverse(o => { if(o.isMesh) o.userData.partId = b.id; });
  g.userData.partId = b.id;
  return {g, w};
}
function tube(a, b, h, m, r){
  const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + h;
  const curve = new THREE.CatmullRomCurve3([a, a.clone().setY(a.y + h * 0.4), mid, b.clone().setY(b.y + h * 0.4), b]);
  const t = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r || 0.04, 10, false), m); t.castShadow = true; t.userData.dispose = true; return t;
}
function build3D(){
  BOARD.traverse(o => { if(o.userData.dispose && o.geometry) o.geometry.dispose(); });
  BOARD.clear(); PICK = []; SW3 = {}; GLOW = null; CLIPS = [];
  const now = performance.now(), anim = (id, g) => { if(fresh.has(id)){ animT0.set(id, now); fresh.delete(id); } };
  A.bases.forEach(b => {
    const {g} = makeBase(b), span = P[b.type].span;
    g.position.set((SPX(b.at) + SPX(b.at + span - 1)) / 2, BASEY, 0); g.userData.y = BASEY; anim(b.id, g);
    if(!R.used[b.id]) g.rotation.y = 0.03;
    BOARD.add(g); PICK.push(g);
  });
  const stims = [];
  A.spots.forEach((s, i) => s.stack.forEach((p, j) => {
    const g = makeBoard(p); g.position.set(SPX(i), boardY(i, j), 0); g.userData.y = g.position.y; anim(p.id, g);
    if(!R.used[p.id]) g.rotation.y = 0.1;
    BOARD.add(g); PICK.push(g);
    if(p.type === 'stim' && j === s.stack.length - 1) stims.push({p, g, i});
  }));
  /* Stimulator SW mapping: A = the first (or the Pre side), B = the Post side */
  stims.forEach(s => { const isB = R.hw === 3 && R.boardNode[s.p.id] && R.boardNode[s.p.id] !== 'A.Vm'; SW3[isB ? 'B' : 'A'] = s.g.userData.stem; });
  if(A.battery){
    const v = SL.verOf(A.battery), g = new THREE.Group();
    const side = silk('bat:' + v.id, 180, 270, (cx, w, h) => { cx.fillStyle = '#262626'; cx.fillRect(0, 0, w, h); cx.fillStyle = '#ff9f1c'; cx.fillRect(0, 80, w, 110);
      cx.fillStyle = '#111'; cx.font = '58px "Lilita One", sans-serif'; cx.textAlign = 'center'; cx.fillText(v.label.replace(' ', ''), w / 2, 158); });
    const body = new THREE.Mesh(G.bat, [Mt.bat, Mt.bat, Mt.bat, Mt.bat, side, side]); body.castShadow = true; g.add(body);
    [-0.2, 0.2].forEach(x => { const t = new THREE.Mesh(G.batT, Mt.lead); t.position.set(x, 0.72, 0); g.add(t); });
    g.position.set(DOCKX, 0.68, 0); g.userData.y = 0.68; g.traverse(o => { if(o.isMesh) o.userData.partId = A.battery.id; }); g.userData.partId = A.battery.id; anim(A.battery.id, g);
    BOARD.add(g); PICK.push(g);
    stims.forEach(s => {
      const y = s.g.position.y + 0.03, x = SPX(s.i) - 0.2;
      BOARD.add(tube(new THREE.Vector3(DOCKX - 0.2, 1.42, 0), new THREE.Vector3(x, y, -BL / 2 + 0.05), 1.0, Mt.wire, 0.03));
      BOARD.add(tube(new THREE.Vector3(DOCKX + 0.2, 1.42, 0), new THREE.Vector3(x + 0.1, y, -BL / 2 + 0.05), 0.8, Mt.wireB, 0.03));
    });
  }
  if(A.wire){
    const st = stims[0], fiB = PICK.find(g => { const f = SL.find(A, g.userData.partId); return f && f.p.type === 'fi'; });
    const a = st ? new THREE.Vector3(st.g.position.x, st.g.position.y + 0.12, BL / 2 - 0.2) : new THREE.Vector3(SPX(1), 1, 1);
    const b = fiB ? new THREE.Vector3(fiB.position.x, fiB.position.y + 0.12, BL / 2 - 0.2) : new THREE.Vector3(SPX(4), 1, 1);
    const t = tube(a, b, 1.1, Mt.wire, 0.045), g = new THREE.Group(); g.add(t);
    t.userData.partId = A.wire.id; g.userData.partId = A.wire.id; g.userData.y = 0; BOARD.add(g); PICK.push(g);
  }
  const syn = A.bases.find(b => b.type === 'syni');
  if(syn && (A.cell || A.jumper)){
    const x = (SPX(syn.at) + SPX(syn.at + 1)) / 2, g = new THREE.Group(), it = A.cell || A.jumper;
    if(A.cell){ const c = new THREE.Mesh(G.cell, Mt.cell); c.rotation.z = Math.PI / 2; c.position.set(x, BASEY + 0.18, BL / 2 + 0.05); c.castShadow = true; g.add(c); }
    else g.add(tube(new THREE.Vector3(x - 0.25, BASEY + 0.05, BL / 2 + 0.05), new THREE.Vector3(x + 0.25, BASEY + 0.05, BL / 2 + 0.05), 0.25, Mt.white, 0.03));
    g.traverse(o => { if(o.isMesh) o.userData.partId = it.id; }); g.userData.partId = it.id; g.userData.y = 0; BOARD.add(g); PICK.push(g);
  }
  /* probe clips: a coloured cone over the first board on each probed node */
  [0, 1].forEach(c => {
    if(!probes[c]) return;
    const id = Object.keys(R.boardNode).find(k => R.boardNode[k] === probes[c]); if(!id) return;
    const g = PICK.find(x => x.userData.partId === +id); if(!g) return;
    const m = new THREE.Mesh(G.clip, c ? Mt.c2 : Mt.c1); m.rotation.x = Math.PI; m.position.set(g.position.x + (c ? 0.22 : -0.22), g.position.y + 0.45, BL / 2 - 0.45);
    m.userData.bob = m.position.y; BOARD.add(m); CLIPS.push(m);
  });
  highlight3D();
  resize3D();
}
function highlight3D(){
  if(GLOW){ GLOW.parent && GLOW.parent.remove(GLOW); GLOW = null; }
  if(!selId) return;
  const g = PICK.find(x => x.userData.partId === selId); if(!g) return;
  const f = SL.find(A, selId); if(!f || f.where === 'wire' || f.where === 'cell' || f.where === 'jumper') return;
  if(f.where === 'base'){ const w = P[f.p.type].span * 0.95; GLOW = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 2.9), Mt.glow); GLOW.userData.dispose = true; }
  else if(f.where === 'battery'){ GLOW = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.5, 0.7), Mt.glow); GLOW.userData.dispose = true; }
  else GLOW = new THREE.Mesh(G.glow, Mt.glow);
  g.add(GLOW);
}
function ghostAt(w, spot){
  if(GHOST){ scene.remove(GHOST); if(GHOST.userData.dispose) GHOST.geometry.dispose(); GHOST = null; }
  if(!w || w.clip !== undefined) return;
  const k = P[w.type].kind;
  if(k === 'dock'){ GHOST = new THREE.Mesh(G.bat, Mt.ghost); GHOST.position.set(DOCKX, 0.68, 0); }
  else if(k === 'base'){ if(spot === null) return; const sp = P[w.type].span; GHOST = new THREE.Mesh(new THREE.BoxGeometry(sp * 0.95 - 0.06, 0.06, 2.7), Mt.ghost); GHOST.userData.dispose = true; GHOST.position.set((SPX(spot) + SPX(Math.min(NSP - 1, spot + sp - 1))) / 2, BASEY, 0); }
  else if(k === 'board'){ if(spot === null) return; GHOST = new THREE.Mesh(G.pcb, Mt.ghost); GHOST.position.set(SPX(spot), boardY(spot, A.spots[spot].stack.length), 0); }
  else return;
  scene.add(GHOST);
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function rayAt(x, y){
  const r = canvas.getBoundingClientRect();
  ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
  camera.updateMatrixWorld(); BOARD.updateMatrixWorld(true);
  ray.setFromCamera(ndc, camera);
}
function spotAt(x, y){
  rayAt(x, y); const hit = new THREE.Vector3();
  if(!ray.ray.intersectPlane(plane, hit) || Math.abs(hit.z) > 2.4) return null;
  let best = null, bd = 0.6;
  for(let i = 0; i < NSP; i++){ const d = Math.abs(hit.x - SPX(i)); if(d < bd){ bd = d; best = i; } }
  return best;
}
function pickAt(x, y){
  rayAt(x, y);
  const h = ray.intersectObjects(PICK, true).filter(k => k.object.material !== Mt.glow);
  return h.length ? h[0].object.userData.partId || null : null;
}
let down = null;
canvas.addEventListener('pointerdown', e => {
  down = {x:e.clientX, y:e.clientY};
  rayAt(e.clientX, e.clientY);
  for(const who of ['A', 'B']){
    const st = SW3[who]; if(!st) continue;
    if(ray.intersectObject(st, false).length){ controls.enabled = false; pulseEnd[who] = null; setSW(who, true); down.sw = who; try{ canvas.setPointerCapture(e.pointerId); }catch(err){} return; }
  }
});
canvas.addEventListener('pointerup', e => {
  if(!down) return;
  if(down.sw){ setSW(down.sw, false); controls.enabled = true; down = null; return; }
  if(Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6){
    if(holding){
      const w = holding; releaseHold();
      if(w.clip !== undefined) clipTo(w.clip, e.clientX, e.clientY);
      else drop(w, e.clientX, e.clientY);
    } else select(pickAt(e.clientX, e.clientY));
  }
  down = null;
});
canvas.addEventListener('pointermove', e => {
  if(down) return;
  rayAt(e.clientX, e.clientY);
  const over = Object.values(SW3).some(st => st && ray.intersectObject(st, false).length);
  canvas.style.cursor = over ? 'pointer' : holding ? 'copy' : 'grab';
  if(holding && holding.type) ghostAt(holding, spotAt(e.clientX, e.clientY));
});
$$('.clip').forEach(c => c.addEventListener('click', () => { if(!holding){ hold({clip:+c.dataset.clip, label:'CH' + (+c.dataset.clip + 1) + ' clip'}); c.classList.add('held'); } }));
function pressAnim(who, on){ const st = SW3[who]; if(st) st.position.y = st.userData.y0 - (on ? 0.07 : 0); }
/* frame what is on the table: from the power dock to the last used spot (at least spot 6) */
let fitKey = '';
function fitBounds(){
  let last = 5;
  A.spots.forEach((s, i) => { if(s.stack.length) last = Math.max(last, i); });
  A.bases.forEach(b => { last = Math.max(last, b.at + P[b.type].span - 1); });
  return [DOCKX - 0.6, SPX(last) + 0.6];
}
function resize3D(force){
  const w = canvas.clientWidth, h = canvas.clientHeight; if(!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  /* on a phone the bottom ~90 px are the parts tray and the SW pad: draw the bench higher, in the free area */
  const phone = document.body.classList.contains('phone'), lift = phone ? 46 : 0, hEff = h - 2 * lift;
  if(lift) camera.setViewOffset(w, h, 0, lift, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  const [x0, x1] = fitBounds(), key = x0 + ':' + x1 + ':' + w + 'x' + h + ':' + lift;
  if(key === fitKey && !force) return;
  fitKey = key;
  const cx = (x0 + x1) / 2, half = (x1 - x0) / 2 + 0.3;
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.set(cx, 0.6, 0);
  const vf = camera.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
  const d = Math.max(half / Math.tan(hf), 3.4 / Math.tan(vf)) * (phone ? h / Math.max(1, hEff) : 1);
  camera.position.copy(controls.target).addScaledVector(dir, Math.min(d, controls.maxDistance));
  controls.update();
}
new ResizeObserver(resize3D).observe($('#stage'));
const bounce = x => { const n = 7.5625, d = 2.75; if(x < 1 / d) return n * x * x; if(x < 2 / d) return n * (x -= 1.5 / d) * x + .75; if(x < 2.5 / d) return n * (x -= 2.25 / d) * x + .9375; return n * (x -= 2.625 / d) * x + .984375; };

/* ================================================================ campaign */
function kindTag(k){ return '<span class="kind ' + k + '">' + k.toUpperCase() + '</span>'; }
function renderGoal(){
  const g = $('#goal');
  if(MODE !== 'campaign' || !LV){ g.hidden = true; return; }
  g.hidden = false;
  let body = '';
  if(LV.kind === 'build') body = '<p>' + LV.goal + '</p><div class="row"><button type="button" class="chip" data-hint>HINT</button><span class="fb" data-fb></span></div>';
  else if(LV.kind === 'measure') body = '<p>' + LV.goal + '</p><div class="row"><input type="number" step="any" data-ans placeholder="your reading"><span class="unit">' + LV.measure.unit + '</span>' +
    '<button type="button" class="chip" data-submit>CHECK</button><button type="button" class="chip" data-hint>HINT</button></div><div class="fb" data-fb></div>';
  else if(LV.kind === 'explain') body = '<p>' + LV.quiz.q + '</p><div class="opts">' + shuffled(LV).map(i => '<button type="button" class="opt" data-opt="' + i + '">' + LV.quiz.opts[i] + '</button>').join('') + '</div><div class="fb" data-fb></div>';
  else body = '<p>' + LV.goal + '</p>';
  g.innerHTML = '<button type="button" class="min" data-min title="Fold">–</button><div class="gh"><span class="code">' + LV.code + '</span><b>' + LV.title + '</b>' + kindTag(LV.kind) + '</div>' + body + '<div data-hints></div>';
  $('[data-min]', g).addEventListener('click', () => { g.classList.toggle('mini'); $('[data-min]', g).textContent = g.classList.contains('mini') ? '+' : '–'; if(lvState) lvState.phoneGoalOpen = !g.classList.contains('mini'); });
  if(document.body.classList.contains('phone') && LV.kind !== 'explain' && LV.kind !== 'measure'){ g.classList.add('mini'); $('[data-min]', g).textContent = '+'; }
  const h = $('[data-hint]', g); if(h) h.addEventListener('click', showHint);
  const s = $('[data-submit]', g); if(s) s.addEventListener('click', submitMeasure);
  const inp = $('[data-ans]', g); if(inp) inp.addEventListener('keydown', e => { if(e.key === 'Enter') submitMeasure(); });
  $$('[data-opt]', g).forEach(b => b.addEventListener('click', () => answer(+b.dataset.opt, b)));
}
function shuffled(lv){ const n = lv.quiz.opts.length, a = [...Array(n).keys()], seed = lv.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0); return a.sort((x, y) => ((x * 7 + seed) % n) - ((y * 7 + seed) % n)); }
function showHint(){
  const H = LV.hints || []; if(!H.length) return;
  const box = $('[data-hints]', $('#goal')), k = Math.min(lvState.hints, H.length - 1);
  if(lvState.hints < H.length) lvState.hints++;
  box.innerHTML = H.slice(0, lvState.hints).map(t => '<div class="ghint">💡 ' + t + '</div>').join('');
  void k;
}
function fb(msg, ok){ const f = $('[data-fb]', $('#goal')); if(f){ f.textContent = msg; f.className = 'fb ' + (ok ? 'yes' : 'no'); } }
function stars(){ return Math.max(1, 3 - lvState.hints - (lvState.wrong >= 2 ? 1 : 0)); }
function sigOk(){
  if(!R || !R.sig || !A.battery) return false;
  return Object.keys(LV.sig).every(k => R.sig[k] === LV.sig[k]);
}
function checkLive(){
  if(!LV || lvState.done) return;
  if(LV.kind === 'build'){
    if(sigOk() && R.ok){ fb('That’s it!', true); win(); }
    else if(R.sig) fb('', true);
  }
}
function submitMeasure(){
  if(lvState.done) return;
  const inp = $('[data-ans]', $('#goal')), v = parseFloat(inp && inp.value);
  if(LV.require && !Object.keys(LV.require).every(k => R.sig && R.sig[k] === LV.require[k])){ fb(LV.requireMsg || 'Change the circuit first.', false); return; }
  const M = REC.last; if(!M){ fb('Press SW first: the answer is read from your own last stimulus.', false); return; }
  if(isNaN(v)){ fb('Type a number.', false); return; }
  const m = M[LV.measure.ch], truth = m[LV.measure.metric];
  if(!isFinite(truth)){ fb('That channel saw nothing — check the probe clip.', false); return; }
  const tol = Math.max(Math.abs(truth) * 0.1, LV.measure.unit === 'V' ? 0.02 : 2);
  if(Math.abs(v - truth) <= tol){ lvState.truth = truth; fb('✔ ' + truth.toFixed(3) + ' ' + LV.measure.unit, true); win(); }
  else { lvState.wrong++; fb('Not quite. ' + (v > truth ? 'Too high.' : 'Too low.') + ' Read the scope again (MAX / MIN under it).', false); }
}
function answer(i, b){
  if(lvState.done) return;
  if(i === LV.quiz.ans){ b.classList.add('good'); win(); }
  else { b.classList.add('bad'); lvState.wrong++; fb('Not this one. Try again.', false); }
}
function win(){
  if(lvState.done) return;
  lvState.done = true;
  const s = stars(), best = Math.max(s, progress.stars[LV.id] || 0);
  progress.stars[LV.id] = best; save();
  const idx = LEVELS.indexOf(LV), next = LEVELS[idx + 1];
  const why = LV.kind === 'explain' ? LV.quiz.why : LV.kind === 'measure' ? 'The simulation’s own value was ' + lvState.truth.toFixed(3) + ' ' + LV.measure.unit + ' (circuit type: ' + ({kit:'KIT', mine:'MY BUILD', ideal:'IDEAL'})[CT] + ').' : '';
  const w = $('#win');
  w.innerHTML = '<div class="card"><h2>' + (s === 3 ? 'PERFECT!' : 'CLEARED!') + '</h2><div class="bigstars">' + [1, 2, 3].map(k => '<span class="' + (k <= s ? 'on' : '') + '">★</span>').join('') + '</div>' +
    (why ? '<p>' + why + '</p>' : '<p>' + LV.code + ' done.</p>') + '<div class="btns">' +
    (next ? '<button type="button" class="chip" data-w="next">NEXT ▶</button>' : '') + '<button type="button" class="chip ghost" data-w="stay">KEEP PLAYING</button><button type="button" class="chip teal" data-w="map">MAP</button></div></div>';
  w.hidden = false;
  $$('[data-w]', w).forEach(b => b.addEventListener('click', () => {
    w.hidden = true;
    if(b.dataset.w === 'next') startLevel(next);
    if(b.dataset.w === 'map'){ renderMap(); show('scr-map'); }
  }));
}

/* tutorial: one spotlight at a time.  Everything outside the lit hole is dimmed and blocks input; the hole
   lets taps through to exactly the thing the step asks for.  Placing is two taps (card, then table), which
   works the same with a mouse and on a phone. */
const TUT = [
  {t:'Tap the <b>9 V Battery</b> in the <b>PARTS</b> panel (left, or the tray at the bottom on a phone).', el:() => $('.part[data-type="battery"]'), panel:'drawer', ok:() => (holding && holding.type === 'battery') || !!A.battery},
  {t:'Now tap anywhere on the <b>table</b>. A battery always goes to the <b>POWER DOCK</b> at the left end.', el:() => $('#stage'), ok:() => !!A.battery},
  {t:'Tap the <b>Passive Unit</b> card in the PARTS panel. Under a Stimulator it works as the membrane’s <b>leak</b> (100 kΩ ∥ 1 µF).', el:() => $('.part[data-type="passive"]'), panel:'drawer', ok:() => (holding && holding.type === 'passive') || A.spots.some(s => s.stack.some(p => p.type === 'passive'))},
  {t:'Tap the glowing <b>spot 4</b> on the table (the dashed box with the number 4).', el:() => $('#stage'), mark:3, ok:() => A.spots.some(s => s.stack.some(p => p.type === 'passive'))},
  {t:'Tap the <b>Stimulator</b> card in the PARTS panel.', el:() => $('.part[data-type="stim"]'), panel:'drawer', ok:() => (holding && holding.type === 'stim') || !!(R && R.ok)},
  {t:'Tap the <b>same spot</b> again. The Stimulator always lands on <b>top</b> of the stack.', el:() => $('#stage'), mark:'pu', ok:() => !!(R && R.ok)},
  {t:'Press and <b>hold</b> the big red <b>SW</b> button (bottom of the screen) for about a second, then let go.', el:() => $('#swA'), ok:() => lvState.tutPressed && !sw.A},
  {t:'This is the <b>oscilloscope</b>. The yellow trace is <b>Vm</b>: it rose while you pushed current in, then decayed back through the leak (τ = 100 ms). You just built a membrane!', el:() => $('#scopefit'), panel:'bay', next:true, ok:() => lvState.tutNext}
];
let tutOn = false, tutMark = null;
function startTutorial(){ tutOn = true; lvState.tutStep = 0; lvState.tutNext = false; $('#tut').hidden = false; tutRender(); }
function endTutorial(){
  tutOn = false; $('#tut').hidden = true;
  if(tutMark){ scene.remove(tutMark); tutMark = null; }
}
function openPanel(which){
  if(document.body.classList.contains('phone')) return;
  if(which === 'drawer' && document.body.classList.contains('dclosed')){ document.body.classList.remove('dclosed'); $('#tab-drawer').textContent = '◀'; }
  if(which === 'bay' && document.body.classList.contains('bclosed')){ document.body.classList.remove('bclosed'); $('#tab-bay').textContent = '▶'; }
  if(innerWidth < 860){                                   /* a phone: only one side panel at a time */
    if(which === 'drawer' && !document.body.classList.contains('bclosed')){ document.body.classList.add('bclosed'); $('#tab-bay').textContent = '◀'; }
    if(which === 'bay' && !document.body.classList.contains('dclosed')){ document.body.classList.add('dclosed'); $('#tab-drawer').textContent = '▶'; }
    if(!which){ document.body.classList.add('dclosed', 'bclosed'); $('#tab-drawer').textContent = '▶'; $('#tab-bay').textContent = '◀'; }
  }
  setTimeout(() => { resize3D(); fitScope(); }, 420);
}
function tutRender(){
  const s = TUT[lvState.tutStep];
  if(!s){ endTutorial(); win(); return; }
  openPanel(s.panel || null);
  $('#tutbox').innerHTML = '<div class="tut-h"><b>STEP ' + (lvState.tutStep + 1) + ' / ' + TUT.length + '</b><button type="button" class="tut-x" title="Leave the tutorial">✕</button></div><p>' + s.t + '</p>' +
    (s.next ? '<button type="button" class="chip" id="tut-next">GOT IT ▶</button>' : '');
  $('.tut-x', $('#tutbox')).addEventListener('click', () => { endTutorial(); renderMap(); show('scr-map'); });
  const n = $('#tut-next'); if(n) n.addEventListener('click', () => { lvState.tutNext = true; });
  if(tutMark){ scene.remove(tutMark); tutMark = null; }
  let spot = s.mark === 'pu' ? A.spots.findIndex(x => x.stack.some(p => p.type === 'passive')) : s.mark;
  if(spot !== undefined && spot !== null && spot >= 0){
    tutMark = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.04, 2.5), new THREE.MeshBasicMaterial({color:0xffe066, transparent:true, opacity:.55, depthWrite:false}));
    tutMark.position.set(SPX(spot), 0.03 + (A.spots[spot].stack.length ? boardY(spot, A.spots[spot].stack.length) - PITCH : 0), 0); scene.add(tutMark);
  }
  tutPlace();
}
/* put the hole over the target, the four blockers around it, and the text box beside it */
function tutPlace(){
  const s = TUT[lvState.tutStep]; if(!s) return;
  const el = s.el(); if(!el) return;
  const r = el.getBoundingClientRect(), pad = 6, W = innerWidth, H = innerHeight;
  const x0 = Math.max(0, r.left - pad), y0 = Math.max(0, r.top - pad), x1 = Math.min(W, r.right + pad), y1 = Math.min(H, r.bottom + pad);
  const set = (id, x, y, w, h) => { const e = $(id); e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.width = Math.max(0, w) + 'px'; e.style.height = Math.max(0, h) + 'px'; };
  set('#tb-t', 0, 0, W, y0); set('#tb-b', 0, y1, W, H - y1); set('#tb-l', 0, y0, x0, y1 - y0); set('#tb-r', x1, y0, W - x1, y1 - y0);
  set('#tut-hole', x0, y0, x1 - x0, y1 - y0);
  const box = $('#tutbox'), bw = Math.min(380, W - 24), bh = box.offsetHeight || 120;
  let bx = Math.min(Math.max(12, (x0 + x1) / 2 - bw / 2), W - bw - 12), by;
  if(H - y1 > bh + 20) by = y1 + 12; else if(y0 > bh + 20) by = y0 - bh - 12; else { by = Math.max(12, H / 2 - bh / 2); bx = x1 + 12 + bw < W ? x1 + 12 : Math.max(12, x0 - bw - 12); }
  if(el.id === 'stage' && H - y1 < bh + 20){ by = Math.max(12, y0 + 64); bx = Math.max(12, x1 - bw - 16); }
  box.style.left = bx + 'px'; box.style.top = by + 'px'; box.style.width = bw + 'px';
}
function tutTick(real){
  if(!tutOn || !lvState) return;
  const s = TUT[lvState.tutStep]; if(!s) return;
  tutPlace();
  if(tutMark) tutMark.material.opacity = 0.35 + 0.25 * Math.sin(performance.now() / 160);
  if(s.ok()){ lvState.tutStep++; tutRender(); }
}
window.addEventListener('resize', () => { if(tutOn) tutPlace(); });

/* ================================================================ main loop */
let last = performance.now(), carry = 0, lastUI = 0, lastSch = 0;
function frame(now){
  const real = Math.min(now - last, 50) / 1000; last = now;
  if(!$('#scr-game').hidden && ENG){
    const E = ENG.E, c1 = probes[0], c2 = probes[1], h1 = E.has(c1), h2 = c2 && E.has(c2);
    carry += real;
    let n = Math.floor(carry / DT); carry -= n * DT; if(n > 300){ n = 300; carry = 0; }
    for(let k = 0; k < n; k++){
      E.step(DT);
      const t = E.time();
      ['A', 'B'].forEach(w => { if(pulseEnd[w] !== null && t >= pulseEnd[w]){ pulseEnd[w] = null; setSW(w, false); } });
      if(trainQ.length){
        const q = trainQ[0];
        if(!q.started && t >= q.on){ q.started = true; setSW('A', true); }
        if(q.started && t >= q.off){ setSW('A', false); trainQ.shift(); }
      }
      const a = h1 ? E.v(c1) : NaN, b = h2 ? E.v(c2) : NaN;
      SCOPE.push(t, a, b); REC.push(t, a, b);
    }
    SCOPE.draw();
    if($('#view-3d').classList.contains('on')){
      PICK.forEach(g => {
        const t0 = animT0.get(g.userData.partId); if(t0 === undefined) return;
        const p = Math.min(1, (now - t0) / 520); g.position.y = g.userData.y + (1 - bounce(p)) * 3;
        if(p >= 1) animT0.delete(g.userData.partId);
      });
      CLIPS.forEach(m => { m.position.y = m.userData.bob + Math.sin(now / 250) * 0.05; });
      if(GLOW) GLOW.material.opacity = 0.25 + 0.15 * Math.sin(now / 180);
      controls.update(); renderer.render(scene, camera);
    } else if(SCH){
      SCH.flow(real, E.currents());
      if(now - lastSch > 120){ SCH.setValues(code => E.has(code) ? E.v(code) : null); lastSch = now; }
    }
    if(now - lastUI > 200){ renderMeas(); lastUI = now; }
    tutTick(real);
  }
  requestAnimationFrame(frame);
}

/* ================================================================ start */
document.fonts && document.fonts.load('34px "Lilita One"').then(() => {
  Object.keys(texCache).forEach(k => delete texCache[k]);
  mat.material.map.dispose(); mat.material.map = canvasTex(1520, 620, drawMat); mat.material.needsUpdate = true;
  if(R) build3D();
});
R = SL.analyze(A); applyEngine(true);
requestAnimationFrame(frame);
if(location.hash === '#free') startFree();
else if(location.hash === '#play'){ renderMap(); show('scr-map'); }
window.SPIKE = {get A(){ return A; }, get R(){ return R; }, get ENG(){ return ENG; }, SCOPE, REC, place, startLevel, startFree, setSW, pressFor, camera, THREE, SPX, pickAt, LEVELS, get probes(){ return probes; }};
