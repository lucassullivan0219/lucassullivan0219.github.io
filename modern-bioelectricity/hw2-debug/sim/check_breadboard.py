"""Breadboard re-test (2026-10-09): steady-state Vm for each board combination.

The table records two numbers per combination: the resting Vm and the Vm reached
while SW is held.  Both are steady states, so they are solved as DC operating
points (SW open / SW closed).  Combinations containing the Fast inward are
bistable: the resting (FI off) and latched (FI on) branches are both given.

The stimulator current is set to about 90 uA (pot 0.7 k), which is what the
S+LK+FI row implies: 5.9 V = (8.65 V + I x 100 kohm) / 3.

Compared: the circuit as designed, and several Slow out faults.

    python check_breadboard.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, dc

MEAS = {'S': (7.1, 7.3), 'S+LK': (0.7, 7.2), 'S+FI': (3.0, 5.9), 'S+SO': (1.0, 7.2),
        'S+LK+FI': (3.1, 5.9), 'S+LK+SO': (0.5, 4.8), 'ALL': (2.4, 4.5)}
CFG = {'S': dict(leak=False, fi=False, so=False), 'S+LK': dict(fi=False, so=False),
       'S+FI': dict(leak=False, so=False), 'S+SO': dict(leak=False, fi=False),
       'S+LK+FI': dict(so=False), 'S+LK+SO': dict(fi=False), 'ALL': dict()}
LATCH = {'Vm': 3, 'LK.Vm': 3, 'FI.Vm': 3, 'FI.E4': 3, 'FI.B4': 2.5, 'FI.B3': 2.7, 'FI.E3': 2.2}
RPOT = 700.0
HYPOTHESES = [
    ('as designed', {}),
    ('SO.B3 shorted to SO.GND', dict(r_so_r2=1.0)),
    ('SO 3M-R2 is really 3 kohm', dict(r_so_r2=3e3)),
    ('SO 1K-R3 is really 100 kohm', dict(r_so_r3=1e5)),
    ('SO 1K-R3 open (2N4403 cannot sink)', dict(r_so_r3=1e13)),
]


def steady(name, **kw):
    """Vm at rest, rest + SW held, latched, latched + SW held."""
    c = Circuit(rpot=RPOT, **CFG[name], **kw)
    out = {}
    V, _ = dc(c)
    out['rest'] = c.v(V, 'Vm')
    c.set_sw(True)
    Vs, _ = c.solve(V, maxit=5000)
    out['rest+SW'] = c.v(Vs, 'Vm')
    if 'FI' in name or name == 'ALL':
        c.set_sw(False)
        VL, _ = dc(c, LATCH)
        out['latched'] = c.v(VL, 'Vm')
        c.set_sw(True)
        VLs, _ = c.solve(VL, maxit=5000)
        out['latched+SW'] = c.v(VLs, 'Vm')
    return out


if __name__ == '__main__':
    for title, kw in HYPOTHESES:
        print(f'== {title}')
        for name in MEAS:
            r = steady(name, **kw)
            m = MEAS[name]
            print(f'  {name:9s} measured rest={m[0]:<4} SW={m[1]:<4} | ' +
                  '  '.join(f'{k}={v:5.2f}' for k, v in r.items()), flush=True)

    print('\n== S+FI with an extra 100 kohm from Vm to GND (as if a leak were still connected)')
    c = Circuit(rpot=RPOT, leak=False, so=False, rprobe=1e5)   # the probe slot doubles as the extra 100 kohm
    V, _ = dc(c, LATCH)
    c.set_sw(True)
    Vs, _ = c.solve(V, maxit=5000)
    print(f'  latched={c.v(V, "Vm"):.2f}  latched+SW={c.v(Vs, "Vm"):.2f}   (measured 3.0 / 5.9)')

    print('\n== Slow out nodes, S+LK+SO, SW held (what to probe next)')
    nodes = ['Vm', 'SO.Vm', 'SO.S', 'SO.B3', 'SO.B4', 'SO.C4']
    for title, kw in HYPOTHESES[:3]:
        for sw in (False, True):
            c = Circuit(rpot=RPOT, fi=False, **kw)
            V, _ = dc(c)
            if sw:
                c.set_sw(True)
                V, _ = c.solve(V, maxit=5000)
            print(f'  {title:28s} SW {"held    " if sw else "released"}: ' +
                  '  '.join(f'{n}={c.v(V, n):5.2f}' for n in nodes))
