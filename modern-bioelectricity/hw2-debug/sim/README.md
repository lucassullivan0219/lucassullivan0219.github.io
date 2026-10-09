# HW2 #2-2 Active membrane：除錯用模擬

只用 Python 標準函式庫（不需要 numpy），Python 3.8 以上都能跑。分析頁面是 [`../index.html`](../index.html)，節點名稱（`FI.B3`、`SO.S` 等）的定義見 [`../nodes.html`](../nodes.html)。

| 檔案 | 做什麼 |
|---|---|
| `sim.py` | 模擬器本體：修正節點分析（MNA）＋ backward Euler ＋ 阻尼 Newton，二極體與 BJT 用 Ebers–Moll 模型。電路照 PCB 實際走線建立。DC 不收斂時用 gmin stepping；`rest()` 是「開機、等 1 秒、在 Vm 最低點」的起點。 |
| `check_dc.py` | DC 工作點，對照測試 4–5、10a、10b、10d 的量測值；也算 R13 = 1 kΩ 時會是多少。 |
| `check_transient.py` | 每一種接觸不良組合下按 SW 的波形（測試 1、2、7、9、10c、10d）。 |
| `node_table.py` | 節點命名頁上每個節點在 A–E 五種狀態的預期電壓。 |
| `check_breadboard.py` | 第二輪麵包板：各板組合的穩態 Vm，和設計值、Slow out 故障假設比較。 |
| `check_r2.py` | 第三輪：Slow out 的 R2 = 100 Ω／1 MΩ／3 MΩ，以及消除自發小峰（Stimulator 漏電修正）和換小 R13 的效果。 |
| `power_on.py` | 開機後電路自己會做什麼：安靜停住、自發冒小峰，或（沒有 Slow out 時）自己鎖住。 |
| `variants.py` | 全部接好時，換不同設計值（R13、電源、Qsense 接法）AP 會長怎樣。 |
| `sweep_q4.py` | #2-2 Q4：把電阻換成 50k–3M 的結果，兩顆候選電阻都掃。 |
| `monte_carlo.py` | 隨機改電晶體 β、Is 與二極體參數，檢查結論是否站得住。 |
| `measure.py` | `variants.py`、`sweep_q4.py` 共用的量測函式。 |
| `make_figures.py` | 產生分析頁面上的波形資料 `../fig-data.js`。 |

```bash
python check_dc.py
python node_table.py
python check_transient.py
python power_on.py
python check_breadboard.py
python check_r2.py
python variants.py
python sweep_q4.py
python monte_carlo.py 1 12 healthy
python monte_carlo.py 5 8 so_open
python make_figures.py
```

`check_dc.py`、`node_table.py` 幾秒內跑完；其他每個 0.2–1 分鐘。

## 模型參數

| 元件 | 參數 |
|---|---|
| 2N3904 | Is = 6.7 fA，βF = 200，βR = 0.74 |
| 2N4403 | Is = 10 fA，βF = 150，βR = 4 |
| 1N4148 | Is = 2.52 nA，n = 1.752 |
| 接觸點 | 接上 = 0.05 Ω，斷開 = 10¹³ Ω |
| Slow out 的 R2 | 預設 3 MΩ（PCB 標示）；助教指定 1 MΩ，用 `Circuit(r_so_r2=1e6)` |
| 示波器探棒 | 10 MΩ（×10） |
| 電源 | V+ = 7.8 V（實測） |

這些是典型值，不是你手上那幾顆的實際值。`monte_carlo.py`、`power_on.py` 用來確認：結論在參數變動下不會翻盤。

## 節點名稱

板代號 + 節點：`ST` Stimulator、`LK` Leak、`FI` Fast inward、`SO` Slow out。`B3`/`E3` 是接到 2N3904 base/emitter 的節點，`B4`/`E4`/`C4` 是 2N4403 的。`V+`、`GND` 是 Stimulator 的電源端子，`Vm` 是 Stimulator 的輸出（CH1 平常量的點）。完整定義與焊墊位置見 [`../nodes.html`](../nodes.html)。
