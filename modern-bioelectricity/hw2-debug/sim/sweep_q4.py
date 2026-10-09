"""#2-2 Q4: change one resistor to 50k / 100k / 300k / 820k / 3M, everything connected.

The handout is ambiguous about which resistor (see the analysis page), so both
candidates are swept:
  r13     : V+ -> 2N4403 emitter (the one the DIP-switch board replaces)
  r_fi_e  : 2N3904 emitter -> GND  (where the red arrow sits on the simulator schematic)

    python sweep_q4.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure import evoked, spontaneous

VALUES = [50e3, 100e3, 300e3, 820e3, 3e6]

for key in ('r13', 'r_fi_e'):
    print(f'--- sweep {key}, pot 0 (max current) ---')
    print(f'  {"value":>7s} {"rest":>5s} {"peak":>5s} {"amp":>5s} {"t_pk":>6s} {"halfW":>6s}  spontaneous')
    for r in VALUES:
        m = evoked(rpot=0.0, **{key: r})
        n, _ = spontaneous(**{key: r})
        print(f'  {r/1e3:6.0f}k {m["base"]:5.2f} {m["peak"]:5.2f} {m["amp"]:5.2f} {m["t_peak"]:6.1f} '
              f'{m["half_width"]:6.1f}  {n} bumps / 1.5 s')
m = evoked(rpot=0.0, fi=False)
print(f'  no Fast inward (TTX-like): rest={m["base"]:.2f} peak={m["peak"]:.2f} amp={m["amp"]:.2f} '
      f't_pk={m["t_peak"]:.1f} halfW={m["half_width"]:.1f} held={m["held"]:.2f}')
m = evoked(rpot=0.0, so=False)
print(f'  no Slow out (TEA-like):    rest={m["base"]:.2f} peak={m["peak"]:.2f} held={m["held"]:.2f} '
      f'after release={m["end"]:.2f}')
print('units: V and ms')
