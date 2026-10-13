/* HW3 實驗台: each simulation region owns a SynEngine (engine.js, the HW2 device models) for one of the
   four circuits; the region on screen runs live.  Settings are kept per region for the basic and the
   advanced mode.  Stimulation: Stimulator A / B presses, A trains, and A-train + B-pulse combinations. */
(function(){
  'use strict';
  var $ = function(s, r){ return (r || document).querySelector(s); };
  var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var DT = 2e-4, NEWREC = 1.5;             /* a stimulus more than 1.5 s after the last one starts a new record */
  var MODE = 'basic';
  try{ MODE = localStorage.getItem('hw3mode') === 'adv' ? 'adv' : 'basic'; }catch(e){}

  var BASE = {vplus:7.8, rpotA:700, rpotB:700, pre:'kit', postMem:'kit', mem:'kit', r1p:0, r6:0, bat:'on',
    wA:20, nA:3, isiA:100, wB:10, offB:-50, ch1:'A.Vm', ch2:'P1'};
  /* the 'true synapse' set: HW2 true-AP add-ons on both membranes, 1.5 Mohm across the synapse's 820k */
  var TRUE_SYN = {pre:'true', postMem:'true', r1p:1.5e6, rpotA:0, rpotB:0, wA:15};
  var LABEL = {'A.Vm':'Pre Vm', 'B.Vm':'Post Vm', 'SY.S':'S', 'SY.B':'Q2 B', 'P1':'#1', 'P2':'#2', 'P3':'#3', 'P4':'#4', 'P5':'#5'};

  var SIMS = {
    s31:{fixed:{syn:'exc', post:'passive'},
      def:{basic:{wA:300, ch2:'P1'}, adv:{ch2:'P1', nA:3, isiA:100}},
      scope:{v1:1, v2:0.2, t:0.1}, isi:true,
      presets:[
        ['kit', '原版電路', {pre:'kit', postMem:'kit', r1p:0, rpotA:700, wA:300}, '助教的電路（同基礎目標）：Pre 是原版 active membrane（R2 100 Ω），一碰就鎖在約 2.3 V；要按住 SW A 300 ms 以上才有小的 EPSP。'],
        ['hw2', 'HW2 真 AP', {pre:'true', postMem:'true', r1p:0, rpotA:0, wA:15}, 'Pre 換成 HW2 的真正的 AP（5.4 V）：突觸板不加東西時 Q2 幾乎不導通，S 只到 0.17 V，沒有 EPSP。'],
        ['true', '真正的突觸', TRUE_SYN, 'HW2 真正的 AP ＋ 820 kΩ 兩端並 1.5 MΩ：一個 AP 在 #1 產生約 0.85 V、#5 約 0.22 V 的 EPSP；多個 AP 會疊加。']
      ]},
    s32:{fixed:{syn:'exc', post:'active'},
      def:{basic:{wA:300, ch2:'B.Vm', wB:10}, adv:{ch2:'B.Vm', nA:2, isiA:100, wB:5, offB:-50}},
      scope:{v1:1, v2:1, t:0.1}, combo:true,
      presets:[
        ['kit', '原版電路', {pre:'kit', postMem:'kit', r1p:0, rpotA:700, rpotB:700, wA:300}, '助教的電路：兩塊 active membrane 都是原版，Post 被 Stimulator B 觸發一次就鎖在約 2.4 V。'],
        ['hw2', 'HW2 真 AP', {pre:'true', postMem:'true', r1p:0, rpotA:0, rpotB:0, wA:15}, '兩塊都用 HW2 真正的 AP、突觸板不加東西：EPSP 傳不到 Post。'],
        ['true', '真正的突觸', TRUE_SYN, '加 1.5 MΩ：一個 EPSP 讓 Post 從 1.20 V 升到 1.36 V（不到門檻），兩個 EPSP（間隔 50 ms–1.2 s）就觸發 Post AP。Stimulator B 按 7 ms 會觸發，5 ms 不會。']
      ]},
    s33:{fixed:{syn:'inh', post:'passive'},
      def:{basic:{wA:300, ch2:'P1'}, adv:{ch2:'P1', nA:3, isiA:100}},
      scope:{v1:1, v2:0.05, t:0.1}, isi:true,
      presets:[
        ['kit', '原版電路', {pre:'kit', postMem:'kit', r1p:0, rpotA:700, wA:300}, '助教的電路：按住 SW A 300 ms 才有約 −140 mV 的 IPSP。'],
        ['hw2', 'HW2 真 AP', {pre:'true', postMem:'true', r1p:0, rpotA:0, wA:15}, 'Pre 用 HW2 真正的 AP：一個 AP 只有約 −20 mV。'],
        ['true', '真正的突觸', TRUE_SYN, '加 1.5 MΩ：一個 AP 在 #1 約 −40 mV（被 15 kΩ 和 1.5 V 電池限制），多個 AP 疊加。拔掉電池 IPSP 就消失（Post 靜止約 0 V，沒有驅動力）。']
      ]},
    s34:{fixed:{syn:'inh', post:'active'},
      def:{basic:{wA:300, ch2:'B.Vm', wB:20}, adv:{ch2:'B.Vm', nA:1, isiA:50, wB:11.5, offB:30}},
      scope:{v1:1, v2:1, t:0.1}, combo:true,
      presets:[
        ['kit', '原版電路', {pre:'kit', postMem:'kit', r1p:0, rpotA:700, rpotB:700, wA:300}, '助教的電路：Post 觸發一次就鎖住，量不到「抑制 AP」和頻率變化。'],
        ['hw2', 'HW2 真 AP', {pre:'true', postMem:'true', r1p:0, rpotA:0, rpotB:0, wA:15}, '兩塊都用 HW2 真正的 AP、突觸板不加東西。'],
        ['true', '真正的突觸', TRUE_SYN, '加 1.5 MΩ：Post 靜止 1.02 V（突觸的 300 kΩ 也是 leak），Stimulator B 最弱觸發 = 按 11 ms。B 按 11.5 ms 時 1 個 IPSP 就擋住 AP，按 13 ms 要 2 個。按住 SW B（可變電阻 6 kΩ）16.4 Hz，同時按住 SW A 降到 10.3 Hz；電池拔掉（跳線）只降到 14.5 Hz。']
      ]}
  };

  Object.keys(SIMS).forEach(function(k){
    var s = SIMS[k];
    s.id = k; s.el = $('[data-sim="' + k + '"]'); s.svg = $('svg.sch', s.el); s.cv = $('canvas', s.el);
    s.state = {basic:Object.assign({}, BASE, s.def.basic), adv:Object.assign({}, BASE, s.def.adv)};
    var tp = s.presets[s.presets.length - 1]; Object.assign(s.state.adv, tp[2], {_preset:tp[0], _note:tp[3]});
    s.sc = {v1:s.scope.v1, v2:s.scope.v2, t:s.scope.t, z1:1, z2:1, mode:'roll', tsrc:'sw', lvl:2.0, trig:'idle', t0:0, prev:0, frozen:null, speed:1};
    s.buf = {cap:60000, t:new Float64Array(60000), a:new Float64Array(60000), b:new Float64Array(60000), head:0, n:0};
    s.E = SynEngine(); s.SCH = null; s.rec = null; s.ev = []; s.hold = {A:false, B:false}; s.on = {A:false, B:false};
    s.lastStim = -1e9; s.apT = {pre:[], post:[]}; s.arm = {pre:true, post:true};
  });

  /* effective engine state for a region in the current mode */
  function engineState(s){
    var u = s.state[MODE], st = Object.assign({}, BASE, u, s.fixed);
    if(MODE === 'basic'){ st.pre = st.postMem = u.mem; st.r1p = 0; st.r6 = 0; st.vplus = 7.8; }
    if(st.post === 'passive' && st.ch2 === 'B.Vm') st.ch2 = 'P1';
    if(st.post === 'active' && /^P/.test(st.ch2)) st.ch2 = 'B.Vm';
    if(st.post === 'active' && /^P/.test(st.ch1)) st.ch1 = 'A.Vm';
    return st;
  }
  function applyEngine(s){
    var st = engineState(s), E = s.E;
    ['vplus', 'pre', 'postMem', 'r1p', 'r6', 'bat', 'syn', 'post', 'rpotA', 'rpotB', 'ch1', 'ch2'].forEach(function(k){ E.st[k] = st[k]; });
    E.st.swA = s.hold.A || s.on.A; E.st.swB = s.hold.B || s.on.B;
    E.build();
  }

  /* ---------------- schematic ---------------- */
  function drawSchematic(s){
    s.SCH = SynSchematic(s.svg, s.fixed);
    syncSchematic(s);
  }
  function syncSchematic(s){
    if(!s.SCH) return;
    var st = engineState(s);
    st.swA = s.hold.A || s.on.A; st.swB = s.hold.B || s.on.B;
    s.SCH.setState(st); s.SCH.setProbes([st.ch1, st.ch2]);
  }

  /* ---------------- controls ---------------- */
  function ctlValue(el){
    var sc = el.dataset.scale ? +el.dataset.scale : 1;
    if(el.type === 'checkbox') return el.checked;
    if(el.type === 'range' || el.type === 'number') return +el.value * sc;
    if(el.hasAttribute('data-num')) return +el.value;
    return el.value;
  }
  function setCtl(el, v){
    var sc = el.dataset.scale ? +el.dataset.scale : 1;
    if(v === undefined) return;
    if(el.type === 'checkbox') el.checked = !!v;
    else if(el.type === 'range' || el.type === 'number') el.value = +(v / sc).toFixed(6);
    else el.value = String(v);
    if(el.tagName === 'SELECT' && el.hasAttribute('data-num')){
      var hit = $$('option', el).filter(function(o){ return +o.value === +v; })[0];
      if(hit) el.value = hit.value;
    }
  }
  function nodeOptions(s){
    var passive = s.fixed.post === 'passive';
    $$('select[data-nodes]', s.el).forEach(function(sel){
      var opts = sel.dataset.nodes === 'ch1' ? (passive ? ['A.Vm', 'P1'] : ['A.Vm']) : (passive ? ['P1', 'P2', 'P3', 'P4', 'P5', 'SY.S', 'SY.B'] : ['B.Vm', 'SY.S', 'SY.B']);
      sel.innerHTML = opts.map(function(o){ return '<option value="' + o + '">' + LABEL[o] + (o === 'SY.B' ? '（突觸輸入）' : o === 'SY.S' ? '（突觸輸出）' : '') + '</option>'; }).join('');
    });
  }
  function syncControls(s){
    var u = s.state[MODE], st = engineState(s);
    $$('[data-k]', s.el).forEach(function(el){
      var blk = el.closest('[data-show]');
      if(blk && blk.dataset.show !== MODE) return;
      setCtl(el, u[el.dataset.k] !== undefined ? u[el.dataset.k] : st[el.dataset.k]);
    });
    $$('[data-out]', s.el).forEach(function(o){ o.textContent = ((u[o.dataset.out] || 0) / 1e3).toFixed(1) + ' kΩ'; });
    $$('[data-presets] button', s.el).forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.p === u._preset ? 'true' : 'false'); });
    var pn = $('[data-preset-note]', s.el); if(pn) pn.textContent = u._note || '';
    var sc = s.sc;
    $$('[data-sc]', s.el).forEach(function(el){ el.value = String(sc[el.dataset.sc]); });
    $$('[data-scmode]', s.el).forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.scmode === sc.mode ? 'true' : 'false'); });
    var tl = $('[data-train-label]', s.el); if(tl) tl.textContent = trainText(u);
  }
  function trainText(u){ return u.nA + ' 下 × ' + u.wA + ' ms，間隔 ' + u.isiA + ' ms（' + (1000 / u.isiA).toFixed(1) + ' Hz）'; }
  function onCtl(s, el){
    var blk = el.closest('[data-show]');
    if(blk && blk.dataset.show !== MODE) return;
    var k = el.dataset.k, u = s.state[MODE];
    u[k] = ctlValue(el);
    if(k === 'rpotA' || k === 'rpotB') $$('[data-out="' + k + '"]', s.el).forEach(function(o){ o.textContent = (u[k] / 1e3).toFixed(1) + ' kΩ'; });
    if(k === 'ch1' || k === 'ch2') clearBuf(s);
    var tl = $('[data-train-label]', s.el); if(tl) tl.textContent = trainText(u);
    if(active === s) applyEngine(s);
    if(k === 'mem' || k === 'pre' || k === 'postMem' || k === 'r1p' || k === 'bat' || k === 'r6' || k === 'vplus'){ u._preset = null; u._note = ''; syncControls(s); if(active === s) powerOn(s); }
    syncSchematic(s);
  }
  function buildPanels(s){
    var panel = $('.settings', s.el);
    /* pulse buttons */
    $$('[data-pulses]', panel).forEach(function(box){
      var who = box.dataset.who;
      box.innerHTML = box.dataset.pulses.split(',').map(function(x){
        var T = +x; return '<button class="btn" type="button" data-t="' + T + '">按 ' + (T >= 1 ? T + ' s' : Math.round(T * 1e3) + ' ms') + '</button>';
      }).join('');
      $$('button', box).forEach(function(b){ b.addEventListener('click', function(){ press(s, who, +b.dataset.t); }); });
    });
    $$('[data-train]', panel).forEach(function(b){ b.addEventListener('click', function(){ trainA(s); }); });
    $$('[data-combo]', panel).forEach(function(b){ b.addEventListener('click', function(){ combo(s); }); });
    $$('[data-offq]', panel).forEach(function(b){ b.addEventListener('click', function(){
      var u = s.state[MODE];
      u.offB = b.dataset.offq === 'post' ? -(+u.wB + 20) : (u.nA - 1) * u.isiA + 30;
      syncControls(s);
    }); });
    /* presets */
    $$('[data-presets]', panel).forEach(function(box){
      box.innerHTML = s.presets.map(function(p){ return '<button class="btn" type="button" data-p="' + p[0] + '">' + p[1] + '</button>'; }).join('');
      $$('button', box).forEach(function(b){ b.addEventListener('click', function(){
        var p = s.presets.filter(function(x){ return x[0] === b.dataset.p; })[0];
        var keep = {ch1:s.state.adv.ch1, ch2:s.state.adv.ch2, nA:s.state.adv.nA, isiA:s.state.adv.isiA, bat:s.state.adv.bat};
        s.state.adv = Object.assign({}, BASE, s.def.adv, keep, p[2], {_preset:p[0], _note:p[3]});
        syncControls(s); syncSchematic(s); if(active === s) powerOn(s);
      }); });
    });
    /* scope controls */
    $$('[data-scope]', panel).forEach(function(box){
      var vd = function(sel){ return [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2].map(function(v){ return '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + (v < 0.1 ? v * 1e3 + ' mV' : v + ' V') + '</option>'; }).join(''); };
      box.innerHTML =
        '<div class="row"><label>CH1 V/div</label><select data-sc="v1">' + vd(s.sc.v1) + '</select></div>' +
        '<div class="row"><label>CH2 V/div</label><select data-sc="v2">' + vd(s.sc.v2) + '</select></div>' +
        '<div class="row"><label>時間/div</label><select data-sc="t">' + [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].map(function(v){ return '<option value="' + v + '">' + (v >= 1 ? v + ' s' : v * 1e3 + ' ms') + '</option>'; }).join('') + '</select></div>' +
        '<div class="row"><label>CH2 零點</label><select data-sc="z2"><option value="1">底部</option><option value="4">中間</option></select></div>' +
        '<div class="btns" style="margin:4px 0"><button class="btn" type="button" data-scmode="roll">Roll</button><button class="btn" type="button" data-scmode="single">Single</button><button class="btn" type="button" data-arm>重新擷取</button></div>' +
        '<div class="row"><label>速度</label><select data-sc="speed"><option value="1">1×</option><option value="0.25">¼×</option><option value="0.05">1/20×</option><option value="0">暫停</option></select></div>' +
        '<div data-show="adv"><div class="row"><label>觸發</label><select data-sc="tsrc"><option value="sw">刺激開始</option><option value="ch1">CH1 上升</option></select></div>' +
        '<div class="row"><label>觸發準位（V）</label><input type="number" step="0.1" data-sc="lvl" style="width:5em"></div></div>' +
        '<p class="small muted" data-trigstate style="margin:2px 0 0"></p>';
      $$('[data-sc]', box).forEach(function(el){
        el.value = String(s.sc[el.dataset.sc]);
        el.addEventListener('change', function(){
          var k = el.dataset.sc, v = el.value;
          s.sc[k] = (k === 'tsrc') ? v : +v;
          if(k === 't' && s.sc.mode === 'single') arm(s);
        });
      });
      $$('[data-scmode]', box).forEach(function(b){ b.addEventListener('click', function(){
        s.sc.mode = b.dataset.scmode; s.sc.frozen = null;
        if(s.sc.mode === 'single') arm(s); else s.sc.trig = 'idle';
        syncControls(s);
      }); });
      $('[data-arm]', box).addEventListener('click', function(){ s.sc.mode = 'single'; arm(s); syncControls(s); });
    });
    /* measurement table */
    $$('[data-meas]', panel).forEach(function(box){
      box.innerHTML = '<table class="meas"><tr><th></th><th class="num">CH1</th><th class="num">CH2</th></tr>' +
        ['基線', '峰值', '振幅', '起始點', '到峰', '半高寬', 'rise τ', 'decay τ'].map(function(r, i){ return '<tr><td>' + r + '</td><td data-m="a' + i + '">—</td><td data-m="b' + i + '">—</td></tr>'; }).join('') +
        '</table><p class="small" style="margin:4px 0 0">延遲（CH2 − CH1）：起始點 <span class="mono" data-m="dr">—</span>、波峰 <span class="mono" data-m="dp">—</span><br>' +
        '刺激電流：A <span class="mono" data-m="IA">—</span>　B <span class="mono" data-m="IB">—</span><br>' +
        'AP 數：Pre <span class="mono" data-m="nA">—</span>' + (s.fixed.post === 'active' ? '　Post <span class="mono" data-m="nB">—</span>' : '') + '</p>' +
        (s.fixed.post === 'active' ? '<p class="small" style="margin:2px 0 0">近 1 秒 AP 頻率：Pre <span class="mono" data-m="fA">—</span>　Post <span class="mono" data-m="fB">—</span></p>' : '');
    });
    /* SW buttons */
    $$('[data-sw]', panel).forEach(function(sb){
      var who = sb.dataset.sw;
      sb.addEventListener('pointerdown', function(e){ e.preventDefault(); sb.setPointerCapture(e.pointerId); sb._down = true; activate(s); setHold(s, who, true); });
      var up = function(){ if(!sb._down) return; sb._down = false; if(!s.latch || !s.latch[who]) setHold(s, who, false); };
      sb.addEventListener('pointerup', up); sb.addEventListener('pointercancel', up);
    });
    s.latch = {A:false, B:false};
    $$('[data-latch]', panel).forEach(function(c){ c.addEventListener('change', function(){ var who = c.dataset.latch; s.latch[who] = c.checked; activate(s); setHold(s, who, c.checked); }); });
    $$('[data-reset]', panel).forEach(function(b){ b.addEventListener('click', function(){ activate(s); powerOn(s); }); });
    $$('[data-isi]', panel).forEach(function(b){ b.addEventListener('click', function(){ isiSweep(s); }); });
    $$('[data-k]', panel).forEach(function(el){
      el.addEventListener(el.type === 'range' ? 'input' : 'change', function(){ onCtl(s, el); });
    });
  }

  /* ---------------- stimulation ---------------- */
  var active = null;
  function clearBuf(s){ s.buf.head = 0; s.buf.n = 0; s.sc.frozen = null; }
  function powerOn(s){
    s.ev = []; s.on = {A:false, B:false}; s.hold = {A:false, B:false};
    $$('[data-latch]', s.el).forEach(function(c){ c.checked = false; }); s.latch = {A:false, B:false};
    applyEngine(s); s.E.powerOn(); s.E.settle(2.0);       /* plug in and let it rest (2 s, not drawn) */
    s.rec = null; s.lastStim = -1e9; s.apT = {pre:[], post:[]}; clearBuf(s);
    if(s.sc.mode === 'single') arm(s);
    swButtons(s); syncSchematic(s);
  }
  function activate(s){
    if(active === s) return;
    if(active){ var o = active; o.ev = []; o.on = {A:false, B:false}; o.hold = {A:false, B:false}; swButtons(o); syncSchematic(o); }
    active = s;
    powerOn(s);
  }
  function swButtons(s){
    $$('[data-sw]', s.el).forEach(function(b){
      var who = b.dataset.sw, on = s.hold[who] || s.on[who];
      b.classList.toggle('on', on); b.textContent = on ? 'SW ' + who + ' 按下中' : '按住 SW ' + who;
    });
  }
  function startStim(s){
    var t = s.E.time();
    if(!s.rec || t - s.lastStim > NEWREC){
      s.rec = {t0:t, t:[], a:[], b:[], pre:[], post:[], iA:0, iB:0};
      if(s.sc.mode === 'single' && s.sc.tsrc === 'sw' && s.sc.trig === 'armed'){ s.sc.trig = 'capturing'; s.sc.t0 = t; }
    }
    s.lastStim = t;
  }
  function setSW(s, who){
    var on = s.hold[who] || s.on[who];
    var key = who === 'A' ? 'swA' : 'swB';
    if(s.E.st[key] !== on){
      if(on) startStim(s);
      s.E.st[key] = on; s.E.build();
    }
    if(!on && s.rec) s.lastStim = s.E.time();
    swButtons(s); syncSchematic(s);
  }
  function setHold(s, who, on){ if(active !== s) activate(s); s.hold[who] = on; setSW(s, who); }
  /* schedule: [time, who, on] in engine time */
  function sched(s, list){ s.ev = s.ev.concat(list).sort(function(a, b){ return a[0] - b[0]; }); }
  function press(s, who, T){ activate(s); var t = s.E.time() + DT; sched(s, [[t, who, true], [t + T, who, false]]); }
  function trainA(s){
    activate(s);
    var u = s.state[MODE], t = s.E.time() + DT, L = [];
    for(var k = 0; k < u.nA; k++) L.push([t + k * u.isiA / 1e3, 'A', true], [t + k * u.isiA / 1e3 + u.wA / 1e3, 'A', false]);
    sched(s, L);
  }
  function combo(s){
    activate(s);
    var u = s.state[MODE], t = s.E.time() + DT, tA = t + Math.max(0, -u.offB / 1e3), tB = tA + u.offB / 1e3, L = [];
    for(var k = 0; k < u.nA; k++) L.push([tA + k * u.isiA / 1e3, 'A', true], [tA + k * u.isiA / 1e3 + u.wA / 1e3, 'A', false]);
    L.push([tB, 'B', true], [tB + u.wB / 1e3, 'B', false]);
    sched(s, L);
  }
  function runEvents(s){
    var t = s.E.time();
    while(s.ev.length && s.ev[0][0] <= t + 1e-9){
      var e = s.ev.shift(); s.on[e[1]] = e[2]; setSW(s, e[1]);
    }
  }
  function arm(s){ s.sc.trig = 'armed'; s.sc.frozen = null; s.sc.prev = s.E.v(s.E.st.ch1); }

  /* ---------------- sampling ---------------- */
  var THR = 2.0, REARM = 1.5;                /* AP counter: rising through 2 V, re-armed below 1.5 V */
  function sample(s){
    var E = s.E, st = E.st, b = s.buf, t = E.time(), a = E.v(st.ch1), c = E.v(st.ch2);
    b.t[b.head] = t; b.a[b.head] = a; b.b[b.head] = c; b.head = (b.head + 1) % b.cap; if(b.n < b.cap) b.n++;
    var sc = s.sc;
    if(sc.mode === 'single'){
      if(sc.tsrc === 'ch1' && sc.trig === 'armed' && sc.prev < sc.lvl && a >= sc.lvl){ sc.trig = 'capturing'; sc.t0 = t; }
      if(sc.trig === 'capturing' && t >= sc.t0 + 9 * sc.t){ sc.frozen = windowOf(s, sc.t0 - sc.t, sc.t0 + 9 * sc.t); sc.trig = 'done'; }
      sc.prev = a;
    }
    var vA = E.v('A.Vm'), vB = st.post === 'active' ? E.v('B.Vm') : NaN;
    [['pre', vA], ['post', vB]].forEach(function(p){
      var k = p[0], v = p[1]; if(isNaN(v)) return;
      if(s.arm[k] && v >= THR){ s.arm[k] = false; s.apT[k].push(t); if(s.rec) s.rec[k].push(t - s.rec.t0); if(s.apT[k].length > 400) s.apT[k].shift(); }
      else if(!s.arm[k] && v < REARM) s.arm[k] = true;
    });
    if(s.rec && s.rec.t.length < 30000){
      s.rec.t.push(t - s.rec.t0); s.rec.a.push(a); s.rec.b.push(c);
      if(st.swA){ var IA = -E.q('SA.pass')[0]; if(IA > s.rec.iA) s.rec.iA = IA; }
      if(st.swB){ var IB = -E.q('SB.pass')[0]; if(IB > s.rec.iB) s.rec.iB = IB; }
    }
  }
  function windowOf(s, t0, t1){
    var b = s.buf, ts = [], as = [], bs = [], start = (b.head - b.n + b.cap) % b.cap;
    for(var k = 0; k < b.n; k++){ var i = (start + k) % b.cap; if(b.t[i] >= t0 && b.t[i] <= t1){ ts.push(b.t[i]); as.push(b.a[i]); bs.push(b.b[i]); } }
    return {t0:t0, t1:t1, t:ts, a:as, b:bs};
  }

  var last = performance.now(), carry = 0, lastUI = 0;
  function frame(now){
    var real = Math.min(now - last, 50) / 1000; last = now;
    var s = active;
    if(s){
      carry += real * s.sc.speed;
      var n = Math.floor(carry / DT); carry -= n * DT;
      for(var k = 0; k < n; k++){ runEvents(s); s.E.step(DT); sample(s); }
      drawScope(s);
      if(now - lastUI > 100){ updateUI(s); lastUI = now; }
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- scope ---------------- */
  function sizeCanvas(cv){
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
  }
  function fmtV(v){ return v == null || isNaN(v) ? '—' : Math.abs(v) < 0.1 ? (v * 1e3).toFixed(1) + ' mV' : v.toFixed(3) + ' V'; }
  function divTxt(v){ return (v < 0.1 ? v * 1e3 + ' mV' : v + ' V') + '/div'; }
  function drawScope(s){
    var cv = s.cv, ctx = cv.getContext('2d'), W = cv.width, H = cv.height, dpr = window.devicePixelRatio || 1, sc = s.sc, st = s.E.st;
    var gx = W / 10, gy = H / 8;
    ctx.fillStyle = '#0d1114'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for(var i = 1; i < 10; i++){ ctx.moveTo(Math.round(i * gx) + .5, 0); ctx.lineTo(Math.round(i * gx) + .5, H); }
    for(i = 1; i < 8; i++){ ctx.moveTo(0, Math.round(i * gy) + .5); ctx.lineTo(W, Math.round(i * gy) + .5); }
    ctx.stroke();
    var y1 = H - sc.z1 * gy, y2 = H - sc.z2 * gy;
    var Y1 = function(v){ return y1 - v / sc.v1 * gy; }, Y2 = function(v){ return y2 - v / sc.v2 * gy; };
    var w;
    if(sc.mode === 'single' && sc.frozen) w = sc.frozen;
    else if(sc.mode === 'single' && sc.trig === 'capturing') w = windowOf(s, sc.t0 - sc.t, sc.t0 + 9 * sc.t);
    else { var tn = s.E.time(); w = windowOf(s, tn - 10 * sc.t, tn); }
    var X = function(t){ return (t - w.t0) / (w.t1 - w.t0) * W; };
    function mark(y, c){ ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, y - 6 * dpr); ctx.lineTo(9 * dpr, y); ctx.lineTo(0, y + 6 * dpr); ctx.fill(); }
    mark(y1, '#3987e5'); mark(y2, '#e0703f');
    function trace(arr, Y, col){
      var n = w.t.length; if(n < 2) return;
      var stride = Math.max(1, Math.floor(n / (W * 1.5)));
      ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr; ctx.lineJoin = 'round'; ctx.beginPath();
      var on = false;
      for(var k = 0; k < n; k += stride){ var v = arr[k]; if(isNaN(v)) continue; var x = X(w.t[k]), y = Math.max(-4, Math.min(H + 4, Y(v))); if(!on){ ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    trace(w.b, Y2, '#e0703f');
    trace(w.a, Y1, '#3987e5');
    ctx.font = (12 * dpr) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#3987e5'; ctx.fillText('CH1 ' + LABEL[st.ch1] + '  ' + divTxt(sc.v1), 8 * dpr, H - 8 * dpr);
    ctx.fillStyle = '#e0703f'; ctx.fillText('CH2 ' + LABEL[st.ch2] + '  ' + divTxt(sc.v2), 8 * dpr, 16 * dpr);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    var tl = (sc.t >= 1 ? sc.t + ' s' : sc.t * 1e3 + ' ms') + '/div' + (sc.mode === 'single' ? '  Single' : '');
    ctx.fillText(tl, W - ctx.measureText(tl).width - 34 * dpr, H - 8 * dpr);
    if(s.cursor != null && w.t.length){
      var cx = s.cursor * dpr, tc = w.t0 + cx / W * (w.t1 - w.t0), lo = 0, hi = w.t.length - 1;
      while(hi - lo > 1){ var mid = (lo + hi) >> 1; if(w.t[mid] < tc) lo = mid; else hi = mid; }
      var j = (tc - w.t[lo] < w.t[hi] - tc) ? lo : hi;
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      var txt = 't ' + ((w.t[j] - (sc.mode === 'single' && sc.trig !== 'armed' ? sc.t0 : w.t1)) * 1e3).toFixed(1) + ' ms  CH1 ' + fmtV(w.a[j]) + '  CH2 ' + fmtV(w.b[j]);
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(txt, W - ctx.measureText(txt).width - 34 * dpr, 16 * dpr);
    }
    var ts = $('[data-trigstate]', s.el);
    if(ts) ts.textContent = sc.mode === 'roll' ? '' : ({armed:'等待觸發…', capturing:'擷取中…', done:'已擷取'})[sc.trig] || '';
  }

  /* ---------------- measurements of the last stimulation ---------------- */
  /* kind 'firstAP': first peak 0.5 V above the baseline (else the maximum); 'signed': largest deviation (EPSP up, IPSP down).
     起始點 = 10 % of the amplitude.  rise tau: AP from the stimulus (HW2), PSP from its 起始點; decay tau: peak to 37 %. */
  function metrics(t, v, kind){
    if(!t.length) return null;
    var base = v[0], ip = -1, i;
    if(kind === 'signed'){
      var best = 0;
      for(i = 0; i < v.length; i++){ if(!isNaN(v[i]) && Math.abs(v[i] - base) > best){ best = Math.abs(v[i] - base); ip = i; } }
    } else {
      for(i = 1; i < v.length - 1; i++) if(v[i] - base > 0.5 && v[i] >= v[i - 1] && v[i] > v[i + 1]){ ip = i; break; }
      if(ip < 0){ var mx = -Infinity; for(i = 0; i < v.length; i++) if(v[i] > mx){ mx = v[i]; ip = i; } }
    }
    if(ip < 0) return null;
    var a = v[ip] - base; if(Math.abs(a) < 2e-4) return {base:base, peak:v[ip], amp:a};
    var f = function(x){ return (x - base) / a; };
    var on = null; for(i = 0; i <= ip; i++) if(f(v[i]) >= 0.1){ on = t[i]; break; }
    var r = null; for(i = 0; i <= ip; i++) if(f(v[i]) >= 0.632){ r = t[i] - (kind === 'signed' ? on : 0); break; }
    var d = null; for(i = ip; i < v.length; i++) if(f(v[i]) <= 0.368){ d = t[i] - t[ip]; break; }
    var lo = ip; while(lo > 0 && f(v[lo]) >= 0.5) lo--;
    var hi = ip; while(hi < v.length - 1 && f(v[hi]) >= 0.5) hi++;
    var hw = (hi < v.length - 1 && f(v[hi]) < 0.5) ? t[hi] - t[lo] : null;
    return {base:base, peak:v[ip], amp:a, on:on, tp:t[ip], hw:hw, rise:r, decay:d};
  }
  function kindOf(code){ return code === 'A.Vm' || code === 'B.Vm' ? 'firstAP' : 'signed'; }
  function recent(arr, now){ var n = 0; for(var i = arr.length - 1; i >= 0 && arr[i] > now - 1; i--) n++; return n; }
  function updateUI(s){
    var E = s.E, st = E.st, set = function(k, txt){ var e = $('[data-m="' + k + '"]', s.el); if(e) e.textContent = txt; };
    var ms = function(x){ return x == null ? '—' : (x * 1e3).toFixed(1) + ' ms'; };
    var rec = s.rec;
    if(rec && rec.t.length > 2){
      var m1 = metrics(rec.t, rec.a, kindOf(st.ch1)), m2 = metrics(rec.t, rec.b, kindOf(st.ch2));
      [[m1, 'a'], [m2, 'b']].forEach(function(p){
        var m = p[0], c = p[1];
        var row = m ? [fmtV(m.base), fmtV(m.peak), fmtV(m.amp), ms(m.on), ms(m.tp), ms(m.hw), ms(m.rise), ms(m.decay)] : ['—', '—', '—', '—', '—', '—', '—', '—'];
        row.forEach(function(x, i){ set(c + i, x); });
      });
      set('dr', m1 && m2 && m1.on != null && m2.on != null ? ms(m2.on - m1.on) : '—');
      set('dp', m1 && m2 && m1.tp != null && m2.tp != null ? ms(m2.tp - m1.tp) : '—');
      set('IA', rec.iA > 0 ? (rec.iA * 1e6).toFixed(1) + ' µA' : '—');
      set('IB', rec.iB > 0 ? (rec.iB * 1e6).toFixed(1) + ' µA' : '—');
      set('nA', String(rec.pre.length)); set('nB', String(rec.post.length));
    }
    var now = E.time();
    set('fA', recent(s.apT.pre, now) + ' Hz'); set('fB', recent(s.apT.post, now) + ' Hz');
    if(s.SCH){
      s.SCH.setValues(function(code){ return E.has(code) ? E.v(code) : null; });
      s.SCH.setCurrents({A:-E.q('SA.pass')[0], B:-E.q('SB.pass')[0]});
      s.SCH.setOn({q1:Math.abs(E.q('sy.q1')[0]) > 2e-6, q2:E.q('sy.q2')[0] > 2e-6});
    }
  }

  /* ---------------- ISI sweep: two A pulses at each interval, on a separate engine ---------------- */
  var ISIS = [50, 75, 100, 150, 200, 300, 500, 800, 1200];
  function isiSweep(s){
    var u = s.state[MODE], st = engineState(s), box = $('[data-isibox]', s.el), out = $('[data-isiout]', s.el), btn = $('[data-isi]', s.el);
    if(btn.disabled) return;
    var node = /^(P\d|SY\.S)$/.test(st.ch2) ? st.ch2 : 'P1', w = u.wA / 1e3;
    var list = ISIS.filter(function(x){ return x / 1e3 > w + 0.02; });
    var E = SynEngine(); ['vplus', 'pre', 'postMem', 'r1p', 'r6', 'bat', 'syn', 'post', 'rpotA', 'rpotB'].forEach(function(k){ E.st[k] = st[k]; });
    E.st.ch1 = 'A.Vm'; E.st.ch2 = node; E.st.swA = false; E.st.swB = false; E.build(); E.powerOn(); E.settle(2.0);
    var snap = E.snapshot(), pts = [], one = null;
    function run(isi){
      E.restore(snap); var base = E.v(node), best = 0, T = (isi || 0) / 1e3 + w + 1.0, n = Math.round(T / DT), aps = 0, armd = true;
      for(var k = 0; k < n; k++){
        var tt = k * DT, on = tt < w || (isi && tt >= isi / 1e3 && tt < isi / 1e3 + w);
        if(on !== E.st.swA){ E.st.swA = on; E.build(); }
        E.step(DT);
        var d = E.v(node) - base; if(Math.abs(d) > Math.abs(best)) best = d;
        var va = E.v('A.Vm'); if(armd && va >= THR){ aps++; armd = false; } else if(!armd && va < REARM) armd = true;
      }
      E.st.swA = false; E.build();
      return {amp:best, aps:aps};
    }
    btn.disabled = true; btn.textContent = '計算中…'; box.hidden = false;
    var i = -1;
    (function next(){
      if(i < 0) one = run(0);
      else pts.push([list[i], run(list[i])]);
      i++;
      plotIsi(s, node, one, pts, list.length);
      if(i < list.length) setTimeout(next, 0);
      else {
        btn.disabled = false; btn.textContent = '重新掃描';
        out.innerHTML = '<div class="tbl"><table><tr><th class="num">ISI (ms)</th><th class="num">Hz</th><th class="num">' + LABEL[node] + ' 振幅</th><th class="num">÷ 單一</th><th class="num">Pre AP</th></tr>' +
          '<tr><td class="num">單一</td><td class="num">—</td><td class="num">' + fmtV(one.amp) + '</td><td class="num">1.00</td><td class="num">' + one.aps + '</td></tr>' +
          pts.map(function(p){ return '<tr><td class="num">' + p[0] + '</td><td class="num">' + (1000 / p[0]).toFixed(1) + '</td><td class="num">' + fmtV(p[1].amp) + '</td><td class="num">' + (Math.abs(one.amp) > 1e-4 ? (p[1].amp / one.amp).toFixed(2) : '—') + '</td><td class="num">' + p[1].aps + '</td></tr>'; }).join('') +
          '</table></div><p class="small muted" style="margin:4px 0 0">兩下 SW A，各按 ' + u.wA + ' ms、可變電阻 ' + (u.rpotA / 1e3).toFixed(1) + ' kΩ；振幅 = 第一下開始後 ' + LABEL[node] + ' 偏離基線最多的值。</p>';
      }
    })();
  }
  function plotIsi(s, node, one, pts, total){
    s.lastPlot = [node, one, pts, total];
    var cv = $('canvas[data-isiplot]', s.el); sizeCanvas(cv);
    var ctx = cv.getContext('2d'), W = cv.width, H = cv.height, dpr = window.devicePixelRatio || 1, cs = getComputedStyle(document.body);
    var ink = cs.getPropertyValue('--ink').trim() || '#1E262C', mut = cs.getPropertyValue('--muted').trim() || '#5F6B72', rule = cs.getPropertyValue('--rule').trim() || '#ccc', acc = cs.getPropertyValue('--accent').trim() || '#2F6B3A';
    ctx.fillStyle = cs.getPropertyValue('--surface').trim() || '#fff'; ctx.fillRect(0, 0, W, H);
    var L = 46 * dpr, R = 10 * dpr, T = 12 * dpr, B = 30 * dpr, pw = W - L - R, ph = H - T - B;
    var vals = pts.map(function(p){ return p[1].amp * 1e3; }).concat(one ? [one.amp * 1e3, 2 * one.amp * 1e3] : []);
    var neg = vals.some(function(v){ return v < 0; }) && !vals.some(function(v){ return v > 1; });
    var ymax = Math.max.apply(null, vals.map(Math.abs).concat([1])) * 1.1;
    var X = function(x){ return L + x / 1300 * pw; }, Y = function(v){ return neg ? T + (-v) / ymax * ph : T + ph - v / ymax * ph; };
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, T + ph); ctx.lineTo(L + pw, T + ph); ctx.stroke();
    ctx.font = (11 * dpr) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = mut;
    [0, 250, 500, 750, 1000, 1250].forEach(function(x){ ctx.fillText(String(x), X(x) - ctx.measureText(String(x)).width / 2, T + ph + 14 * dpr); });
    ctx.fillText('ISI (ms)', L + pw - ctx.measureText('ISI (ms)').width, T + ph + 26 * dpr);
    [0, 0.5, 1].forEach(function(f){ var v = (neg ? -1 : 1) * f * ymax, s2 = v.toFixed(0); ctx.fillText(s2, L - 6 * dpr - ctx.measureText(s2).width, Y(v) + 4 * dpr); });
    ctx.save(); ctx.translate(12 * dpr, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(LABEL[node] + ' 振幅 (mV)', -40 * dpr, 0); ctx.restore();
    if(one){
      ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeStyle = mut;
      [[one.amp * 1e3, '單一'], [2 * one.amp * 1e3, '2 × 單一']].forEach(function(p){ ctx.beginPath(); ctx.moveTo(L, Y(p[0])); ctx.lineTo(L + pw, Y(p[0])); ctx.stroke(); ctx.fillText(p[1], L + pw - ctx.measureText(p[1]).width, Y(p[0]) - 4 * dpr); });
      ctx.setLineDash([]);
    }
    ctx.fillStyle = acc;
    pts.forEach(function(p){ ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1].amp * 1e3), 4.5 * dpr, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = ink;
    if(pts.length < total) ctx.fillText(pts.length + ' / ' + total, L + 8 * dpr, T + 12 * dpr);
  }

  /* ---------------- mode, navigation, fullscreen ---------------- */
  function setMode(m){
    MODE = m; document.body.dataset.mode = m;
    try{ localStorage.setItem('hw3mode', m); }catch(e){}
    $$('.mode button').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'); });
    Object.keys(SIMS).forEach(function(k){ var s = SIMS[k]; syncControls(s); syncSchematic(s); });
    if(active){ var a = active; active = null; activate(a); }
  }
  $$('.mode button').forEach(function(b){ b.addEventListener('click', function(){ setMode(b.dataset.mode); }); });

  var navLinks = $$('nav.regions a');
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting && e.intersectionRatio >= 0.5){
        navLinks.forEach(function(a){ a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); });
        var key = e.target.dataset.sim;
        if(key){ var s = SIMS[key]; activate(s); sizeCanvas(s.cv); }
      }
    });
  }, {root:$('#main'), threshold:[0.5]});
  $$('.region').forEach(function(r){ io.observe(r); });

  $$('[data-fs]').forEach(function(b){
    b.addEventListener('click', function(){
      var box = b.closest('.pane, .fsbox'), on = !box.classList.contains('fs');
      box.classList.toggle('fs', on); b.textContent = on ? '✕' : (box.classList.contains('fsbox') ? '⤢ 全螢幕' : '⤢');
      Object.keys(SIMS).forEach(function(k){ var x = SIMS[k]; sizeCanvas(x.cv); if(x.lastPlot) plotIsi.apply(null, [x].concat(x.lastPlot)); });
    });
  });
  function typing(e){ var tg = e.target.tagName; return tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA' || tg === 'BUTTON'; }
  function keyWho(e){ return e.code === 'Space' || e.code === 'KeyA' ? 'A' : e.code === 'KeyB' && active && active.fixed.post === 'active' ? 'B' : null; }
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') $$('.fs').forEach(function(x){ x.classList.remove('fs'); var b = $('[data-fs]', x); if(b) b.textContent = x.classList.contains('fsbox') ? '⤢ 全螢幕' : '⤢'; });
    var who = keyWho(e);
    if(who && !e.repeat && active && !typing(e)){ e.preventDefault(); setHold(active, who, true); }
  });
  document.addEventListener('keyup', function(e){
    var who = keyWho(e);
    if(who && active && !typing(e)){ e.preventDefault(); if(!active.latch[who]) setHold(active, who, false); }
  });
  window.addEventListener('resize', function(){ Object.keys(SIMS).forEach(function(k){ sizeCanvas(SIMS[k].cv); }); });
  Object.keys(SIMS).forEach(function(k){
    var s = SIMS[k];
    s.cv.addEventListener('pointermove', function(e){ var r = s.cv.getBoundingClientRect(); s.cursor = e.clientX - r.left; });
    s.cv.addEventListener('pointerleave', function(){ s.cursor = null; });
  });

  /* ---------------- start ---------------- */
  document.body.dataset.mode = MODE;
  $$('.mode button').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.mode === MODE ? 'true' : 'false'); });
  Object.keys(SIMS).forEach(function(k){ var s = SIMS[k]; nodeOptions(s); buildPanels(s); syncControls(s); drawSchematic(s); sizeCanvas(s.cv); });
  requestAnimationFrame(frame);
  /* run(s, T): advance region s by T seconds without the animation loop (console checks) */
  function run(s, T){ activate(s); for(var k = Math.round(T / DT); k > 0; k--){ runEvents(s); s.E.step(DT); sample(s); } drawScope(s); updateUI(s); }
  window.HW3 = {SIMS:SIMS, activate:activate, setMode:setMode, press:press, trainA:trainA, combo:combo, setHold:setHold, engineState:engineState, isiSweep:isiSweep, run:run};
})();
