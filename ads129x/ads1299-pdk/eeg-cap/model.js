/* ADS1299EEG-FE PDK + breadboard + 8-channel ear-clip-referenced EEG cap.

   1. The build: every jumper, wire, part and electrode lead, in the order you do it, with the reason.
      Pin numbers follow SLAU443B: Figure 59 (J6 / JP25), Figure 58 (JP1, JP6, JP7, JP8, R8), Figure 63
      (where they are on the board), Table 3 (JP2 / JP20 for the bipolar supply).
   2. The circuit: physical points (J6.36, JP25.6, breadboard strips ...) are merged into nets by the
      jumpers and wires that are in place, then solved with circuit-sim/engine.js; the ADS1299 itself
      is analysed with ../../afe.js (pin model, bias amplifier, noise, mixing).
*/
(function (global) {
  'use strict';
  var CS = global.CircuitSim, AFE = global.AFE;

  /* ===================== montage ===================== */
  var CH = ['Fp1', 'Fp2', 'Fz', 'C3', 'C4', 'Pz', 'O1', 'O2'];
  /* wire colours follow the resistor colour code 1-8, so CHn has the colour of digit n */
  var COLOR = ['#8B5A2B', '#D7332A', '#F08A24', '#E3BF12', '#2E9B47', '#2F6BD6', '#8B4FD0', '#8E959B'];
  var CNAME = ['棕', '紅', '橙', '黃', '綠', '藍', '紫', '灰'];
  var REFC = '#F2F2EE', BIASC = '#1E1E1E';
  var ROW_BIAS = 23, ROW_REF = 25;
  function pPin(k) { return 40 - 4 * k; }      // J6 even pin of CHk+ (AINkP): CH1 = 36 ... CH8 = 8
  function nPin(k) { return 38 - 4 * k; }      // J6 even pin of CHk- (AINkN): CH1 = 34 ... CH8 = 6
  function bbRow(k) { return 23 - 2 * k; }     // breadboard row in line with that J6 pin: CH1 = 21 ... CH8 = 7

  var SITE = {
    Fp1: '左前額。離眼睛最近，眨眼和眼球運動的偽跡最大，也可以反過來用來偵測眨眼。',
    Fp2: '右前額。和 Fp1 對稱，兩個一起確認眨眼（兩邊同時、同方向）。',
    Fz: '中線額葉。注意力、工作記憶相關的額葉中線 theta（4–7 Hz）在這裡最明顯；眨眼也還看得到一些。',
    C3: '左側中央區，右手的運動皮質。想像或執行右手動作時，8–12 Hz 的 mu 節律會減弱。',
    C4: '右側中央區，左手的運動皮質。和 C3 對照，看左右手的 mu 節律差異。',
    Pz: '中線頂葉。P300（看到「目標」刺激約 300 ms 後的正波）在這裡最大。',
    O1: '左枕葉視覺皮質。閉眼放鬆時 alpha（8–12 Hz）最大，睜眼就變小。',
    O2: '右枕葉視覺皮質。和 O1 一起確認 alpha。'
  };

  /* ===================== the build, step by step ===================== */
  /* kind: jumper | part | wire | lead | power | scope | setting.  why[]: reasons; check: how to verify. */
  var ITEMS = [];
  function add(o) { ITEMS.push(o); return o; }
  add({id: 'jp2', step: 1, kind: 'jumper', at: 'JP2', title: 'JP2 改到 1-2：AVDD = +2.5 V',
    short: 'JP2 2-3 → 1-2',
    why: ['腦波帽用 ±2.5 V 類比雙電源，人體被 BIAS 拉在 0 V（電路地）附近。PDK 出廠是 5 V 單電源（JP2 2-3：AVDD = +5 V）。',
      'JP2 的 1 腳接 U9（TPS73225）的 +2.5 V，2 腳是 AVDD。改成 1-2 後 AVDD = +2.5 V（SLAU443B 表 3）。',
      '雙電源時 ADS1299 內部的 BIASREF =（AVDD + AVSS）/ 2 = 0 V，人體、USB 地、示波器地都在 0 V 附近，量到的電壓直接就是對地的值。',
      '<b>一定要先拔 USB，JP2、JP20 兩個一起改</b>：只改 JP20 會變成 +5 V 對 −2.5 V，AVDD − AVSS = 7.5 V，超過 ADS1299 的絕對最大值（5.5 V）；只改 JP2 則只有 2.5 V，晶片不會工作。'],
    check: '通電後量 JP2 中間腳（或 TP13）對 TP8 = +2.5 V。注意這塊板的 JP2、JP20 方形焊墊（1 腳）在右邊。'});
  add({id: 'jp20', step: 2, kind: 'jumper', at: 'JP20', title: 'JP20 改到 2-3：AVSS = −2.5 V',
    short: 'JP20 1-2 → 2-3',
    why: ['JP20 的 3 腳接 U8（TPS72325）的 −2.5 V，2 腳是 AVSS；出廠 1-2 是 AVSS = 0 V（接地）。',
      '和 JP2 一起改，AVDD − AVSS 仍是 5 V，只是整體往下移 2.5 V，晶片的規格和雜訊都不變。',
      '這樣電極的直流電位（幾 mV 的半電池電位）都在 0 V 附近，離 PGA 的極限（AVSS + 0.2 V、AVDD − 0.2 V）各有 2.3 V。'],
    check: '量 JP20 中間腳（或 TP6）對 TP8 = −2.5 V。'});
  add({id: 'j6caps', step: 3, kind: 'jumper', at: 'J6', title: '拔掉 J6 的 16 個跳線帽（5-6 到 35-36）',
    short: 'J6 跳線帽全拔',
    why: ['J6 是 2 × 18 的排針：靠板邊那一排（奇數腳）是兩條匯流排，Ain−（1、3、5、9 … 33 腳）和 Ain+（7、11 … 35 腳）；靠內側那一排（偶數腳）是 8 個通道各自的輸入（經 4.99 kΩ ＋ 4.7 nF 到 AINxP／AINxN）。',
      '出廠的跳線帽把每個通道的輸入接到匯流排，讓 8 個通道收同一個訊號（短路雜訊測試、SMA 輸入）。',
      '不拔的話，8 個頭皮電極會經跳線帽短在一起：每個通道看到的是 8 個電極的平均，而且電極之間會互相流電流。',
      '收好，之後做手冊第 8 章的雜訊測試還要裝回去。'],
    check: 'J6 上 36 支針都沒有跳線帽；奇數腳不要插任何線。'});
  add({id: 'jp25', step: 4, kind: 'jumper', at: 'JP25', title: '拔掉 JP25 的跳線帽',
    short: 'JP25 全拔',
    why: ['JP25 是 2 × 3：1 腳 = Ain− 匯流排、3 腳 = Ain+ 匯流排、2／4／5 腳 = VCM（同一點，經 R10 4.99 kΩ 到 BIAS_ELEC）、6 腳經 R11 4.99 kΩ 到 REF_ELEC。',
      '出廠 1-2、3-4 是把兩條匯流排接到 VCM（輸入短路測試）。J6 跳線拔了以後匯流排已經沒用，但跳線帽留著沒有好處。',
      '最要避免的是 5-6：它讓 VCM（也就是 BIAS 的那一點）經 R11 推 REF_ELEC，右耳的參考電極就被接到 BIAS 上，通道變成「電極 − BIAS 電壓」，參考失去意義。',
      'JP25 的 2 腳、6 腳等一下要插 BIAS、REF 的線，所以要空出來。'],
    check: 'JP25 六支針都沒有跳線帽。'});
  add({id: 'jp6', step: 5, kind: 'jumper', at: 'JP6', title: '拔掉 JP6（或只套在 1 腳上收著）',
    short: 'JP6 1-2 → 拔掉',
    why: ['JP6 1-2 讓 U11（OPA376）把 R23／R24 分出來的中點電壓直接推到 BIAS_ELEC：這是出廠的「固定偏壓」，沒有回授。',
      '我們要用 ADS1299 自己的 BIAS 放大器（JP1）：它量 8 個通道的共模，反向推回人體，把 60 Hz 共模壓下來。',
      '兩個都接的話，U11 和 BIASOUT 同時推 BIAS_ELEC 這一點、互相對打。U11 的輸出能力大得多，BIAS_ELEC 被釘在中點，BIAS 放大器的輸出電流卡在上限（約 1 mA）一直推，迴路沒有作用（進階情境「JP6 沒拔」）。',
      '跳線帽只套在一支針上不會導通，這樣收著不會掉。'],
    check: 'JP6 的 1、2 腳之間沒有導通。'});
  add({id: 'jp1', step: 6, kind: 'jumper', at: 'JP1', title: 'JP1 裝 1-2：BIASOUT 推 BIAS_ELEC',
    short: 'JP1 → 1-2',
    why: ['JP1 1 腳 = BIAS_ELEC，2 腳 = BIAS_DRV（經 R3 0 Ω 就是 ADS1299 的 BIASOUT）。出廠沒裝。',
      '裝上以後形成負回授：8 個通道的正輸入 → 晶片內各 220 kΩ 加總到 BIASINV → BIAS 放大器（回授 R8 392 kΩ ∥ C20 10 nF）→ BIASOUT → R10 → 麵包板 → 左耳夾 → 人體 → 頭皮電極 → 回到輸入。',
      '直流迴路增益約 R8 ÷（220 kΩ / 8）≈ 14；C20 讓增益在 40 Hz 左右開始下降，迴路才穩定。人體上的 60 Hz 共模大約被壓小（1 + 迴路增益）倍。',
      '這就是腦波帽「左耳夾接 BIASOUT」的做法；在 PDK 上要靠 JP1 才接得到。'],
    check: 'SLAU443B §7.1.3：BIAS 開啟後量 R8 兩端，都應該接近中點（雙電源 = 0 V）。'});
  add({id: 'jp8', step: 7, kind: 'jumper', at: 'JP8', title: 'JP8 保持 1-2：REF_ELEC 直接到 SRB1（JP7 不動）',
    short: 'JP8 1-2（出廠）',
    why: ['JP8 2 腳 = SRB1，1 腳 = REF_ELEC，3 腳 = U4（OPA376）緩衝輸出。1-2 是出廠設定，不用動。',
      '加上暫存器 MISC1.SRB1 = 1，晶片內部把 SRB1 接到 8 個通道的負輸入：每個通道 = 頭皮電極 − 右耳。這就是腦波帽的「右耳夾 → SRB1」。',
      '直接接、不經運放最安靜（手冊 §8.3：1.28 µVpp；經 U4 緩衝的 §8.4 是四種接法中最吵的）。',
      '代價是 8 個負輸入的偏壓電流（約 8 × 200 pA = 1.6 nA）都流進右耳夾。濕電極約 10 kΩ 時只造成十幾 µV 的直流偏移，被 0.5 Hz 高通濾掉；換乾電極（MΩ 級）才考慮改 2-3 走 U4。',
      'JP7 只決定 U4 的輸入接什麼，JP8 是 1-2 時 U4 沒有用到，保持出廠即可。'],
    check: 'JP8 的跳線帽在 1-2（方形焊墊那一側）。'});
  add({id: 'r100k', step: 8, kind: 'part', at: 'bb', title: '100 kΩ 電阻跨在 23 排 e–f（BIAS 限流）',
    short: '100 kΩ：e23 ↔ f23',
    why: ['限制從 BIAS 輸出流進人體的電流。BIAS 放大器的短路電流是 mA 級，原本串在路上的只有 R10（4.99 kΩ）：如果 BIASOUT 卡在電源軌（接錯、晶片壞掉），2.5 V ÷ 5 kΩ = 0.5 mA 直流會流過頭部。',
      '串 100 kΩ 後最壞約 2.5 V ÷ 105 kΩ ≈ 24 µA，低於 IEC 60601-1 單一故障的病患輔助電流上限 50 µA（直流）。',
      '正常量測時流過它的只有 60 Hz 的位移電流（電池供電時約 10 nA），在 100 kΩ 上約 1 mV。這個壓降在 BIAS 迴路裡面：人體上的 60 Hz 共模從約 0.02 mV 變成約 0.2 mV，仍然很小，通道上的 60 Hz 差模不變（< 1 µV）。和人體約 200 pF 對地電容形成的極點在 kHz 以上，不影響迴路穩定。',
      '跨在中間的溝槽上：左半邊（a–e）是耳夾那一側，右半邊（f–j）是 PDK 那一側，電阻是兩邊唯一的通路。',
      '通道不加：輸入腳是高阻抗，不會主動輸出電流；再串電阻只會多熱雜訊（100 kΩ 在 65 Hz 頻寬內約 0.33 µVrms，比晶片本身的 0.14 µVrms 還大）。'],
    check: '電阻一腳在 e23、一腳在 f23；用三用電表量 a23 到 j23 約 100 kΩ。'});
  for (var k = 1; k <= 8; k++) {
    add({id: 'w' + k, step: 8 + k, kind: 'wire', ch: k, color: COLOR[k - 1], from: 'J6.' + pPin(k), to: 'bb:' + bbRow(k) + ':j',
      title: 'CH' + k + '（' + CH[k - 1] + '）：J6 第 ' + pPin(k) + ' 腳 → 麵包板 j' + bbRow(k) + '，' + CNAME[k - 1] + '色',
      short: 'J6.' + pPin(k) + ' → j' + bbRow(k),
      why: ['J6 第 ' + pPin(k) + ' 腳是 CH' + k + '+（內側那排、絲印 CH' + k + ' 的「+」），經 R' + (95 - 2 * (k - 1)) + '（4.99 kΩ）和 4.7 nF 到 AIN' + k + 'P。腦波帽是「電極 → 正輸入、參考 → SRB1」的參考式接法，所以電極只接正輸入。',
        '不接 CH' + k + '−（第 ' + nPin(k) + ' 腳）：MISC1.SRB1 = 1 時，晶片內部把通道的負輸入從 IN' + k + 'N 腳切到 SRB1，IN' + k + 'N 腳沒有作用。',
        '不接奇數腳（第 ' + (pPin(k) - 1) + ' 腳）：那是 Ain+ 匯流排，J6 跳線拔掉後沒有連到任何通道（進階情境「插到奇數腳」）。',
        '麵包板第 ' + bbRow(k) + ' 排剛好和這支針在同一高度，線是直的、不交叉；隔一排放一個通道，相鄰的線不會碰到。',
        '母頭套在 J6 的針上、公頭插 j 欄（最靠 PDK）；f 欄留給電極、g／h／i 留給探棒。顏色照電阻色碼：' + k + ' = ' + CNAME[k - 1] + '，看顏色就知道是第幾通道。',
        '線越短越好（10–15 cm）：導線和電源線之間的雜散電容會把 60 Hz 耦合進來。'],
      check: '三用電表量 j' + bbRow(k) + ' 到 R' + (95 - 2 * (k - 1)) + ' 靠 J6 那一端約 0 Ω；到 J6 第 ' + nPin(k) + ' 腳不通。'});
  }
  add({id: 'wref', step: 17, kind: 'wire', color: REFC, from: 'JP25.6', to: 'bb:' + ROW_REF + ':j',
    title: 'REF：JP25 第 6 腳 → 麵包板 j25，白色', short: 'JP25.6 → j25',
    why: ['REF_ELEC 不在 J6 上。JP25 的 6 腳（絲印 REF）經 R11（4.99 kΩ）到 REF_ELEC，REF_ELEC 有 C75（4.7 nF）對地，再經 JP8 1-2 到 SRB1。',
      '這組 4.99 kΩ ＋ 4.7 nF 和每個通道正輸入的濾波一模一樣：人體上的 60 Hz 共模在正、負兩邊衰減相同，才不會變成差模。ADS1299 的 −120 dB CMRR 要靠外部濾波對稱才用得到。',
      '如果改插 JP8 的 1 腳（REF_ELEC），就少了 R11，參考那一側的濾波和通道不對稱，60 Hz 會漏進來，也沒有保護電阻。',
      '白色：參考。右耳夾在麵包板上和它同一排。'],
    check: 'j25 到 JP25 第 6 腳 0 Ω；j25 到 JP8 第 2 腳（SRB1）約 4.99 kΩ。'});
  add({id: 'wbias', step: 18, kind: 'wire', color: BIASC, from: 'JP25.2', to: 'bb:' + ROW_BIAS + ':j',
    title: 'BIAS：JP25 第 2 腳 → 麵包板 j23，黑色', short: 'JP25.2 → j23',
    why: ['JP25 的 2、4、5 腳是同一點（VCM，絲印 BIAS），經 R10（4.99 kΩ）到 BIAS_ELEC，JP1 1-2 再接到 BIASOUT。R10 同時是一顆小保護電阻。',
      '用 2 腳是因為它在最上面、和麵包板 23 排同高，線不會壓到 REF 那條。',
      '黑色是提醒：這條是人體的「共模驅動」，<b>不是電路地</b>，不要接到 TP8／GND（進階情境「BIAS 接到 AGND」）。'],
    check: 'BIAS 開啟後 j23 對 TP8 約 0 V（± 幾十 mV）。'});
  CH.forEach(function (nm, i) {
    var k = i + 1;
    add({id: 'lead' + k, step: 18 + k, kind: 'lead', ch: k, color: COLOR[i], elec: nm, to: 'bb:' + bbRow(k) + ':f',
      title: nm + ' 電極線 → 麵包板 f' + bbRow(k) + '（CH' + k + '）', short: nm + ' → f' + bbRow(k),
      why: [SITE[nm],
        '插在 f 欄，和 PDK 那條線（j 欄）在同一條金屬片上，導通；中間的 g、h、i 留給探棒。',
        '通道順序照腦波帽的電極順序（Fp1、Fp2、Fz、C3、C4、Pz、O1、O2 = CH1–CH8），軟體裡的通道編號就直接對應帽子上的位置。',
        '電極打導電膏，阻抗最好在 10 kΩ 以下而且彼此接近：阻抗差會把人體上的 60 Hz 共模轉成差模。'],
      check: '帽子上 ' + nm + ' 的電極和 j' + bbRow(k) + ' 之間 0 Ω（電極沒戴時量）。'});
  });
  add({id: 'leadref', step: 27, kind: 'lead', color: REFC, elec: 'REF', to: 'bb:' + ROW_REF + ':f',
    title: '右耳夾（REF）→ 麵包板 f25', short: '右耳夾 → f25',
    why: ['耳垂幾乎沒有腦電活動，當作 8 個通道共同的參考：每個通道 = 頭皮電極 − 右耳。',
      '和 REF 線（j25）同一排 → 經 R11 → REF_ELEC → JP8 → SRB1。',
      '右耳 REF、左耳 BIAS 照腦波帽的配置。兩者分開兩耳，BIAS 推進人體的電流就不會流過參考電極附近的組織。',
      '耳夾和皮膚之間也要用導電膏，阻抗不要比頭皮電極高太多：參考電極的阻抗出現在每一個通道裡。'],
    check: '右耳夾到 JP25 第 6 腳 0 Ω。'});
  add({id: 'leadbias', step: 28, kind: 'lead', color: BIASC, elec: 'BIAS', to: 'bb:' + ROW_BIAS + ':a',
    title: '左耳夾（BIAS）→ 麵包板 a23（電阻的另一側）', short: '左耳夾 → a23',
    why: ['插在左半邊 a23，經 100 kΩ 跨過溝槽才到 BIAS 線：所有流進人體的 BIAS 電流都要經過這顆限流電阻。',
      '<b>不要插到 f–j</b>：插到右半邊就繞過了 100 kΩ。',
      'BIAS 電極不參與量測，只負責把人體拉到 0 V、抵消 60 Hz 共模；它的阻抗高一點沒關係（在迴路裡），但接觸不好時 60 Hz 會明顯變大。'],
    check: '左耳夾到 j23 約 100 kΩ。'});
  add({id: 'usb', step: 29, kind: 'power', at: 'usb', title: 'USB 接筆電，筆電只用電池（拔掉充電器）',
    short: 'USB → 筆電（電池）',
    why: ['MMB0 從 USB 取電，ADS1299EEG-FE 上的 ±2.5 V、3.3 V 都由它產生。所有接線都完成、檢查過之後才插 USB。',
      'SLAU443B §9.4 建議用電池供電，減少 50／60 Hz。筆電插著充電器時，充電器裡的 Y 電容把電路地耦合到市電（進階情境「筆電接充電器」可以看到 60 Hz 變大很多）。',
      '安全：受試者經 BIAS、REF 電極接在電路上。電路只要不經任何導體接到市電或大地，就算出了問題也沒有回路。這套 EVM 不是醫療設備（手冊開頭的警語），戴在人身上時全程用電池。'],
    check: 'MMB0 的電源 LED 亮；TP7 = +5 V。'});
  add({id: 'scope', step: 30, kind: 'scope', at: 'TP8', title: '示波器地夾 → TP8（AGND）',
    short: '示波器地 → TP8',
    why: ['探棒量的都是「對 AGND 的電壓」，地夾要夾在 PDK 的 TP8（板上有接地符號）。',
      '最好用電池供電的示波器，或 USB 示波器接在同一台用電池的筆電上。一般插市電的示波器，地夾經電源線接大地：電路地（和經 BIAS 電極的受試者）就被接到大地，60 Hz 的路徑跟著改變，受試者也多了一條到大地的路。',
      '探棒用 ×10（10 MΩ ∥ 約 15 pF）。×1 探棒的電容大得多，夾在高阻抗的電極線上會影響訊號。'],
    check: '探棒碰 TP8 讀 0 V；碰 JP2 中間腳讀 +2.5 V。'});
  add({id: 'regs', step: 31, kind: 'setting', at: 'ads', title: '軟體：寫暫存器（SRB1、BIAS、增益 24、250 SPS）',
    short: 'MISC1 = 20h 等',
    why: ['ADS1299 上電後每個通道是 MUX = 001（輸入短路），什麼都量不到；BIAS 放大器和 SRB1 也都是關的。',
      'CONFIG3 = ECh：內部參考開、BIASREF 用內部中點、BIAS 放大器開。CONFIG1 = 96h：250 SPS。CHnSET = 60h：增益 24、一般輸入。',
      'MISC1 = 20h（SRB1 = 1）：SRB1 接到 8 個通道的負輸入，右耳夾變成共同參考。',
      'BIAS_SENSP = FFh、BIAS_SENSN = 00h：只用 8 個正輸入（頭皮電極）算共模。負輸入全部都是 SRB1，再加進去只是把右耳重複算 8 次。',
      'TI 的 GUI 在 ADC Register 分頁的 Channel Registers、LOFF and BIAS、GPIO and Other 裡設定；也可以直接用「量測」區的暫存器表。'],
    check: '「ADS1299 輸出」分頁出現 8 通道腦波；閉眼時 O1、O2 有 10 Hz alpha。'});
  var NSTEP = 31;

  /* information about board parts (no step) */
  var INFO = {
    J6: {title: 'J6：36 腳輸入排針', why: ['2 × 18、2.54 mm。左排（靠板邊、方形焊墊是 1 腳）是奇數腳：Ain− 匯流排（1、3、5、9 … 33）和 Ain+ 匯流排（7、11 … 35）；右排是偶數腳：每個通道的 − 和 +（絲印 CH8 在最上面、CH1 在最下面）。2 腳經 R12 到 BIAS_SHD（屏蔽驅動，板上沒裝零件），4 腳沒接。',
      '偶數腳後面接 R80–R95（4.99 kΩ）和 C72–C93（4.7 nF 對地）的輸入濾波，截止約 6.8 kHz，主要擋射頻和 Δ-Σ 的取樣。']},
    JP25: {title: 'JP25：BIAS／REF 排針', why: ['2 × 3。1 腳 = Ain− 匯流排、3 腳 = Ain+ 匯流排、2／4／5 腳 = VCM（經 R10 到 BIAS_ELEC）、6 腳經 R11（REF_ELEC 側有 C75 4.7 nF）到 REF_ELEC。',
      '手冊的四種設定：1-2＋3-4 輸入短路到 VCM；3-4＋5-6 正輸入接 VCM、VCM 推 SRB1；只裝 1-2 是 SMA 單端輸入；只裝 5-6 是外部訊號＋VCM 推 SRB1。接電極時全部拔掉，2 腳、6 腳拿來插線。']},
    U1: {title: 'U1：ADS1299', why: ['8 通道、24 位元 Δ-Σ ADC，每通道有 PGA（增益 1–24）。這裡用增益 24、250 SPS：輸入雜訊約 0.14 µVrms（資料手冊表 4）。',
      '晶片內部：SRB1 開關、BIAS 放大器（BIASINV／BIASOUT）、lead-off 電流源、2.048 MHz 時脈（板上用 OSC1）。']},
    R8: {title: 'R8 392 kΩ ∥ C20 10 nF：BIAS 回授', why: ['接在 BIASOUT（經 R3 0 Ω 的 BIAS_DRV）和 BIASINV 之間。決定 BIAS 迴路的增益（約 R8 ÷ 27.5 kΩ ≈ 14）和頻寬（約 40 Hz）。',
      '手冊 §7.1.3 的檢查：BIAS 開啟後量 R8 兩端都接近中點。兩端哪一端是 BIASOUT 要看佈線；正常時兩端都在 0 V 附近，差別只是 60 Hz 的大小。',
      '手冊提醒：加了長導線、外部濾波後，迴路穩定性要重新確認；不穩定時加大 C20。']},
    TP8: {title: 'TP8：AGND', why: ['板上的類比地（接地符號）。示波器地夾夾這裡。雙電源時 AVDD = +2.5 V、AVSS = −2.5 V 都是對它量。']},
    MMB0: {title: 'MMB0：主機板', why: ['TI 的通用 EVM 主機板（DSP），經 J2／J3／J4 疊在 ADS1299EEG-FE 下面，提供 +5 V、+3.3 V、+1.8 V 和 SPI，經 USB 把資料送到電腦的 GUI。DC 電源插座不用，只用 USB。']},
    SMA: {title: 'AIN1 SMA', why: ['單端訊號輸入，直接接到 Ain+ 匯流排。J6 跳線拔掉後它不連到任何通道；這次不用。']},
    JP7: {title: 'JP7（保持出廠 1-2）', why: ['1 腳 = REF_ELEC、2 腳 = U4 的輸入、3 腳 = SRB2。只有 JP8 改 2-3（緩衝的參考）時 U4 的輸出才會用到；保持出廠即可。']},
    bb: {title: '麵包板', why: ['每一排的 a–e 是一條金屬片、f–j 是另一條，中間溝槽兩邊不通。這裡只用右半邊（f–j）：j 插 PDK 的線、f 插電極、g／h／i 插探棒。只有 BIAS 那一排用到左半邊，讓 100 kΩ 跨過溝槽。',
      '電源軌不用：麵包板上不需要任何電源，也不要把 AGND 拉到麵包板上，免得電極線不小心碰到地。']},
    head: {title: '8 通道耳夾參考式腦波帽', why: ['頭皮電極 Fp1、Fp2、Fz、C3、C4、Pz、O1、O2（國際 10-20 系統），右耳夾當參考（REF）、左耳夾當 BIAS。',
      '參考式（referential）：8 個通道都以右耳為參考，換算其他參考（例如平均參考）可以在軟體裡做；反過來就做不到。']}
  };

  /* ===================== state and wiring ===================== */
  function defaultState() {
    return {
      step: NSTEP, supply: 'bi', refBuf: false, biasR: 100e3, elec: 'wet', contact: {}, laptop: 'batt', scopeEarth: false,
      fault: {j6caps: false, jp25: false, jp6: false, odd: false, nosrb1: false, biasgnd: false, nobias: false},
      probes: {ch1: 'bb:21:h', ch2: 'bb:23:h'},
      seed: 3
    };
  }
  function done(st, id) { var it = byId(id); return it && st.step >= it.step; }
  function byId(id) { for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i]; return null; }

  /* what is physically in place for this state */
  function wiring(st) {
    var f = st.fault, w = {jp: {}, wires: [], leads: [], resistor: false, powered: false, regs: false, j6caps: true, jp25: ['1-2', '3-4']};
    w.jp.JP2 = st.supply === 'bi' && done(st, 'jp2') ? '1-2' : '2-3';
    w.jp.JP20 = st.supply === 'bi' && done(st, 'jp20') ? '2-3' : '1-2';
    w.j6caps = !done(st, 'j6caps') || f.j6caps;
    w.jp25 = !done(st, 'jp25') ? ['1-2', '3-4'] : f.jp25 ? ['5-6'] : [];
    w.jp.JP6 = !done(st, 'jp6') || f.jp6 ? '1-2' : 'park';
    w.jp.JP1 = done(st, 'jp1') ? '1-2' : 'off';
    w.jp.JP7 = '1-2';
    w.jp.JP8 = st.refBuf && done(st, 'jp8') ? '2-3' : '1-2';
    w.resistor = done(st, 'r100k') && st.biasR > 0;
    for (var k = 1; k <= 8; k++) {
      if (!done(st, 'w' + k)) continue;
      w.wires.push({id: 'w' + k, from: k === 1 && f.odd ? 'J6.35' : 'J6.' + pPin(k), to: 'bb:' + bbRow(k) + ':j', color: COLOR[k - 1]});
    }
    if (done(st, 'wref')) w.wires.push({id: 'wref', from: 'JP25.6', to: 'bb:' + ROW_REF + ':j', color: REFC});
    if (done(st, 'wbias')) w.wires.push({id: 'wbias', from: f.biasgnd ? 'TP8' : 'JP25.2', to: 'bb:' + ROW_BIAS + ':j', color: BIASC});
    CH.forEach(function (nm, i) { if (done(st, 'lead' + (i + 1))) w.leads.push({id: 'lead' + (i + 1), elec: nm, to: 'bb:' + bbRow(i + 1) + ':f'}); });
    if (done(st, 'leadref')) w.leads.push({id: 'leadref', elec: 'REF', to: 'bb:' + ROW_REF + ':f'});
    if (done(st, 'leadbias')) w.leads.push({id: 'leadbias', elec: 'BIAS', to: 'bb:' + ROW_BIAS + (w.resistor ? ':a' : ':f')});
    w.powered = done(st, 'usb');
    w.scope = done(st, 'scope');
    w.regs = done(st, 'regs');
    w.srb1 = w.regs && !f.nosrb1;
    w.biasOn = w.regs && !f.nobias;
    var avdd = w.jp.JP2 === '1-2' ? 2.5 : 5, avss = w.jp.JP20 === '2-3' ? -2.5 : 0;
    w.rails = {avdd: avdd, avss: avss};
    w.supplyOK = Math.abs(avdd - avss - 5) < 1e-9;
    return w;
  }

  /* breadboard hole -> strip: right half f-j is 'BB:r', left half a-e is 'BBL:r'; rails are their own nets */
  function holeNet(pt) {
    var m = /^bb:(\d+):([a-j])$/.exec(pt);
    if (m) return ('fghij'.indexOf(m[2]) >= 0 ? 'BB:' : 'BBL:') + m[1];
    m = /^rail:(\w+)$/.exec(pt);
    if (m) return 'RAIL:' + m[1];
    return pt;
  }

  /* ===================== union-find of physical points ===================== */
  function UF() { this.p = {}; }
  UF.prototype.find = function (a) {
    var p = this.p;
    if (p[a] === undefined) { p[a] = a; return a; }
    while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; }
    return a;
  };
  UF.prototype.union = function (a, b) {
    a = this.find(a); b = this.find(b);
    if (a === b) return;
    if (a === '0') this.p[b] = a; else if (b === '0') this.p[a] = b; else this.p[b] = a;
  };

  var ENV = {mainsV: 110, mainsF: 60, Cpow: 2e-12, Cbody: 200e-12, Ciso: 20e-12, Ccab: 30e-12, Cstray: 0.02e-12, h3: 0.03, Cy: 470e-12};

  function seeded(n, seed, fn) { var r = CS.rng(seed), out = []; for (var i = 0; i < n; i++) out.push(fn(r)); return out; }

  /* ===================== circuit ===================== */
  function build(st) {
    var w = wiring(st), uf = new UF(), c = new CS.Circuit(), r = w.rails, mid = (r.avdd + r.avss) / 2, k;
    function U(a, b) { uf.union(a, b); }
    function N(x) { return uf.find(holeNet(x)); }
    /* fixed copper on the board */
    U('0', 'TP8'); U('0', 'JP20.1');
    [1, 3, 5, 9, 13, 17, 21, 25, 29, 33].forEach(function (n) { U('AINN_BUS', 'J6.' + n); });
    [7, 11, 15, 19, 23, 27, 31, 35].forEach(function (n) { U('AINP_BUS', 'J6.' + n); });
    for (k = 1; k <= 8; k++) { U('AIN' + k + 'P', 'J6.' + pPin(k)); U('AIN' + k + 'N', 'J6.' + nPin(k)); }
    U('AINN_BUS', 'JP25.1'); U('AINP_BUS', 'JP25.3'); U('VCM', 'JP25.2'); U('VCM', 'JP25.4'); U('VCM', 'JP25.5'); U('R11A', 'JP25.6');
    U('BIAS_ELEC', 'JP1.1'); U('BIASOUT', 'JP1.2'); U('BIASOUT', 'R8.1'); U('BIASINV', 'R8.2');
    U('BIAS_ELEC', 'JP6.1'); U('U11OUT', 'JP6.2'); U('BIASIN', 'JP6.3');
    U('REF_ELEC', 'JP7.1'); U('U4IN', 'JP7.2'); U('SRB2', 'JP7.3');
    U('REF_ELEC', 'JP8.1'); U('SRB1', 'JP8.2'); U('U4OUT', 'JP8.3');
    U('P25', 'JP2.1'); U('AVDD', 'JP2.2'); U('P5V', 'JP2.3'); U('P25', 'TP13'); U('P5V', 'TP5'); U('P5V', 'TP7');
    U('AVSS', 'JP20.2'); U('N25', 'JP20.3'); U('N25', 'TP6');
    U('R12A', 'J6.2');
    /* jumpers, wires */
    ['JP2', 'JP20', 'JP1', 'JP6', 'JP7', 'JP8'].forEach(function (j) {
      var s = w.jp[j];
      if (s === '1-2') U(j + '.1', j + '.2'); else if (s === '2-3') U(j + '.2', j + '.3');
    });
    if (w.j6caps) for (var row = 3; row <= 18; row++) U('J6.' + (2 * row - 1), 'J6.' + (2 * row));
    w.jp25.forEach(function (p) { var a = p.split('-'); U('JP25.' + a[0], 'JP25.' + a[1]); });
    w.wires.forEach(function (x) { U(holeNet(x.from), holeNet(x.to)); });

    /* supplies (MMB0 and the on-board regulators) */
    c.V('V5', N('P5V'), '0', 5); c.V('V25', N('P25'), '0', 2.5); c.V('VN25', N('N25'), '0', -2.5);
    c.V('VMID', 'MID', '0', mid);
    /* mains, the body, earth; the device ground '0' is AGND */
    c.V('Vmains', 'mains', 'earth', {dc: 0, ac: 1});
    c.C('Cpow', 'mains', 'body', ENV.Cpow);
    c.C('Cbody', 'body', 'earth', ENV.Cbody);
    c.C('Ciso', 'earth', '0', ENV.Ciso);
    c.R('Rleak', 'earth', '0', 1e12);
    if (st.laptop === 'charger') c.C('Cy', 'mains', '0', ENV.Cy);
    if (st.scopeEarth && w.scope) c.R('Rscope:gnd', '0', 'earth', 1);

    /* electrodes: Randles model (Rs + Rct || Cdl), half-cell offset, cable to the breadboard */
    var E = AFE.ELECTRODES[st.elec] || AFE.ELECTRODES.wet, names = CH.concat(['REF', 'BIAS']);
    var hc = seeded(names.length, st.seed, function (q) { return (2 * q() - 1) * E.hc; });
    var mul = seeded(names.length, st.seed * 3 + 1, function (q) { return Math.exp((2 * q() - 1) * Math.log(1.2)); });
    var target = {};
    w.leads.forEach(function (l) { target[l.elec] = N(l.to); });
    var elecs = [];
    names.forEach(function (nm, i) {
      var t = target[nm] || ('LEAD:' + nm), on = st.contact[nm] !== false;
      c.V('Ve:' + nm, 'site:' + nm, 'body', {dc: hc[i], ac: 0});
      c.R('Rs:' + nm, 'site:' + nm, 'm:' + nm, E.Rs * mul[i]);
      c.R('Rct:' + nm, 'm:' + nm, 'el:' + nm, E.Rct * mul[i]);
      c.C('Cdl:' + nm, 'm:' + nm, 'el:' + nm, E.Cdl / mul[i]);
      c.add('SW', 'K:' + nm, ['el:' + nm, t], {on: on, RON: 0.01, ROFF: 1e14});
      c.C('Ccab:' + nm, t, '0', ENV.Ccab);
      c.C('Cst:' + nm, 'mains', t, ENV.Cstray);
      elecs.push({name: nm, src: 'Ve:' + nm, z10: AFE.electrodeZ(E, 10, mul[i]), hc: hc[i], on: on, plugged: !!target[nm]});
    });

    /* PDK input filters (R80-R95 4.99 kOhm 1 %, C72-C93 4.7 nF 10 %) and the ADS1299 input pins */
    var tol = CS.rng(st.seed * 7 + 2);
    function tR(v) { return v * (1 + 0.01 * (2 * tol() - 1)); }
    function tC(v) { return v * (1 + 0.10 * (2 * tol() - 1)); }
    var chip = AFE.CHIPS.ads1299, live = w.powered && w.supplyOK;
    function pinModel(pin, count) {
      c.C('Cin:' + pin, pin, N('AVSS'), chip.cin * count);
      c.R('Rin:' + pin, pin, 'MID', chip.rin / count);
      if (live) c.I('Ib:' + pin, 'MID', pin, {dc: chip.ibias * count});
    }
    for (k = 1; k <= 8; k++) {
      ['P', 'N'].forEach(function (s) {
        var a = N('AIN' + k + s), pin = 'IN' + k + s;
        c.R('Rf:' + pin, a, pin, tR(4.99e3)); c.C('Cf:' + pin, pin, '0', tC(4.7e-9));
        if (s === 'P' || !w.srb1) pinModel(pin, 1); else c.R('Rnc:' + pin, pin, 'MID', 1e12);
      });
    }
    pinModel(N('SRB1'), w.srb1 ? 8 : 1);                  // with SRB1 = 1 the 8 negative inputs load the SRB1 pin
    c.R('R10', N('VCM'), N('BIAS_ELEC'), tR(4.99e3));
    c.R('R11', N('R11A'), N('REF_ELEC'), tR(4.99e3));
    c.C('C75', N('REF_ELEC'), '0', tC(4.7e-9));
    c.R('R12', N('R12A'), 'BIAS_SHD', 4.99e3);
    /* U11: mid-supply buffer (reaches BIAS_ELEC only through JP6 1-2); U4: reference buffer (used with JP8 2-3) */
    var opa = {A0: 1e6, GBW: 5.5e6, VMAX: r.avdd, VMIN: r.avss, EN: 7.5e-9, FC: 53, ROUT: 20, ILIM: 30e-3};
    if (w.powered) {
      c.R('R23', N('AVDD'), 'VDIV', 2e6); c.R('R24', 'VDIV', N('AVSS'), 2e6); c.C('C24', 'VDIV', N('AVSS'), 1e-6);
      c.U('U11', 'VDIV', N('U11OUT'), N('U11OUT'), opa);
      c.U('U4', N('U4IN'), N('U4OUT'), N('U4OUT'), opa);
    }
    /* ADS1299 bias amplifier: taps from the 8 positive inputs (BIAS_SENSP = FFh), R8 392 kOhm || C20 10 nF */
    c.R('R8', N('BIASOUT'), N('BIASINV'), 392e3);
    c.C('C20', N('BIASOUT'), N('BIASINV'), 10e-9);
    if (live && w.biasOn) {
      c.U('Ubias', 'BIASREF', N('BIASINV'), N('BIASOUT'), {A0: 1e5, GBW: chip.bias.gbw, VMAX: r.avdd - 0.05, VMIN: r.avss + 0.05, ILIM: chip.bias.isc, EN: chip.bias.en, ROUT: 50});
      c.R('Rbref', 'MID', 'BIASREF', 1);
      for (k = 1; k <= 8; k++) {
        c.G('Gtap' + k, '0', N('BIASINV'), 'IN' + k + 'P', '0', 1 / chip.bias.rsum);
        c.R('Rtap' + k, N('BIASINV'), '0', chip.bias.rsum);
      }
    }
    /* the breadboard resistor across the groove */
    if (w.resistor) c.R('Rbb', N('BBL:' + ROW_BIAS), N('BB:' + ROW_BIAS), st.biasR);
    /* scope probes (x10: 10 MOhm || 15 pF to the ground clip on TP8) */
    var probeNets = {};
    ['ch1', 'ch2'].forEach(function (p) {
      var pt = st.probes[p];
      if (!pt) return;
      var n = N(pt);
      probeNets[p] = n;
      if (n !== '0' && w.scope) { c.R('Rpr:' + p, n, '0', 10e6); c.C('Cpr:' + p, n, '0', 15e-12); }
    });
    /* every node gets a 10 TOhm leak so that floating copper (an unused bus, an open lead) has a DC value */
    c.nodeNames.slice(1).forEach(function (n) { c.R('gl:' + n, n, '0', 1e13); });

    var channels = [];
    for (k = 1; k <= 8; k++) {
      channels.push({idx: k - 1, name: 'CH' + k, label: CH[k - 1], p: 'IN' + k + 'P', n: w.srb1 ? N('SRB1') : 'IN' + k + 'N',
        gain: 24, mux: w.regs ? 0 : 1, pd: 0, eP: CH[k - 1], eN: 'REF'});
    }
    var afeSt = {dr: 6, clkErr: 1, env: ENV, compTh: 0, loffMode: 'off', loffP: 0, loffN: 0, compOn: false};
    var fe = {chip: chip, st: afeSt, circuit: c, channels: channels, elecs: elecs, notes: [], rails: r, loffSrc: [], biasOutNode: N('BIASOUT')};
    return {st: st, w: w, uf: uf, N: N, c: c, fe: fe, elecs: elecs, probeNets: probeNets, live: live};
  }

  /* ===================== analysis ===================== */
  function analyze(m) {
    if (!m.live) { m.res = null; return m; }
    var t0 = performance.now();
    var res = AFE.analyze(m.fe), sim = res.sim, amp = ENV.mainsV * Math.SQRT2;
    m.res = res;
    m.s1 = sim.acMulti(ENV.mainsF, [{name: 'Vmains', mag: amp}])[0];
    m.s3 = sim.acMulti(3 * ENV.mainsF, [{name: 'Vmains', mag: amp * ENV.h3}])[0];
    m.mix = sim.acMulti(10, m.elecs.map(function (e) { return {name: e.src, mag: 1}; }));
    m.ms = performance.now() - t0;
    return m;
  }
  /* DC, mains phasors and EEG mixing of one physical point */
  function point(m, pt) {
    var n = m.N(pt);
    if (!m.res) return {net: n, dc: 0, a1: [0, 0], a3: [0, 0], mix: m.elecs.map(function () { return 0; }), dead: true};
    var sim = m.res.sim;
    if (m.c.nodeIdx[n] === undefined) return {net: n, dc: 0, a1: [0, 0], a3: [0, 0], mix: m.elecs.map(function () { return 0; }), open: true};
    return {net: n, dc: sim.v(n), a1: sim.vac(m.s1, n), a3: sim.vac(m.s3, n), mix: m.mix.map(function (s) { return sim.vac(s, n)[0]; })};
  }

  /* human-readable name of a physical point */
  function pointName(pt) {
    var m = /^bb:(\d+):([a-j])$/.exec(pt);
    if (m) {
      var r = +m[1], what = '';
      for (var k = 1; k <= 8; k++) if (r === bbRow(k)) what = 'CH' + k + ' ' + CH[k - 1];
      if (r === ROW_REF) what = 'REF';
      if (r === ROW_BIAS) what = 'fghij'.indexOf(m[2]) >= 0 ? 'BIAS（PDK 側）' : 'BIAS（耳夾側）';
      return '麵包板 ' + m[2] + r + (what ? '（' + what + '）' : '（沒接東西）');
    }
    m = /^J6\.(\d+)$/.exec(pt);
    if (m) {
      var n = +m[1];
      if (n === 2) return 'J6 第 2 腳（BIAS_SHD）';
      if (n === 4) return 'J6 第 4 腳（沒接）';
      if (n % 2) return 'J6 第 ' + n + ' 腳（' + ([7, 11, 15, 19, 23, 27, 31, 35].indexOf(n) >= 0 ? 'Ain+' : 'Ain−') + ' 匯流排）';
      var row = n / 2;                                   // rows 3/4 = CH8-/+ ... rows 17/18 = CH1-/+
      return 'J6 第 ' + n + ' 腳（CH' + (8 - Math.floor((row - 3) / 2)) + (row % 2 ? '−' : '+') + '）';
    }
    var fixed = {
      'JP25.1': 'JP25 第 1 腳（Ain− 匯流排）', 'JP25.2': 'JP25 第 2 腳（VCM／BIAS）', 'JP25.3': 'JP25 第 3 腳（Ain+ 匯流排）',
      'JP25.4': 'JP25 第 4 腳（VCM）', 'JP25.5': 'JP25 第 5 腳（VCM）', 'JP25.6': 'JP25 第 6 腳（REF，R11 前）',
      'JP1.1': 'JP1 第 1 腳（BIAS_ELEC）', 'JP1.2': 'JP1 第 2 腳（BIASOUT）', 'JP1.3': 'JP1 第 3 腳',
      'JP6.1': 'JP6 第 1 腳（BIAS_ELEC）', 'JP6.2': 'JP6 第 2 腳（U11 輸出）', 'JP6.3': 'JP6 第 3 腳（BIASIN）',
      'JP7.1': 'JP7 第 1 腳（REF_ELEC）', 'JP7.2': 'JP7 第 2 腳（U4 輸入）', 'JP7.3': 'JP7 第 3 腳（SRB2）',
      'JP8.1': 'JP8 第 1 腳（REF_ELEC）', 'JP8.2': 'JP8 第 2 腳（SRB1）', 'JP8.3': 'JP8 第 3 腳（U4 輸出）',
      'JP2.1': 'JP2 第 1 腳（+2.5 V 穩壓）', 'JP2.2': 'JP2 第 2 腳（AVDD）', 'JP2.3': 'JP2 第 3 腳（+5 V）',
      'JP20.1': 'JP20 第 1 腳（AGND）', 'JP20.2': 'JP20 第 2 腳（AVSS）', 'JP20.3': 'JP20 第 3 腳（−2.5 V 穩壓）',
      'R8.1': 'R8 一端（BIASOUT 側）', 'R8.2': 'R8 另一端（BIASINV 側）',
      TP5: 'TP5（+5 V）', TP7: 'TP7（+5 V）', TP8: 'TP8（AGND）', TP13: 'TP13（+2.5 V）', TP6: 'TP6（−2.5 V）'
    };
    if (fixed[pt]) return fixed[pt];
    m = /^rail:(\w+)$/.exec(pt);
    if (m) return '麵包板電源軌（沒用）';
    return pt;
  }

  /* registers this build writes (with the register faults applied); formatting shared with afe.js */
  function registers(st) {
    var s = {chip: 'ads1299', dr: 6, multiRead: false, clkOut: false, testInt: false, testAmp: 0, testFreq: 0, refBuf: true, biasMeas: false,
      biasRefInt: true, biasOn: !st.fault.nobias, biasLoffSens: false, loffMode: 'off', compTh: 0, ilead: 0,
      pd: [0, 0, 0, 0, 0, 0, 0, 0], gain: [24, 24, 24, 24, 24, 24, 24, 24], srb2: 0, mux: [0, 0, 0, 0, 0, 0, 0, 0],
      biasP: 0xFF, biasN: 0, loffP: 0, loffN: 0, loffFlip: 0, srb1: !st.fault.nosrb1, singleShot: false, compOn: false};
    var R = AFE.registers(s);
    return {regs: R, code: AFE.initCode(s, R)};
  }

  global.EEGCAP = {
    CH: CH, COLOR: COLOR, CNAME: CNAME, REFC: REFC, BIASC: BIASC, ROW_BIAS: ROW_BIAS, ROW_REF: ROW_REF, NSTEP: NSTEP,
    pPin: pPin, nPin: nPin, bbRow: bbRow, ITEMS: ITEMS, INFO: INFO, byId: byId, ENV: ENV,
    defaultState: defaultState, wiring: wiring, build: build, analyze: analyze, point: point, pointName: pointName,
    holeNet: holeNet, registers: registers
  };
})(window);
