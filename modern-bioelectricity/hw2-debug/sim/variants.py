"""Healthy circuit (everything connected) under different design values.

Shows why the AP on the PCB as built is small: R13 = 100 kohm (schematic: 1 kohm)
and the Stimulator leaks about 6 uA while SW is released.

    python variants.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure import evoked, spontaneous

CASES = [
    ('PCB as built (V+ 7.8 V, R13 100k), pot 10k', dict(rpot=10e3)),
    ('PCB as built, pot 0 (max current)', dict(rpot=0.0)),
    ('Qsense moved after SW (no SW-open leak)', dict(rpot=0.0, qsense_on_switched=True)),
    ('R13 = 1k (schematic value)', dict(rpot=0.0, r13=1e3)),
    ('V+ = 12 V', dict(rpot=0.0, vplus=12.0)),
    ('Schematic: 9 V, R13 1k, Qsense after SW', dict(rpot=0.0, vplus=9.0, r13=1e3, qsense_on_switched=True)),
]

print(f'{"case":44s} {"rest":>5s} {"peak":>5s} {"amp":>5s} {"t_pk":>6s} {"halfW":>6s} {"held":>5s}  spontaneous')
for name, kw in CASES:
    m = evoked(**kw)
    n, vmax = spontaneous(**kw)
    print(f'{name:44s} {m["base"]:5.2f} {m["peak"]:5.2f} {m["amp"]:5.2f} {m["t_peak"]:6.1f} '
          f'{m["half_width"]:6.1f} {m["held"]:5.2f}  {n} bumps in 1.5 s (max {vmax:.2f} V)')
print('units: V and ms.  held = Vm just before SW is released (0.35 s press).')
