/* Board schematics for the ADS129x pages, written as circuit-sim documents.

   AFE.boards.cyton(opts) -> text      OpenBCI Cyton (V3 32-bit) ADS1299 front end, from the
                                       published schematic (docs.openbci.com, V3_Hardware_Design_Files):
     every header pin: TVS (TPD4E1B06) -> 2.2 kOhm (CAY16 array) -> 1 nF to AGND (CKCA43 array) -> ADS1299 pin
     BIAS: BIAS_OUT (tied to BIAS_IN) -> 1 MOhm || 1 nF -> BIAS_DRV -> 2.2 kOhm -> BIAS pin; BIAS_INV only to the Daisy header
     BIAS_REF to AGND; CLKSEL to DVDD (internal oscillator); VREFP-VREFN 10 uF || 0.1 uF, VREFN to AVSS;
     VCAP1 100 uF, VCAP2 1 uF, VCAP3 1 uF || 0.1 uF, VCAP4 1 uF; supplies +-2.5 V and 3.3 V.
   opts: {labels: [8 electrode names], montage: 'srb2' (OpenBCI: electrodes on the N pins, reference on SRB2)
          | 'srb1' (datasheet Fig. 73: electrodes on the P pins, reference on SRB1),
          supply: 'bi' | 'uni', biasToGnd: false, elec: 'wet'}
   Layout: ADS1299 body at (40,10), 30 x 48 grid units; N inputs on the left, P inputs on the right. */
(function (global) {
  'use strict';
  var AFE = global.AFE;

  function cyton(opts) {
    opts = opts || {};
    var labels = opts.labels || ['Fp1', 'Fp2', 'C3', 'C4', 'P3', 'P4', 'O1', 'O2'], montage = opts.montage || 'srb2';
    var elec = opts.elec || 'wet', uni = opts.supply === 'uni', L = [];
    function add() { L.push(Array.prototype.join.call(arguments, ' ')); }
    function W(a, b, c, d) { add('W', a + ',' + b, c + ',' + d); }

    add('TITLE OpenBCI Cyton ADS1299 前端');
    add('TEXT 2,-4 [h] OpenBCI Cyton（V3 32-bit）的 ADS1299 前端');
    add('TEXT 2,-2 電源：' + (uni ? '5 V 單電源（AVSS 接地）' : '±2.5 V') + '、DVDD 3.3 V。實板是電荷泵加 LDO，這裡用理想電源。');
    add('TEXT 2,10 每個排針：TVS（TPD4E1B06）→ 2.2 kΩ（CAY16 電阻陣列）→ 1 nF 對地（CKCA43 電容陣列）→ 晶片腳');
    add('TEXT 46,-1 資料手冊：VREFP–VREFN ≥ 10 µF，VCAP1 100 µF，VCAP2–4 1 µF');
    add('TEXT 74,9 ' + (montage === 'srb2' ? 'P 輸入（上排排針）：沒接電極；CHnSET 的 SRB2 位元讓晶片把 INxP 接到 SRB2' : 'P 輸入：電極接這裡，參考電極接 SRB1（MISC1.SRB1 = 1）'));
    add('TEXT 2,62 BIAS：BIAS_OUT（＝BIAS_IN）→ 1 MΩ ∥ 1 nF → 2.2 kΩ → BIAS 電極。');
    add('TEXT 2,64 BIAS_INV 只接到 Daisy 排針：板上沒有回授電阻，迴路是經過人體閉合的。');

    /* supplies */
    add('V VAVDD 2,2 2,6', uni ? 5 : 2.5); add('NODE AVDD 2,2 [a]'); add('GND 2,6');
    add('C C21 7,2 7,6 1u'); W(2, 2, 7, 2); W(2, 6, 7, 6);
    if (uni) { add('NODE AVSS 12,2 [a]'); add('W 12,2 12,4'); add('GND 12,4'); }
    else { add('V VAVSS 12,2 12,6 -2.5'); add('NODE AVSS 12,2 [a]'); add('GND 12,6'); add('C C18 17,2 17,6 1u'); W(12, 2, 17, 2); W(12, 6, 17, 6); }
    add('V VDVDD 22,2 22,6 3.3'); add('NODE DVDD 22,2 [a]'); add('GND 22,6');
    add('C C43 27,2 27,6 100n'); W(22, 2, 27, 2); W(22, 6, 27, 6);

    add('IC U1 ads1299 40,10');

    /* reference and regulator decoupling above the chip, all to an AVSS rail at y = 2 */
    W(44, 8, 44, 6); add('NODE AVDD 44,6 [l]');
    W(47, 8, 47, 6); W(47, 6, 47, 4); add('C C1 47,4 47,2 10u'); W(47, 6, 50, 6); W(50, 6, 50, 4); add('C C5 50,4 50,2 100n');
    W(53, 8, 53, 2);
    W(55, 8, 55, 4); add('C C2 55,4 55,2 100u');
    W(58, 8, 58, 4); add('C C7 58,4 58,2 1u');
    W(61, 8, 61, 6); W(61, 6, 61, 4); add('C C19 61,4 61,2 1u'); W(61, 6, 64, 6); W(64, 6, 64, 4); add('C C15 64,4 64,2 100n');
    W(67, 8, 67, 4); add('C C6 67,4 67,2 1u');
    [47, 50, 53, 55, 58, 61, 64, 67].reduce(function (a, b) { W(a, 2, b, 2); return b; });
    add('NODE AVSS 67,2');

    /* power and clock pins below */
    W(45, 60, 45, 62); add('NODE AVSS 45,62 [b]');
    W(49, 60, 49, 62); add('GND 49,62');
    W(54, 60, 54, 62); W(60, 60, 60, 62); W(54, 62, 60, 62); add('NODE DVDD 54,62 [b]');
    W(66, 60, 66, 62); add('J J:CLK 66,62 [b]');

    /* input rows: header pin, TVS, 2.2 kOhm, 1 nF, chip pin */
    function leftRow(y, id) {
      add('J J:' + id + ' 18,' + y + ' [a]'); W(18, y, 20, y);
      add('TVS D' + id + ' 20,' + y + ' 20,' + (y + 2) + ' BV=6.5 CJ=0.8p'); add('GND 20,' + (y + 2));
      W(20, y, 24, y); add('R R' + id + ' 24,' + y + ' 28,' + y + ' 2.2k');
      W(28, y, 31, y); add('C C' + id + ' 31,' + y + ' 31,' + (y + 2) + ' 1n'); add('GND 31,' + (y + 2));
      W(31, y, 38, y);
    }
    function rightRow(y, id) {
      W(72, y, 79, y); add('C C' + id + ' 79,' + y + ' 79,' + (y + 2) + ' 1n'); add('GND 79,' + (y + 2));
      W(79, y, 82, y); add('R R' + id + ' 82,' + y + ' 86,' + y + ' 2.2k');
      W(86, y, 90, y); add('TVS D' + id + ' 90,' + y + ' 90,' + (y + 2) + ' BV=6.5 CJ=0.8p'); add('GND 90,' + (y + 2));
      W(90, y, 92, y); add('J J:' + id + ' 92,' + y + ' [a]');
    }
    for (var k = 0; k < 8; k++) { leftRow(12 + 4 * k, (k + 1) + 'N'); rightRow(12 + 4 * k, (k + 1) + 'P'); }
    leftRow(44, 'SRB2'); rightRow(44, 'SRB1');

    /* bias */
    add('J J:BIAS 18,50 [a]'); W(18, 50, 20, 50);
    add('TVS DBIAS 20,50 20,52 BV=6.5 CJ=0.8p'); add('GND 20,52');
    W(20, 50, 24, 50); add('R RBIAS 24,50 28,50 2.2k');
    if (opts.biasToGnd) { W(28, 50, 28, 52); add('GND 28,52'); }
    else { add('R R5 28,50 32,50 1meg'); W(28, 50, 28, 53); add('C C16 28,53 32,53 1n'); W(32, 53, 32, 50); W(32, 50, 36, 50); }
    W(36, 50, 38, 50); W(36, 50, 36, 52); W(36, 52, 38, 52);
    W(38, 54, 36, 54); add('J J:BIAS_INV 36,54 [b]');
    W(38, 56, 36, 56); add('GND 36,56');

    /* electrodes, in a fixed order: the eight channels, the reference, the bias electrode */
    labels.forEach(function (nm, i) {
      var y = 12 + 4 * i;
      if (montage === 'srb2') { add('ELEC ' + nm + ' 15,' + y + ' [l] TYPE=' + elec); W(15, y, 18, y); }
      else { add('ELEC ' + nm + ' 95,' + y + ' [r] TYPE=' + elec); W(92, y, 95, y); }
    });
    if (montage === 'srb2') { add('ELEC REF 15,44 [l] TYPE=' + elec); W(15, 44, 18, 44); }
    else { add('ELEC REF 95,44 [r] TYPE=' + elec); W(92, 44, 95, 44); }
    add('ELEC BIAS 15,50 [l] TYPE=' + elec); W(15, 50, 18, 50);
    return L.join('\n');
  }

  /* set a parameter on every part of one type in a document (e.g. all electrodes dry) */
  function setAll(text, type, key, value) {
    var CS = global.CircuitSim, doc = CS.parseDoc(text);
    doc.parts.forEach(function (p) { if (p.type === type) p.params[key] = value; });
    return CS.docToText(doc);
  }

  AFE.boards = {cyton: cyton, setAll: setAll};
})(window);
