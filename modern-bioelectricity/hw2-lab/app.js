/* HW2 實驗台：one engine (../active-membrane-sim/engine.js, same model as hw2-debug/sim/sim.py)
   drives whichever simulation region is on screen.  Each region keeps its own settings for the
   basic and the advanced mode; switching region or mode re-applies them and powers the circuit on. */
(function(){
  'use strict';
  var $ = function(s, r){ return (r || document).querySelector(s); };
  var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var DT = 2e-4;
  var MODE = 'basic', FLOW = true;
  try{ MODE = localStorage.getItem('hw2mode') === 'adv' ? 'adv' : 'basic'; FLOW = localStorage.getItem('hw2flow') !== '0'; }catch(e){}

  /* the board as built (PCB), with the TA's 1 Mohm in the Slow out R2 position (every board has it now) */
  var BASE_ST = {vplus:7.8, rpot:700, r13:1e5, rfe:1e5, qs:'pcb', so_r2:1e6, rprobe:1e7, ch1:'Vm', ch2:'',
    r13p:0, rf:0, rb:0, rs:0, rl:0, ru:0, chain:0, src:'stim', isrc:50e-6, fi_supply:'stim',
    leak:true, fi_vm:true, fi_vplus:true, fi_gnd:true, so_vm:true, so_gnd:true, fi_on:true, so_on:true, lk2:false, leak2:true};

  /* the 'true AP' add-on set (hw2-debug/sim/check_trueap.py): 22k across Qpass E-B, 11k across
     R13, 680k R13 lower end -> FI.E3, 56k across SO C1, 330k V+ -> Vm (#2-3 adds 560k V+ -> each unit) */
  var TRUE_AP = {so_r2:1e6, qs:'rx', r13p:11e3, rf:680e3, rs:56e3, rb:330e3};

  /* ---------------- simulation regions ---------------- */
  var SIMS = {
    s21:{
      def:{basic:{rpot:700, ch2:'Vm'},
           adv:{rpot:700, src:'stim', isrc:50e-6, qs:'pcb', vplus:7.8, ch1:'PC1', ch2:'Vm'}},
      fixed:function(m, s){ var f = {chain:4, fi_on:false, so_on:false}; if(m === 'basic') f.ch1 = 'PC1'; return f; },
      sch:function(st){ return {chain:4, passiveOnly:true}; },
      meas:['global', 'global'], scope:{v1:0.5, v2:0.5, t:0.1, z2:1}
    },
    s22:{
      def:{basic:{rpot:700, leak:true, fi_on:true, so_on:true, r13:1e5, ch2:''},
           adv:{rpot:700, leak:true, fi_on:true, so_on:true, ch2:''}},
      fixed:function(m){ return {}; },
      sch:function(st){ return {chain:0, lk2:!!st.lk2}; },
      meas:['firstAP', 'global'], scope:{v1:1, v2:0.5, t:0.05, z2:1},
      /* basic: the circuit as given, or with a second Leak board stacked on the first */
      presetsBasic:[
        ['kit', '原版電路', {lk2:false}, '助教給的電路（R2 = 1 MΩ）：不按也每 0.1 秒左右冒一個約 1.5 V 小峰（Stimulator 漏電 6.3 µA × 100 kΩ 把 Vm 墊在 FI 門檻）；按下的第一個峰約 2.1 V，按住停在 0.78 V。'],
        ['lk2', '多疊一個 LK', {lk2:true}, 'LK 上面再疊一塊 LK（同一組排針，直接接 Vm，中間沒有 10 kΩ／100 Ω）：R_leak 變 50 kΩ、C_m 變 2 µF，τ 一樣 100 ms。漏電 6.3 µA 只把 Vm 墊到 0.30 V，低於 FI 門檻，不再自己冒峰。按 10 ms 以上才觸發（按 5 ms 只到 0.5 V，和拔掉 FI 一樣）；按 10 ms 放開後 FI 繼續推，約 60 ms 後到 1.5 V（拔 FI 只有 0.7 V）。按 100 ms：峰值 2.3 V（拔 FI 1.8 V）、半高寬約 32 ms；按住只發一次，停在 0.77 V；沒有低於靜止的後過極化。']
      ],
      basicPreset:'kit',
      presets:[
        ['kit', '原版電路', {}, '助教給的電路（同基礎目標，R2 = 1 MΩ）：不按也每 0.1 秒左右冒一個約 1.5 V 小峰（Stimulator 漏電把 Vm 墊在 FI 門檻）；按下到約 2.1 V，按住停在 0.78 V。'],
        ['true', '真正的 AP', Object.assign({rpot:0}, TRUE_AP), 'R2 = 1 MΩ 再外加 5 顆電阻（見摘要區）：靜止 1.19 V、門檻約 1.66 V、AP 5.2–5.4 V、AP 後低於靜止約 0.6 V（125 ms）、AP 後 20 ms 內不能再發；按住時連續發放。']
      ]
    },
    s23:{
      def:{basic:{chain:4, rpot:700, ch2:'AX'},
           adv:{chain:4, rpot:0, fi_supply:'stim', src:'stim', isrc:40e-6, ch2:'AX', fi_on:true, so_on:true}},
      fixed:function(m, s){ return {}; },
      sch:function(st){ return {chain:st.chain}; },
      meas:['firstAP', 'signed'], scope:{v1:1, v2:0.02, t:0.1, z2:4},
      /* basic: the circuit as given, with or without the V+ flying wire (hw2-debug/sim/check_23.py combos) */
      presetsBasic:[
        ['kit', '照實：沒飛線', {fi_supply:'none'}, 'FI 沒有 V+：n ≥ 1 只有被動反應，按住 1 秒最高 1.68／1.36／1.12／0.92 V（n = 1–4），再被 SO 慢慢拉到約 0.75 V，沒有尖峰。n = 0 的 V+ 走疊接排針，有電。'],
        ['wire', '有 V+ 飛線', {fi_supply:'stim'}, 'Stimulator 的 V+ 拉一條飛線到 FI.V+：n ≥ 1 有 AP，峰值約 2.3／2.0／1.8／1.6 V（n = 1–4），過門檻 FI 衝高、SO 拉回；沒有後過極化。另一組實測到的就是這個。n = 3、4 按住 0.3 秒以上，放開後會卡在約 0.76 V（FI 和 SO 互相撐住），要斷電重置；n = 0 不按也會自己冒小峰。']
      ],
      basicPreset:'wire',
      presets:[
        ['kit', '原版電路', {fi_supply:'none'}, '原版、沒拉飛線：FI 沒有 V+（Passive PCB 底板沒串），n ≥ 1 只有被動反應，再被 SO 慢慢往下拉。'],
        ['wire', '原版＋V+ 飛線', {fi_supply:'stim'}, 'Stimulator 的 V+ 拉飛線到 FI，其他照原版：n ≥ 1 有 AP（門檻、FI 衝高、SO 拉回），峰值約 2.3–1.6 V（n = 1–4）。Passive unit 的 100 kΩ 吸掉 Stimulator 的 6 µA 漏電，靜止降到 0.1–0.3 V，所以不像 #2-2 會自己冒小峰；但靜止低於 SO 能拉到的約 0.6 V，沒有後過極化（C5）。n = 3、4 按住 0.3 秒以上，放開後卡在約 0.76 V（FI 和 SO 互鎖）。'],
        ['true', '真正的 AP', Object.assign({ru:560e3, fi_supply:'stim', rpot:0}, TRUE_AP), '真正的 AP 外加元件，加上每個 Passive unit 一顆 560 kΩ 接 V+、FI 拉 V+ 線：n = 0–4 靜止都是 1.19 V，都有門檻、all-or-none、後過極化。I_min = 7.6／13.4／20.9／31.0／44.8 µA；量 I_min 時把 Q_pass E–B 改成 12 kΩ。']
      ]
    }
  };
  Object.keys(SIMS).forEach(function(k){
    var s = SIMS[k];
    s.id = k; s.el = $('[data-sim="' + k + '"]'); s.svg = $('svg.sch', s.el); s.cv = $('canvas', s.el);
    s.state = {basic:Object.assign({}, s.def.basic), adv:Object.assign({}, s.def.adv)};
    if(s.presets){ var tp = s.presets[s.presets.length - 1]; Object.assign(s.state.adv, tp[2], {_preset:tp[0], _note:tp[3]}); }
    if(s.presetsBasic){ var bp = s.presetsBasic.filter(function(p){ return p[0] === s.basicPreset; })[0]; Object.assign(s.state.basic, bp[2], {_preset:bp[0], _note:bp[3]}); }
    s.sc = {v1:s.scope.v1, v2:s.scope.v2, t:s.scope.t, z1:1, z2:s.scope.z2, mode:'roll', tsrc:'ch1', lvl:1.0,
            trig:'idle', t0:0, prev:0, frozen:null};
    s.buf = {cap:40000, t:new Float64Array(40000), a:new Float64Array(40000), b:new Float64Array(40000), head:0, n:0};
    s.rec = null; s.SCH = null; s.latch = false; s.pulseEnd = null; s.presetNote = '';
  });

  /* effective engine state for a region in the current mode */
  function engineState(s){
    var u = s.state[MODE];
    var st = Object.assign({}, BASE_ST, u, s.fixed(MODE, u));
    if(st.fi_supply === 'none'){ if(st.chain) st.fi_vplus = false; st.fi_supply = 'stim'; }   /* n = 0: the header carries V+ */
    if(st.ch2 && st.ch2 !== '' && st.chain === 0 && /^(PC|PX|AX)/.test(st.ch2)) st.ch2 = '';
    return st;
  }
  /* how FI.V+ is fed, as the engine has it: header (n = 0) or pulled wire 'stim', FI's battery 'local', 'none' */
  function supplyMode(s){
    var u = s.state[MODE], raw = Object.assign({}, BASE_ST, u, s.fixed(MODE, u)).fi_supply, st = engineState(s);
    if(raw === 'local') return 'local';
    if(!st.chain) return 'stim';
    if(raw === 'none') return 'none';
    return st.fi_vplus || MODE === 'adv' ? 'stim' : 'none';
  }
  function applyEngine(s){
    var st = engineState(s);
    for(var k in st) AM.st[k] = st[k];
    AM.build();
    if(INSP && inspSim === s) INSP.rerender();
  }

  /* ---------------- circuit inspector (inspect.js): click a part or a wire ---------------- */
  var INSP = window.HW2Inspect ? HW2Inspect(AM) : null, inspSim = null;
  function nodeMap(){ var m = {}; AM.branches().forEach(function(b){ if(b.name) m[b.name] = b.nodes; }); return function(n){ return m[n] || null; }; }
  function inspHighlight(s){ if(s.SCH) s.SCH.highlight(INSP && inspSim === s ? INSP.target() : null, nodeMap()); }
  function svgPoint(svg, e){
    var m = svg.getScreenCTM(); if(!m) return null;
    var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(m.inverse());
  }
  function inspectTarget(s, e, geomOnly){
    if(!s.SCH) return null;
    var tg = e.target.closest && e.target.closest('[data-node]');
    if(tg && AM.has(tg.dataset.node)) return {node:tg.dataset.node};
    var p = svgPoint(s.svg, e), h = p && s.SCH.hitAt(p.x, p.y);
    if(!h) return null;
    if(h.part || geomOnly) return h.part ? {part:h.part} : {wire:h.wire};
    var n = s.SCH.netOf(h.wire, nodeMap());
    return n ? {node:n} : null;
  }
  function inspectable(s){
    s.svg.addEventListener('click', function(e){
      if(!INSP || (MODE === 'adv' && e.target.closest('.contact'))) return;   /* advanced: contacts toggle */
      if(active !== s) activate(s);
      var t = inspectTarget(s, e);
      if(!t) return;
      inspSim = s; INSP.open(t, e.clientX, e.clientY); inspHighlight(s);
    });
    s.svg.addEventListener('pointermove', function(e){
      var c = (MODE === 'adv' && e.target.closest('.contact')) || inspectTarget(s, e, true);
      s.svg.style.cursor = c ? 'pointer' : '';
    });
  }
  if(INSP) INSP.onClose(function(){ var s = inspSim; inspSim = null; if(s) inspHighlight(s); });

  /* ---------------- schematic ---------------- */
  function drawSchematic(s){
    var st = engineState(s);
    s.SCH = MembraneSchematic(s.svg, Object.assign({live:MODE === 'adv'}, s.sch(st)));
    if(MODE === 'adv'){
      $$('.contact', s.svg).forEach(function(g){
        g.addEventListener('click', function(){ contact(s, g.dataset.c); });
        g.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); contact(s, g.dataset.c); } });
      });
    }
    syncSchematic(s);
  }
  function syncSchematic0(s){
    if(!s.SCH) return;
    var st = engineState(s);
    st.sw = AM.st.sw && active === s;
    s.SCH.setContacts(st); s.SCH.setQsense(st.qs); s.SCH.setResistors(st.r13, st.rfe, st.so_r2); s.SCH.setAddons(st);
    s.SCH.setSupply(supplyMode(s)); s.SCH.setSource(st.src); s.SCH.setBoards({lk:st.leak, fi:st.fi_on, so:st.so_on});
    s.SCH.setProbes([st.ch1, st.ch2]);
  }
  function syncSchematic(s){ syncSchematic0(s); if(inspSim === s) inspHighlight(s); }
  function contact(s, key){
    if(key === 'sw'){ setSW(s, !AM.st.sw); return; }
    var u = s.state[MODE], cur = engineState(s)[key];
    u[key] = !cur;
    if(active === s) applyEngine(s);
    syncSchematic(s);
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
    var st = engineState(s);
    $$('select[data-nodes]', s.el).forEach(function(sel){
      var kind = sel.dataset.nodes, opts = [];
      if(kind === 'pc'){ for(var k = 1; k <= 4; k++) opts.push(['PC' + k, '第 ' + k + ' 個（PC' + k + '）']); opts.push(['Vm', '第 5 個（最後）']); if(sel.dataset.k === 'ch2') opts.unshift(['', '關']); }
      if(kind === '23'){
        opts.push(['', '關']);
        if(st.chain){ opts.push(['AX', 'AX：active 端細胞外']); for(var j = 1; j <= st.chain; j++) opts.push(['PC' + j, 'PC' + j + (j === 1 ? '（刺激點）' : '')]); }
        opts.push(['SO.S', 'SO.S'], ['FI.E4', 'FI.E4']);
      }
      sel.innerHTML = opts.map(function(o){ return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    });
  }
  function syncControls(s){
    nodeOptions(s);
    var u = s.state[MODE], st = engineState(s);
    $$('[data-k]', s.el).forEach(function(el){
      var blk = el.closest('[data-show]');
      if(blk && blk.dataset.show !== MODE) return;
      setCtl(el, u[el.dataset.k] !== undefined ? u[el.dataset.k] : st[el.dataset.k]);
    });
    $$('[data-out="rpot"]', s.el).forEach(function(o){ o.textContent = ((u.rpot || 0) / 1e3).toFixed(1) + ' kΩ'; });
    $$('[data-nseg] button', s.el).forEach(function(b){ b.setAttribute('aria-pressed', +b.dataset.n === (u.chain || 0) ? 'true' : 'false'); });
    $$('[data-presets] button', s.el).forEach(function(b){ if(boxMode(b) === MODE) b.setAttribute('aria-pressed', b.dataset.p === u._preset ? 'true' : 'false'); });
    $$('[data-preset-note]', s.el).forEach(function(pn){ if(boxMode(pn) === MODE) pn.textContent = u._note || ''; });
    var sc = s.sc;
    $$('[data-sc]', s.el).forEach(function(el){ el.value = String(sc[el.dataset.sc]); });
    $$('[data-scmode]', s.el).forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.scmode === sc.mode ? 'true' : 'false'); });
  }
  /* which mode a preset box belongs to (its data-show block; adv when it has none) */
  function boxMode(el){ var b = el.closest('[data-show]'); return b ? b.dataset.show : 'adv'; }
  function onCtl(s, el){
    var blk = el.closest('[data-show]');
    if(blk && blk.dataset.show !== MODE) return;
    var k = el.dataset.k, u = s.state[MODE];
    u[k] = ctlValue(el);
    if(k === 'rpot') $$('[data-out="rpot"]', s.el).forEach(function(o){ o.textContent = (u.rpot / 1e3).toFixed(1) + ' kΩ'; });
    if(k === 'ch1' || k === 'ch2') clearBuf(s);
    if(active === s) applyEngine(s);
    if(k === 'fi_supply' || k === 'chain') { drawSchematic(s); if(active === s) powerOn(s); }
    else if(k === 'lk2') drawSchematic(s);
    else syncSchematic(s);
  }
  function buildPanels(s){
    var panel = $('.settings', s.el);
    /* schematic: electron flow on / off (shared by all regions) */
    var sg = $('[data-scope]', panel).closest('.grp'), fg = document.createElement('div');
    fg.className = 'grp';
    fg.innerHTML = '<div class="gt">電路圖</div><label class="chk"><input type="checkbox" data-flow> 顯示電子流動</label>' +
      '<p class="small muted" style="margin:2px 0 0">橘點＝電子：逆著電流方向、往電池＋極走，越快＝電流越大（20 nA 以下不畫）。AP 只有十幾 ms，把下面的「速度」調到 1/100× 才看得到 AP 期間的電子。紫紅色＝和原版電路不同的地方。</p>';
    sg.parentNode.insertBefore(fg, sg);
    var cb = $('[data-flow]', fg); cb.checked = FLOW;
    cb.addEventListener('change', function(){ setFlow(cb.checked); });
    /* pulse buttons */
    $$('[data-pulses]', panel).forEach(function(box){
      box.innerHTML = box.dataset.pulses.split(',').map(function(x){
        var T = +x; return '<button class="btn" type="button" data-t="' + T + '">按 ' + (T >= 1 ? T + ' s' : Math.round(T * 1e3) + ' ms') + '</button>';
      }).join('');
      $$('button', box).forEach(function(b){ b.addEventListener('click', function(){ pressFor(s, +b.dataset.t); }); });
    });
    var go = $('[data-pulse-go]', panel);
    if(go) go.addEventListener('click', function(){ pressFor(s, +$('[data-pulse-ms]', panel).value / 1e3); });
    /* n selector */
    $$('[data-nseg]', panel).forEach(function(box){
      box.innerHTML = [0, 1, 2, 3, 4].map(function(n){ return '<button class="btn" type="button" data-n="' + n + '">' + n + '</button>'; }).join('');
      $$('button', box).forEach(function(b){ b.addEventListener('click', function(){
        s.state[MODE].chain = +b.dataset.n; syncControls(s); clearBuf(s);
        drawSchematic(s); if(active === s){ applyEngine(s); powerOn(s); }
      }); });
    });
    /* presets */
    $$('[data-presets]', panel).forEach(function(box){
      var m = boxMode(box), list = m === 'basic' ? s.presetsBasic : s.presets;
      box.innerHTML = list.map(function(p){ return '<button class="btn" type="button" data-p="' + p[0] + '">' + p[1] + '</button>'; }).join('');
      $$('button', box).forEach(function(b){ b.addEventListener('click', function(){
        var p = list.filter(function(x){ return x[0] === b.dataset.p; })[0];
        var keep = {chain:s.state[m].chain, ch2:s.state[m].ch2, rpot:s.state[m].rpot};
        s.state[m] = Object.assign({}, s.def[m], keep, p[2], {_preset:p[0], _note:p[3]});   /* def has no add-ons */
        syncControls(s); drawSchematic(s); if(active === s){ applyEngine(s); powerOn(s); }
      }); });
    });
    /* scope controls */
    $$('[data-scope]', panel).forEach(function(box){
      var vd = function(sel){ return [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2].map(function(v){ return '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + (v < 0.1 ? v * 1e3 + ' mV' : v + ' V') + '</option>'; }).join(''); };
      box.innerHTML =
        '<div class="row"><label>CH1 V/div</label><select data-sc="v1">' + vd(s.sc.v1) + '</select></div>' +
        '<div class="row"><label>CH2 V/div</label><select data-sc="v2">' + vd(s.sc.v2) + '</select></div>' +
        '<div class="row"><label>時間/div</label><select data-sc="t">' + [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5].map(function(v){ return '<option value="' + v + '">' + (v * 1e3) + ' ms</option>'; }).join('') + '</select></div>' +
        '<div class="btns" style="margin:4px 0"><button class="btn" type="button" data-scmode="roll">Roll</button><button class="btn" type="button" data-scmode="single">Single</button><button class="btn" type="button" data-arm>重新擷取</button></div>' +
        '<div class="row"><label>速度</label><select data-sc="speed"><option value="1">1×</option><option value="0.25">¼×</option><option value="0.05">1/20×</option><option value="0.01">1/100×</option><option value="0">暫停</option></select></div>' +
        '<div data-show="adv"><div class="row"><label>觸發</label><select data-sc="tsrc"><option value="ch1">CH1 上升</option><option value="sw">按下 SW</option></select></div>' +
        '<div class="row"><label>觸發準位（V）</label><input type="number" step="0.1" data-sc="lvl" style="width:5em"></div>' +
        '<div class="row"><label>CH2 零點</label><select data-sc="z2"><option value="1">底部</option><option value="4">中間</option></select></div></div>' +
        '<p class="small muted" data-trigstate style="margin:2px 0 0"></p>';
      s.sc.speed = 1;
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
        ['基線', '峰值', '振幅', '到峰', '半高寬', 'rise τ', 'decay τ'].map(function(r, i){ return '<tr><td>' + r + '</td><td data-m="a' + i + '">—</td><td data-m="b' + i + '">—</td></tr>'; }).join('') +
        '</table><p class="small" style="margin:4px 0 0">刺激電流：<span class="mono" data-m="I">—</span>　Vm：<span class="mono" data-m="vm">—</span></p>';
    });
    /* SW */
    var sb = $('[data-sw]', panel);
    sb.addEventListener('pointerdown', function(e){ e.preventDefault(); sb.setPointerCapture(e.pointerId); s.down = true; activate(s); setSW(s, true); });
    var up = function(){ if(!s.down) return; s.down = false; if(!s.latch) setSW(s, false); };
    sb.addEventListener('pointerup', up); sb.addEventListener('pointercancel', up);
    $$('[data-latch]', panel).forEach(function(c){ c.addEventListener('change', function(){ s.latch = c.checked; activate(s); setSW(s, c.checked); }); });
    $$('[data-reset]', panel).forEach(function(b){ b.addEventListener('click', function(){ activate(s); powerOn(s); }); });
    /* parameter controls */
    $$('[data-k]', panel).forEach(function(el){
      el.addEventListener(el.type === 'range' ? 'input' : 'change', function(){ onCtl(s, el); });
    });
  }

  /* ---------------- running ---------------- */
  var active = null, running = true;
  function clearBuf(s){ s.buf.head = 0; s.buf.n = 0; s.sc.frozen = null; }
  function powerOn(s){
    applyEngine(s); AM.st.sw = false; AM.build(); AM.powerOn();
    s.pulseEnd = null; s.rec = null; clearBuf(s); if(s.sc.mode === 'single') arm(s);
    var b = $('[data-sw]', s.el); b.classList.remove('on'); b.textContent = '按住 SW';
    $$('[data-latch]', s.el).forEach(function(c){ c.checked = false; }); s.latch = false;
    syncSchematic(s);
  }
  function setFlow(on){
    FLOW = !!on;
    try{ localStorage.setItem('hw2flow', FLOW ? '1' : '0'); }catch(e){}
    $$('[data-flow]').forEach(function(c){ c.checked = FLOW; });
    if(!FLOW) Object.keys(SIMS).forEach(function(k){ var s = SIMS[k]; if(s.SCH) s.SCH.flow(0, null); });
  }
  function activate(s){
    if(active === s) return;
    if(active){ AM.st.sw = false; var ob = $('[data-sw]', active.el); ob.classList.remove('on'); ob.textContent = '按住 SW'; syncSchematic(active);
      if(active.SCH) active.SCH.flow(0, null); }
    active = s;
    if(INSP && inspSim && inspSim !== s) INSP.close();
    powerOn(s);
  }
  function setSW(s, on){
    if(active !== s) activate(s);
    if(on && !AM.st.sw){
      s.rec = {t0:AM.time(), t:[], a:[], b:[], imax:0};
      if(s.sc.mode === 'single' && s.sc.tsrc === 'sw' && s.sc.trig === 'armed'){ s.sc.trig = 'capturing'; s.sc.t0 = AM.time(); }
    }
    AM.st.sw = on; AM.build();
    var b = $('[data-sw]', s.el); b.classList.toggle('on', on); b.textContent = on ? 'SW 按下中' : '按住 SW';
    if(!on) s.pulseEnd = null;
    syncSchematic(s);
  }
  function pressFor(s, T){ activate(s); setSW(s, false); setSW(s, true); s.pulseEnd = AM.time() + T; }
  function arm(s){ s.sc.trig = 'armed'; s.sc.frozen = null; s.sc.prev = AM.v(AM.st.ch1); }

  function sample(s){
    var b = s.buf, st = AM.st, t = AM.time(), a = AM.v(st.ch1), c = st.ch2 ? AM.v(st.ch2) : NaN;
    b.t[b.head] = t; b.a[b.head] = a; b.b[b.head] = c; b.head = (b.head + 1) % b.cap; if(b.n < b.cap) b.n++;
    var sc = s.sc;
    if(sc.mode === 'single'){
      if(sc.tsrc === 'ch1' && sc.trig === 'armed' && sc.prev < sc.lvl && a >= sc.lvl){ sc.trig = 'capturing'; sc.t0 = t; }
      if(sc.trig === 'capturing' && t >= sc.t0 + 9 * sc.t){ sc.frozen = windowOf(s, sc.t0 - sc.t, sc.t0 + 9 * sc.t); sc.trig = 'done'; }
      sc.prev = a;
    }
    if(s.rec && s.rec.t.length < 25000){
      s.rec.t.push(t - s.rec.t0); s.rec.a.push(a); s.rec.b.push(c);
      if(st.sw){ var I = -AM.q('pass')[0] + (st.src === 'ideal' ? st.isrc : 0); if(I > s.rec.imax) s.rec.imax = I; }
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
    if(s && running){
      carry += real * (s.sc.speed === undefined ? 1 : s.sc.speed);
      var n = Math.floor(carry / DT); carry -= n * DT;
      for(var k = 0; k < n; k++){
        AM.step(DT);
        if(s.pulseEnd !== null && AM.time() >= s.pulseEnd){ s.pulseEnd = null; setSW(s, false); }
        sample(s);
      }
      drawScope(s);
      if(s.SCH && FLOW) s.SCH.flow(real, AM.currents());   /* real time: the dots keep moving when paused or slowed */
      if(now - lastUI > 100){ updateUI(s); lastUI = now; }
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- scope ---------------- */
  function sizeCanvas(s){
    var r = s.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    s.cv.width = Math.max(10, Math.round(r.width * dpr)); s.cv.height = Math.max(10, Math.round(r.height * dpr));
  }
  function fmtV(v){ return Math.abs(v) < 0.1 ? (v * 1e3).toFixed(1) + ' mV' : v.toFixed(2) + ' V'; }
  function drawScope(s){
    var cv = s.cv, ctx = cv.getContext('2d'), W = cv.width, H = cv.height, dpr = window.devicePixelRatio || 1, sc = s.sc, st = AM.st;
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
    else { var tn = AM.time(); w = windowOf(s, tn - 10 * sc.t, tn); }
    var X = function(t){ return (t - w.t0) / (w.t1 - w.t0) * W; };
    function mark(y, c){ ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, y - 6 * dpr); ctx.lineTo(9 * dpr, y); ctx.lineTo(0, y + 6 * dpr); ctx.fill(); }
    mark(y1, '#3987e5'); if(st.ch2) mark(y2, '#e0703f');
    function trace(arr, Y, col){
      var n = w.t.length; if(n < 2) return;
      var stride = Math.max(1, Math.floor(n / (W * 1.5)));
      ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr; ctx.lineJoin = 'round'; ctx.beginPath();
      var on = false;
      for(var k = 0; k < n; k += stride){ var v = arr[k]; if(isNaN(v)) continue; var x = X(w.t[k]), y = Math.max(-4, Math.min(H + 4, Y(v))); if(!on){ ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    if(st.ch2) trace(w.b, Y2, '#e0703f');
    trace(w.a, Y1, '#3987e5');
    ctx.font = (12 * dpr) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#3987e5'; ctx.fillText('CH1 ' + st.ch1 + '  ' + (sc.v1 < 0.1 ? sc.v1 * 1e3 + ' mV' : sc.v1 + ' V') + '/div', 8 * dpr, H - 8 * dpr);
    if(st.ch2){ ctx.fillStyle = '#e0703f'; ctx.fillText('CH2 ' + st.ch2 + '  ' + (sc.v2 < 0.1 ? sc.v2 * 1e3 + ' mV' : sc.v2 + ' V') + '/div', 8 * dpr, 16 * dpr); }
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    var tl = (sc.t * 1e3) + ' ms/div' + (sc.mode === 'single' ? '  Single' : '');
    ctx.fillText(tl, W - ctx.measureText(tl).width - 34 * dpr, H - 8 * dpr);
    if(s.cursor != null && w.t.length){
      var cx = s.cursor * dpr, tc = w.t0 + cx / W * (w.t1 - w.t0), lo = 0, hi = w.t.length - 1;
      while(hi - lo > 1){ var mid = (lo + hi) >> 1; if(w.t[mid] < tc) lo = mid; else hi = mid; }
      var j = (tc - w.t[lo] < w.t[hi] - tc) ? lo : hi;
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      var txt = 't ' + ((w.t[j] - (sc.mode === 'single' && sc.trig !== 'armed' ? sc.t0 : w.t1)) * 1e3).toFixed(1) + ' ms  CH1 ' + w.a[j].toFixed(3) + ' V' + (st.ch2 ? '  CH2 ' + fmtV(w.b[j]) : '');
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(txt, W - ctx.measureText(txt).width - 34 * dpr, 16 * dpr);
    }
    var ts = $('[data-trigstate]', s.el);
    if(ts) ts.textContent = sc.mode === 'roll' ? '' : ({armed:'等待觸發…', capturing:'擷取中…', done:'已擷取'})[sc.trig] || '';
  }

  /* ---------------- measurements of the last press ---------------- */
  function metrics(t, v, kind, refIdx){
    if(!t.length) return null;
    var base = v[0], ip = -1, i;
    if(kind === 'signed'){
      var end = refIdx != null ? Math.min(v.length, refIdx + 250) : v.length, best = 0;
      for(i = 0; i < end; i++){ if(!isNaN(v[i]) && Math.abs(v[i] - base) > best){ best = Math.abs(v[i] - base); ip = i; } }
    } else {
      if(kind === 'firstAP'){
        for(i = 1; i < v.length - 1; i++) if(v[i] - base > 0.5 && v[i] >= v[i - 1] && v[i] > v[i + 1]){ ip = i; break; }
      }
      if(ip < 0){ var mx = -Infinity; for(i = 0; i < v.length; i++) if(v[i] > mx){ mx = v[i]; ip = i; } }
    }
    if(ip < 0) return null;
    var a = v[ip] - base; if(Math.abs(a) < 1e-6) return {base:base, peak:v[ip], amp:0};
    var f = function(x){ return (x - base) / a; };
    var r = null; for(i = 0; i <= ip; i++) if(f(v[i]) >= 0.632){ r = t[i]; break; }
    var d = null; for(i = ip; i < v.length; i++) if(f(v[i]) <= 0.368){ d = t[i] - t[ip]; break; }
    var lo = ip; while(lo > 0 && f(v[lo]) >= 0.5) lo--;
    var hi = ip; while(hi < v.length - 1 && f(v[hi]) >= 0.5) hi++;
    var hw = (hi < v.length - 1 && f(v[hi]) < 0.5) ? t[hi] - t[lo] : null;
    return {base:base, peak:v[ip], amp:a, tp:t[ip], hw:hw, rise:r, decay:d, ip:ip};
  }
  function updateUI(s){
    var st = AM.st, set = function(k, txt){ var e = $('[data-m="' + k + '"]', s.el); if(e) e.textContent = txt; };
    set('vm', AM.v('Vm').toFixed(3) + ' V');
    var rec = s.rec;
    if(rec && rec.t.length > 2){
      var m1 = metrics(rec.t, rec.a, s.meas[0]);
      var m2 = st.ch2 ? metrics(rec.t, rec.b, s.meas[1], m1 ? m1.ip : null) : null;
      [[m1, 'a'], [m2, 'b']].forEach(function(p){
        var m = p[0], c = p[1], V = function(x){ return x == null ? '—' : fmtV(x); }, ms = function(x){ return x == null ? '—' : (x * 1e3).toFixed(1) + ' ms'; };
        var row = m ? [V(m.base), V(m.peak), V(m.amp), ms(m.tp), ms(m.hw), ms(m.rise), ms(m.decay)] : ['—', '—', '—', '—', '—', '—', '—'];
        row.forEach(function(x, i){ set(c + i, x); });
      });
      set('I', rec.imax > 0 ? (rec.imax * 1e6).toFixed(1) + ' µA' : '—');
    }
    s.SCH && s.SCH.setValues(function(code){ return AM.has(code) ? AM.v(code) : null; });
    var qp = AM.q('pass'), q4 = AM.q('fi4403'), q6 = AM.q('so4403');
    var Is = -qp[0] + (st.src === 'ideal' && st.sw ? st.isrc : 0);
    s.SCH && s.SCH.setCurrents({iStim:Is, iFi:-q4[0], iSo:q6[2]});
    s.SCH && s.SCH.setOn({qPass:-qp[0] > 2e-6, qSense:-AM.q('sense')[0] > 2e-6, qFi3904:AM.q('fi3904')[0] > 2e-6,
      qFi4403:-q4[0] > 2e-6, qSo3904:AM.q('so3904')[0] > 2e-6, qSo4403:-q6[0] > 2e-6});
    if(INSP && inspSim === s) INSP.update();
  }

  /* ---------------- mode, navigation, fullscreen, mermaid ---------------- */
  function setMode(m){
    MODE = m; document.body.dataset.mode = m;
    try{ localStorage.setItem('hw2mode', m); }catch(e){}
    $$('.mode button').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'); });
    Object.keys(SIMS).forEach(function(k){ var s = SIMS[k]; syncControls(s); drawSchematic(s); });
    if(active){ var a = active; active = null; activate(a); }
  }
  $$('.mode button').forEach(function(b){ b.addEventListener('click', function(){ setMode(b.dataset.mode); }); });

  var navLinks = $$('nav.regions a');
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting && e.intersectionRatio >= 0.5){
        navLinks.forEach(function(a){ a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); });
        var key = e.target.dataset.sim;
        if(key){ var s = SIMS[key]; activate(s); sizeCanvas(s); }
      }
    });
  }, {root:$('#main'), threshold:[0.5]});
  $$('.region').forEach(function(r){ io.observe(r); });

  $$('[data-fs]').forEach(function(b){
    b.addEventListener('click', function(){
      var box = b.closest('.pane, .fsbox'), on = !box.classList.contains('fs');
      box.classList.toggle('fs', on); b.textContent = on ? '✕' : (box.classList.contains('fsbox') ? '⤢ 全螢幕' : '⤢');
      Object.keys(SIMS).forEach(function(k){ sizeCanvas(SIMS[k]); });
    });
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') $$('.fs').forEach(function(x){ x.classList.remove('fs'); var b = $('[data-fs]', x); if(b) b.textContent = x.classList.contains('fsbox') ? '⤢ 全螢幕' : '⤢'; });
    var tg = e.target.tagName;
    if(e.code === 'Space' && !e.repeat && active && tg !== 'INPUT' && tg !== 'SELECT' && tg !== 'TEXTAREA' && tg !== 'BUTTON'){ e.preventDefault(); setSW(active, true); }
  });
  document.addEventListener('keyup', function(e){
    var tg = e.target.tagName;
    if(e.code === 'Space' && active && tg !== 'INPUT' && tg !== 'SELECT' && tg !== 'TEXTAREA' && tg !== 'BUTTON'){ e.preventDefault(); if(!active.latch) setSW(active, false); }
  });
  window.addEventListener('resize', function(){ Object.keys(SIMS).forEach(function(k){ sizeCanvas(SIMS[k]); }); });

  Object.keys(SIMS).forEach(function(k){
    var s = SIMS[k];
    inspectable(s);
    s.cv.addEventListener('pointermove', function(e){ var r = s.cv.getBoundingClientRect(); s.cursor = e.clientX - r.left; });
    s.cv.addEventListener('pointerleave', function(){ s.cursor = null; });
  });

  if(window.mermaid){
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({startOnLoad:false, theme:dark ? 'dark' : 'neutral', securityLevel:'loose', flowchart:{useMaxWidth:false}});
    $$('details[data-mm]').forEach(function(d){
      d.addEventListener('toggle', function(){
        var pre = $('pre.mermaid', d);
        if(d.open && pre && !pre.dataset.done){ pre.dataset.done = '1'; mermaid.run({nodes:[pre]}); }
      });
    });
  }

  /* static full drawings of the true-AP circuit (summary, advanced) */
  $$('svg[data-trueap]').forEach(function(svg){
    var nn = +svg.dataset.trueap, st = Object.assign({}, BASE_ST, TRUE_AP, nn ? {chain:nn, ru:560e3} : {});
    var sch = MembraneSchematic(svg, {chain:nn});
    sch.setContacts(st); sch.setQsense(st.qs); sch.setResistors(st.r13, st.rfe, st.so_r2); sch.setAddons(st); sch.setSupply('stim');
  });

  /* ---------------- start ---------------- */
  document.body.dataset.mode = MODE;
  $$('.mode button').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.mode === MODE ? 'true' : 'false'); });
  Object.keys(SIMS).forEach(function(k){ var s = SIMS[k]; buildPanels(s); syncControls(s); drawSchematic(s); sizeCanvas(s); });
  requestAnimationFrame(frame);
  window.HW2 = {SIMS:SIMS, activate:activate, setMode:setMode, pressFor:pressFor, engineState:engineState};
})();
