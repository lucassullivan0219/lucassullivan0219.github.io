# HW2 #2-2 Active membrane：除錯用模擬

只用 Python 標準函式庫（不需要 numpy），Python 3.8 以上都能跑。分析頁面是 [`../index.html`](../index.html)。

| 檔案 | 做什麼 |
|---|---|
| `sim.py` | 模擬器本體：修正節點分析（MNA）＋ backward Euler ＋ 阻尼 Newton，二極體與 BJT 用 Ebers–Moll 模型。電路照 PCB 實際走線建立。 |
| `check_dc.py` | DC 工作點，對照測試 4–5、10a、10b、10d 的量測值；也算 R13 = 1 kΩ 時會是多少。 |
| `check_transient.py` | 每一種接觸不良組合下按 SW 的波形（測試 1、2、7、9、10c、10d）。 |
| `variants.py` | 全部接好時，換不同設計值（R13、電源、Qsense 接法）AP 會長怎樣。 |
| `sweep_q4.py` | #2-2 Q4：把電阻換成 50k–3M 的結果，兩顆候選電阻都掃。 |
| `monte_carlo.py` | 隨機改電晶體 β、Is 與二極體參數，檢查結論是否站得住。 |
| `measure.py` | `variants.py`、`sweep_q4.py` 共用的量測函式。 |
| `make_figures.py` | 產生分析頁面上的波形資料 `../fig-data.js`。 |

```bash
python check_dc.py
python check_transient.py
python variants.py
python sweep_q4.py
python monte_carlo.py 1 12 healthy
python monte_carlo.py 5 8 so_open
python make_figures.py
```

`check_dc.py` 不到 1 秒；其他每個 0.1–1 分鐘。

## 模型參數

| 元件 | 參數 |
|---|---|
| 2N3904 | Is = 6.7 fA，βF = 200，βR = 0.74 |
| 2N4403 | Is = 10 fA，βF = 150，βR = 4 |
| 1N4148 | Is = 2.52 nA，n = 1.752 |
| 接觸點 | 接上 = 0.05 Ω，斷開 = 10¹³ Ω |
| 示波器探棒 | 10 MΩ（×10） |
| 電源 | V+ = 7.8 V（實測） |

這些是典型值，不是你手上那幾顆的實際值。`monte_carlo.py` 用來確認：結論在參數變動下不會翻盤。
