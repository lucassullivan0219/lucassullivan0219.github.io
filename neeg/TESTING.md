# NEEG-2 網頁接收端：真機手動測試清單

自動測試（`neeg/test.html`）已涵蓋解碼、濾波、頻譜、品質指標、錄製格式、dongle CSV 解析；
這份清單只列**必須用真的帽子、手機、電腦才能驗證**的項目。

每一節做完，請在 Log 分頁按 **Copy** 把 log 貼回來；有錄製的話附上 CSV + JSON。

## 0. 前置

- [ ] ESP32 dongle **拔掉**（JDY-23 一次只接受一個連線，被 dongle 連住時手機找不到）
- [ ] Android：定位開啟、Chrome 有「鄰近裝置」權限（Android 12+）
- [ ] 帽子電量正常、電極照平常方式戴好
- [ ] 記下：手機型號 / Android 版本 / Chrome 版本；電腦 Windows 版本 / Chrome 版本

## 1. 連線（Android Chrome、Windows Chrome 各做一次）

- [ ] Device 頁 Web Bluetooth 顯示 **yes**；記下 Remembered devices / In-page scan 是 yes 還是 no
- [ ] 按 **Add device…**，選擇視窗**只列出 JDY 類模組**（不是一堆 Unknown device）
  - 若清單是空的：勾「List every nearby device」再試，並記下是哪種情況（代表 JDY-23 沒廣播 FFE0、名稱也不是 JDY 開頭）
- [ ] 連上後狀態變 **Connected**，Rate 穩定在 **約 125 Hz**
- [ ] 約 1 秒內裝置出現 **NEEG-2 ✓** 標記；按 ✎ 命名（例如 Headset 07）
- [ ] Bad frames、Skipped B 維持在 0 或極少（偶發幾個可接受，持續增加要回報）
- [ ] 重新整理頁面：
  - Remembered devices = yes → 清單應直接出現剛才的裝置與名稱，按 Connect 不需選擇視窗
  - Remembered devices = no → 需要再按 Add device…（記下名稱是否還在，用來判斷裝置 id 是否固定）

## 2. 斷線與重連

- [ ] 按裝置列的 **Disconnect** → 狀態 Disconnected，不應自動重連
- [ ] 連線中**關掉帽子電源** → 狀態 `Reconnecting (1/10)…`；10 秒內再開機 → 自動恢復 Connected、Rate 回到 125
- [ ] 連線中把手機**拿遠到斷線**再走回來 → 同上
- [ ] 帽子開著但停止送資料（若能模擬，例如 STM32 reset）→ 2 秒後狀態顯示 **No data > 2 s**

## 3. 訊號（Signal / Quality 分頁）

- [ ] 1–50 Hz 模式下波形連續、沒有週期性尖刺或平線
- [ ] **閉眼放鬆 10–20 秒**：頻譜 8–12 Hz 出現隆起；睜眼後消失
- [ ] **咬牙**：波形出現大幅高頻雜訊；Quality 顯示 Large amplitude（Check）
- [ ] **拔掉一個電極**：該通道 Quality 變 Railed 或 Flat（Poor）
- [ ] 頻譜虛線在 60 Hz；若 60 Hz 尖峰很高，Quality 的 60 Hz share 對應升高
- [ ] Raw / Remove DC / 1–50 Hz 切換即時生效；手動縱軸 ±50…±500 µV 正常
- [ ] 與 PC 版 neeg_monitor.py 同時段比較（需分兩次連線）：RMS、市電佔比數量級一致

## 4. 長時間錄製

- [ ] 按上方 **●** 開始錄製，計時跳動；Recording 面板顯示 screen kept on
- [ ] 錄製 **30 分鐘**，期間手機螢幕保持亮著、頁面在前景
- [ ] 按 ■ 停止 → Recording 面板顯示樣本數與 expected，兩者差距應 < 1%
- [ ] **Download CSV**、**Download JSON** 都能下載（手機上確認下載到哪裡）
- [ ] 錄製中重新整理或關閉頁面 → 瀏覽器應先跳出「離開網站？」確認

## 5. 背景 / 熄螢幕行為（推論待驗證）

不確定 Android 在頁面切到背景或熄螢幕時是否暫停 BLE 通知，請實測：

- [ ] 錄製中**切到別的 App 1 分鐘**再切回
- [ ] 錄製中**手動按電源鍵熄螢幕 1 分鐘**再開（Wake Lock 只防自動熄滅，擋不住手動）
- [ ] 停止錄製後用下方第 6 節的腳本找出 `epoch_ms` 的空檔：
  - 空檔約 60 秒 → 背景時資料停送（目前預期）
  - 沒有空檔但樣本數少於 expected → 資料在背景遺失
  - 都正常 → 背景可持續接收

## 6. CSV 內容檢查

```python
import json
import pandas as pd

name = 'neeg_20261008_120000'           # 換成實際檔名
df = pd.read_csv(f'{name}.csv')
meta = json.load(open(f'{name}.json'))

print('samples', len(df), 'expected', meta['expectedSamples'])
print('index jumps', (df.sample_index.diff().dropna() != 1).sum())     # 應為 0

gap = df.epoch_ms.diff()
print(gap.describe())                                                   # BLE 成叢送達，大多 0~50 ms
print(df.loc[gap > 500, ['sample_index', 'epoch_ms']])                  # > 0.5 s 的空檔（背景/斷線）

k = meta['scale']['uvPerCount']
print('uV check', (df.fp1_uV - df.raw0 * k).abs().max())               # 應 < 1e-4

# STM32 沒有新 ADC 資料時會重送上一筆；兩通道同時與前一筆相同的比例
dup = (df.raw0.diff() == 0) & (df.raw1.diff() == 0)
print('repeated samples', f'{dup.mean():.2%}')

# 實際取樣率（以到達時間估算，長時間平均）
print('rate', (len(df) - 1) / ((df.epoch_ms.iloc[-1] - df.epoch_ms.iloc[0]) / 1000))
```

- [ ] 現有分析腳本能直接讀新 CSV（前 9 欄與 neeg_monitor.py 相同）
- [ ] repeated samples 比例記下來回報（判斷是否需要韌體加序號）

## 7. ESP32 dongle（Windows Chrome / Edge）

- [ ] 插上 dongle，Device 頁 **Connect dongle**（921600 baud），選 COM port
- [ ] Log 出現 `dongle [BOOT] …`、`dongle [STATE] …`
- [ ] Rate 約 125 Hz；Fillers 計數會增加（dongle 補值列被剔除）
- [ ] 拔掉 USB → 狀態 Dongle unplugged
- [ ] port 被 neeg_monitor.py 佔用時 → 顯示 Cannot open port

## 回報格式

```
裝置/瀏覽器：
第 1 節：✓ / ✗（說明）
...
附件：Copy log、CSV、JSON
```
