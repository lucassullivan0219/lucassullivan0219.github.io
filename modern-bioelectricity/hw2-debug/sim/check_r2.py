"""Slow out R2 (TA: use 1 Mohm; the kit shipped 100 ohm; PCB label 3 Mohm) and fixes.

The fixes only ADD resistors clipped onto existing component legs (sim.py `extra`,
values in check_ap.py); nothing on the PCBs is cut or rewired.  "Qsense emitter after
SW" is a rewire, kept only as a reference that shows the leak is the cause.

For each case: power on, run 2 s with SW released, then hold SW for 1 s and
release.  Reports
  - free running:  Vm range and spike rate in the last second before SW
  - SW pressed:    first peak in the first 60 ms
  - SW held:       Vm range and oscillation frequency in the last 0.5 s of the hold
  - after release: Vm range in the last 0.5 s

    python check_r2.py            (all cases, a few minutes)
    python check_r2.py 0 3        (only cases 0..2)
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, transient
from check_ap import RX, R13_11K, R13_1K, RF_1M, RF_470K, RB_470K, RS_47K

DT = 2e-4
RPOT = 700.0          # ~90 uA, the setting implied by the breadboard re-test
R13_100K = ('FI.V+', 'FI.E4', 100e3)   # 100k || 100k = 50 kohm
CASES = [
    ('R2 = 1M (as built now)', dict(r_so_r2=1e6)),
    ('R2 = 100 ohm (kit part)', dict(r_so_r2=100.0)),
    ('R2 = 3M (PCB label)', dict(r_so_r2=3e6)),
    ('R2 = 1M, Qsense emitter after SW (reference only)', dict(r_so_r2=1e6, qsense_on_switched=True)),
    ('R2 = 1M, fix 1: 22k across Qpass E-B', dict(r_so_r2=1e6, extra=[RX])),
    ('fix 1, no FI (passive response)', dict(r_so_r2=1e6, fi=False, extra=[RX])),
    ('fix 1 + 100k across R13 (R13 -> 50k)', dict(r_so_r2=1e6, extra=[RX, R13_100K])),
    ('fix 1 + 11k across R13 (R13 -> 9.9k)', dict(r_so_r2=1e6, extra=[RX, R13_11K])),
    ('fix 1 + 1k across R13 (R13 -> 0.99k)', dict(r_so_r2=1e6, extra=[RX, R13_1K])),
    ('11k across R13 only, leak not fixed', dict(r_so_r2=1e6, extra=[R13_11K])),
    ('extra 100k from Vm to GND (confirmation test only)', dict(r_so_r2=1e6, extra=[('Vm', 'GND', 100e3)])),
    ('fix 1b: 1M V+ -> FI.E3 (Stimulator untouched)', dict(r_so_r2=1e6, extra=[RF_1M])),
    ('fix 1b + 11k across R13', dict(r_so_r2=1e6, extra=[RF_1M, R13_11K])),
    ('undershoot set: 470k V+ -> Vm, 470k V+ -> FI.E3, 47k across SO C1, 11k across R13',
     dict(r_so_r2=1e6, extra=[RB_470K, RF_470K, RS_47K, R13_11K])),
]


def spikes(t, v, thr):
    """Upward crossings of thr -> (count, mean period)."""
    up = [t[i] for i in range(1, len(v)) if v[i - 1] < thr <= v[i]]
    per = (up[-1] - up[0]) / (len(up) - 1) if len(up) > 1 else None
    return len(up), per


def run(title, kw):
    c = Circuit(rpot=RPOT, **kw)
    V = [0.0] * len(c.nodes)
    ev = [(2.0, lambda k: k.set_sw(True)), (3.0, lambda k: k.set_sw(False))]
    out, _ = transient(c, ev, 4.0, DT, V0=V, record=['Vm'])
    t = [p[0] for p in out]
    v = [p[1]['Vm'] for p in out]
    seg = lambda a, b: [(ti, vi) for ti, vi in zip(t, v) if a <= ti < b]
    free = seg(1.0, 2.0)
    fv = [x for _, x in free]
    lo, hi = min(fv), max(fv)
    n, per = spikes([x for x, _ in free], fv, lo + 0.5 * (hi - lo)) if hi - lo > 0.2 else (0, None)
    first = seg(2.0, 2.06)
    fpk = max(x for _, x in first)
    held = seg(2.5, 3.0)
    hv = [x for _, x in held]
    hlo, hhi = min(hv), max(hv)
    hn, hper = spikes([x for x, _ in held], hv, hlo + 0.5 * (hhi - hlo)) if hhi - hlo > 0.1 else (0, None)
    post = [x for _, x in seg(3.5, 4.0)]
    print(f'{title}\n'
          f'   free:    Vm {lo:.2f}-{hi:.2f} V, {n} spikes/s' + (f' (every {per*1e3:.0f} ms)' if per else '') + '\n'
          f'   press:   first peak {fpk:.2f} V\n'
          f'   held:    Vm {hlo:.2f}-{hhi:.2f} V' + (f', {1/hper:.0f} Hz' if hper else ', steady') + '\n'
          f'   release: Vm {min(post):.2f}-{max(post):.2f} V', flush=True)


if __name__ == '__main__':
    a = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    b = int(sys.argv[2]) if len(sys.argv) > 2 else len(CASES)
    for title, kw in CASES[a:b]:
        run(title, kw)
