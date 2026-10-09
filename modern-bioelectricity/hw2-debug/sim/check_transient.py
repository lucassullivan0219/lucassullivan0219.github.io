"""Transient runs for each wiring fault (tests 1, 2, 7, 9, 10c, 10d).

SW is pressed at 0.05 s and released at 0.45 s.

    python check_transient.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, dc, transient, press, rest

T_ON, T_OFF, T_END, DT = 0.05, 0.45, 0.9, 2e-4

CASES = [
    ('A  all connected', {}),
    ('B  FI V+ open, Slow out OK', dict(fi_vplus=False)),
    ('C  FI OK, Slow out Vm open', dict(so_vm=False)),
    ('D  FI V+ open, Slow out Vm open', dict(fi_vplus=False, so_vm=False)),
    ('E  Stim + Leak + Slow out (no FI)', dict(fi=False)),
    ('F  Stim + Leak + FI (no Slow out)', dict(so=False)),
]


def run(name, rpot, **kw):
    c = Circuit(rpot=rpot, **kw)
    V = rest(c)
    out, _ = transient(c, press(T_ON, T_OFF), T_END, DT, V0=V, record=['Vm', 'SO.S', 'FI.V+'])
    vm = [(t, d['Vm']) for t, d, _ in out]
    at = lambda tq: min(vm, key=lambda p: abs(p[0] - tq))[1]
    held = [v for t, v in vm if T_ON <= t <= T_OFF]
    pk = max(held)
    tpk = [t for t, v in vm if v == pk][0]
    bad = sum(1 for *_, ok in out if not ok)
    print(f'{name:36s} rest={vm[0][1]:4.2f}  peak={pk:4.2f} @{(tpk-T_ON)*1e3:4.0f} ms  '
          f'held(0.40 s)={at(0.40):4.2f}  after release(0.85 s)={at(0.85):4.2f}  '
          f'{"" if not bad else f"nonconverged={bad}"}')
    return out


for rpot in (0.0, 10e3):
    print(f'--- pot = {rpot/1e3:.0f} k ---')
    for name, kw in CASES:
        run(name, rpot, **kw)

print('\n--- test 7: Fast inward V+ pin floating, probe on that pin (pot 5 k) ---')
for so in (False, True):
    c = Circuit(rpot=5e3, fi_vplus=False, so_vm=so, probe='FI.V+')
    V = rest(c)
    out, _ = transient(c, press(T_ON, 0.35), 0.6, 5e-4, V0=V, record=['Vm', 'FI.V+'])
    print('  Slow out ' + ('connected' if so else 'open'))
    for t, d, _ in out[::80]:
        print(f'    t={t:4.2f}s  VM={d["Vm"]:4.2f}  FI V+ pin={d["FI.V+"]:4.2f}')
