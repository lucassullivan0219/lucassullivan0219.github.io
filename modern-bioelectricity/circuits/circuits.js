/* The three circuit types for every homework circuit, written once and read by the HW2 / HW3 benches
   and by SPIKE LAB (decided 2026-10-22, project cards MB-0085, MB-0086, MB-0088).

     kit    原版電路：the wiring the TA currently assigns to the whole class (exactly one)
     mine   我的電路：what our group actually built (exactly one)
     ideal  理想電路：circuits the simulation says work best, or that the user asked for (any number);
            they may never be built.  The one with def:true is the default.

   Each type gives engine overrides on top of the board as built:
     hw:2  keys of ../active-membrane-sim/engine.js (AM.st)
     hw:3  keys of ../hw3-lab/engine.js (SynEngine().st)
   tune: values an ideal circuit lets you adjust, each with the reason it is there.

   Edit rule: when the teacher changes the class wiring, or we change our boards, change only this file
   and write a project card. */
var CIRCUITS = (function(){
  var BB_ST = {qs:'sw', stdiode:true, vplus:9};                         /* breadboard Stimulator, own 9 V */
  var ADD = {so_r2:1e6, qs:'rx', rxv:22e3, r13p:11e3, rf:680e3, rs:56e3, rb:330e3};   /* add-on-only true AP */
  var T = {
    rxv:{key:'rxv', min:8e3, max:47e3, step:1e3, unit:'Ω', zh:'Q_pass E–B 並聯：消掉 SW 放開時約 6 µA 的漏電。越小漏電越少，但可變電阻能調的電流範圍越窄。',
         en:'Across Q_pass E–B: kills the ~6 µA leak while SW is released. Smaller = less leak, but a narrower current range.'},
    r13p:{key:'r13p', min:3e3, max:47e3, step:1e3, unit:'Ω', zh:'R13 兩端並聯：FI 能送約 0.6 mA，AP 才有快速、再生性的上升。',
          en:'Across R13: lets Fast Inward push ~0.6 mA, so the AP rises fast and regenerates.'},
    rf:{key:'rf', min:330e3, max:1.5e6, step:10e3, unit:'Ω', zh:'R13 下端到 FI.E3：把 FI 門檻抬到約 1.66 V，高於靜止電位。',
        en:'R13 lower end to FI.E3: lifts the FI threshold to ~1.66 V, above rest.'},
    rb:{key:'rb', min:220e3, max:680e3, step:10e3, unit:'Ω', zh:'V+ 到 Vm：靜止抬到約 1.19 V，高於 Slow out 能拉到的 0.6 V，AP 後才有後過極化。',
        en:'V+ to Vm: rest moves up to ~1.19 V, above where Slow Out can pull, so the AP has an undershoot.'},
    rs:{key:'rs', min:22e3, max:150e3, step:1e3, unit:'Ω', zh:'SO 的 C1 兩腳並聯：SO.S = 0.36 Vm，靜止時 Slow out 關、AP 時打開。',
        en:'Across Slow Out C1: SO.S = 0.36 Vm, so Slow Out is off at rest and opens during the AP.'},
    ru:{key:'ru', min:330e3, max:1.5e6, step:10e3, unit:'Ω', zh:'V+ 到每個 Passive unit：每段膜靜止都約 1.19 V，被動鏈不會把 active 端拉低。',
        en:'V+ to every Passive Unit: every patch rests at ~1.19 V, so the cable does not drag the active end down.'},
    r1p:{key:'r1p', min:1e5, max:4.7e6, step:1e5, unit:'Ω', zh:'突觸 820 kΩ 兩端並聯：Q2 基極夠高才會導通，EPSP 才傳得過去。越小 EPSP 越大，太小會飽和。',
         en:'Across the synapse 820 kΩ: Q2 base gets high enough to conduct. Smaller = bigger EPSP, too small saturates.'}
  };
  function tune(){ return Array.prototype.slice.call(arguments).map(function(k){ return T[k]; }); }
  var KIT3 = {pre:'kit', postMem:'kit', r1p:0, r13A:0, r6:0, vsyn:0};
  var TRUE_SYN = {pre:'true', postMem:'true', r1p:1.5e6, r13A:0};

  return {
    TUNE:T,                                                           /* tunable values with their purpose (SPIKE LAB) */
    updated:'2026-10-22',
    battery:{mine:8.44, note:'我們的 9 V 電池，2026-10-21 電表量 8.44 V'},
    c21:{hw:2, title:'#2-1 Passive',
      kit:{st:{}, zh:'助教給的電路：Stimulator → 5 個 Passive unit。'},
      mine:{st:{}, zh:'和原版相同。'},
      ideal:[
        {id:'bbst', zh:'麵包板 ST', en:'Breadboard Stimulator', st:BB_ST, tune:[],
         note:'Stimulator 改插麵包板：Q_sense 接在 SW 之後（不漏電）、輸出串 1N4148、自己的 9 V。其他照原版。'},
        {id:'add', zh:'加電阻 ST', en:'Add-on Stimulator', def:true, st:{qs:'rx', rxv:22e3}, tune:tune('rxv'),
         note:'Q_pass E–B 夾 22 kΩ，消掉 6 µA 漏電，不割線。第 1 個 unit 的基線回到 0 V。'}]},
    c22:{hw:2, title:'#2-2 Active',
      kit:{st:{}, zh:'助教給的電路：R2 = 1 MΩ、R13 = 100 kΩ。'},
      mine:{st:{}, zh:'和原版相同（HW2 真 AP 的外加電阻沒做）。'},
      ideal:[
        {id:'bbst', zh:'麵包板 ST＋4 顆電阻', en:'Breadboard Stimulator + 4 add-ons',
         st:Object.assign({}, ADD, {rb:390e3}, BB_ST), tune:tune('r13p', 'rf', 'rb', 'rs'),
         note:'麵包板 ST＋PCB 上外加 4 顆電阻：靜止 1.19 V；按 8 ms 以上觸發；AP 5.7–6.0 V（拔 FI 3.2 V）；AP 後 0.58 V（約 134 ms）；按住約 31 Hz 連續發放。數字是 10-17 的 MB-025，當時沒夾 ×1 探棒。'},
        {id:'add', zh:'只加電阻（真正的 AP）', en:'Add-ons only (true AP)', def:true, st:Object.assign({}, ADD, {rpot:0}),
         tune:tune('rxv', 'r13p', 'rf', 'rb', 'rs'),
         note:'R2 = 1 MΩ 再外加 5 顆電阻（22 k、11 k、680 k、330 k、56 k）：靜止 1.19 V（不夾探棒；夾 ×1 探棒約 1.14 V）、門檻約 1.66 V、AP 5.2–5.4 V、AP 後低於靜止約 0.6 V（125 ms）、AP 後 20 ms 內不能再發；按住時連續發放。'}]},
    c23:{hw:2, title:'#2-3 Passive → active',
      kit:{st:{fi_supply:'stim'}, zh:'助教給的電路，含 V+ 飛線（反應後老師要大家都拉）。'},
      mine:{st:{fi_supply:'stim'}, zh:'和原版相同（有拉 V+ 飛線）。'},
      ideal:[
        {id:'bbst', zh:'麵包板 ST＋外加電阻', en:'Breadboard Stimulator + add-ons',
         st:Object.assign({}, ADD, {rb:390e3, ru:680e3, fi_supply:'stim'}, BB_ST), tune:tune('r13p', 'rf', 'rb', 'rs', 'ru'),
         note:'麵包板 ST＋每個 Passive unit 680 kΩ 接 V+：n = 0–4 靜止 1.18–1.19 V；I_min = 12.8／22.1／33.2／48.4／69.4 µA；75 µA 時 delay = 20／40／66／111／334 ms（MB-025）。'},
        {id:'add', zh:'只加電阻（真正的 AP）', en:'Add-ons only (true AP)', def:true,
         st:Object.assign({}, ADD, {ru:560e3, fi_supply:'stim', rpot:0}), tune:tune('rxv', 'r13p', 'rf', 'rb', 'rs', 'ru'),
         note:'真正的 AP 外加元件，加上每個 Passive unit 一顆 560 kΩ 接 V+、FI 拉 V+ 線：n = 0–4 靜止都是 1.19 V，都有門檻、all-or-none、後過極化。I_min = 7.6／13.4／20.9／31.0／44.8 µA；量 I_min 時把 Q_pass E–B 改成 12 kΩ。'}]},
    c31:{hw:3, title:'#3-1 Excitatory → passive',
      kit:{st:KIT3, zh:'助教的電路：Pre 是原版 active membrane；820 kΩ : 100 kΩ 分壓讓 Q2 不導通，沒有 EPSP。'},
      mine:{st:Object.assign({}, KIT3, {r1p:1e5}), zh:'我們 2026-10-21 的改法：820 kΩ 兩端並 100 kΩ。實測 EPSP 約 6.5 V（飽和）。'},
      ideal:[
        {id:'fi1k', zh:'只改 FI（R13 1 kΩ）', en:'FI only (R13 1 kΩ)', st:Object.assign({}, KIT3, {r13A:1e3}), tune:[],
         note:'Pre 的 R13 從 100 kΩ 換成講義畫的 1 kΩ，突觸不動：AP 約 1.8 → 7.6 V，#1 EPSP 約 0.07–0.22 V（不飽和，能疊加）。'},
        {id:'hw2', zh:'HW2 真 AP', en:'HW2 true AP', st:Object.assign({}, KIT3, {pre:'true', postMem:'true'}), tune:[],
         note:'Pre 換成 HW2 真正的 AP（約 5.4 V），突觸板不加東西：Q2 幾乎不導通，沒有 EPSP。'},
        {id:'syn', zh:'真正的突觸', en:'True synapse', def:true, st:TRUE_SYN, tune:tune('r1p'),
         note:'HW2 真正的 AP ＋ 820 kΩ 兩端並 1.5 MΩ：一個 AP 在 #1 產生約 0.91 V、#5 約 0.24 V 的 EPSP；多個 AP 會疊加。'}]},
    c32:{hw:3, title:'#3-2 Excitatory → active',
      kit:{st:KIT3, zh:'助教的電路：兩塊 active membrane 都是原版，Pre 推不動突觸，沒有 EPSP。'},
      mine:{st:KIT3, zh:'和原版相同。'},
      ideal:[
        {id:'hw2', zh:'HW2 真 AP', en:'HW2 true AP', st:Object.assign({}, KIT3, {pre:'true', postMem:'true'}), tune:[],
         note:'兩塊都用 HW2 真正的 AP、突觸板不加東西：EPSP 傳不到 Post。'},
        {id:'syn', zh:'真正的突觸', en:'True synapse', def:true, st:TRUE_SYN, tune:tune('r1p'),
         note:'加 1.5 MΩ：一個 EPSP 讓 Post 從 1.23 V 升到 1.43 V（不到門檻），兩個 EPSP（間隔 50 ms–1.2 s）就觸發 Post AP。'}]},
    c33:{hw:3, title:'#3-3 Inhibitory → passive',
      kit:{st:KIT3, zh:'助教的電路：Pre 只到約 1.5–2.2 V，突觸不導通，沒有 IPSP。'},
      mine:{st:KIT3, zh:'和原版相同。'},
      ideal:[
        {id:'hw2', zh:'HW2 真 AP', en:'HW2 true AP', st:Object.assign({}, KIT3, {pre:'true', postMem:'true'}), tune:[],
         note:'Pre 用 HW2 真正的 AP：一個 AP 只有約 −20 mV。'},
        {id:'syn', zh:'真正的突觸', en:'True synapse', def:true, st:TRUE_SYN, tune:tune('r1p'),
         note:'加 1.5 MΩ：一個 AP 在 #1 約 −37 mV，多個 AP 疊加；拔掉電池 IPSP 就消失。'}]},
    c34:{hw:3, title:'#3-4 Inhibitory → active',
      kit:{st:KIT3, zh:'助教的電路：沒有 IPSP；按住 B 只有一個峰，量不到頻率變化。'},
      mine:{st:KIT3, zh:'和原版相同。'},
      ideal:[
        {id:'hw2', zh:'HW2 真 AP', en:'HW2 true AP', st:Object.assign({}, KIT3, {pre:'true', postMem:'true'}), tune:[],
         note:'兩塊都用 HW2 真正的 AP、突觸板不加東西。'},
        {id:'syn', zh:'真正的突觸', en:'True synapse', def:true, st:TRUE_SYN, tune:tune('r1p'),
         note:'加 1.5 MΩ：B 按 12.5 ms 時 1 個 IPSP 就擋住 AP；按住 SW B（6 kΩ）16.0 Hz，同時按住 SW A 降到 8.5 Hz。'}]}
  };
})();
