"""What the circuit does by itself after power-on (all capacitors at 0 V, SW released).

For each case: Vm range during 2-3 s after power-on, the number of spontaneous bumps
(> 0.3 V) in that second, and the DC equilibrium for comparison.  Default
parameters first, then 8 random transistor/diode parameter sets.

    python power_on.py
"""
import os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, transient, dc


def run(label, **kw):
    c = Circuit(**kw)
    out, _ = transient(c, [], 3.0, 2e-4, V0=[0.0] * len(c.nodes), record=['Vm'])
    last = [d['Vm'] for _, d, _ in out][-5000:]
    bumps, armed, base = 0, True, min(last)
    for x in last:
        if armed and x > base + 0.3:
            bumps, armed = bumps + 1, False
        elif not armed and x < base + 0.1:
            armed = True
    eq, ok = dc(c)
    print(f'{label:34s} Vm {min(last):.2f}-{max(last):.2f} V  bumps/s={bumps}  '
          f'DC equilibrium Vm={c.v(eq, "Vm"):.2f}', flush=True)


run('default, everything connected')
run('default, R13 = 1k', r13=1e3)
run('default, no Slow out', so=False)
random.seed(1)
for k in range(8):
    m = {'3904': dict(Is=10 ** random.uniform(-14.7, -13.7), bf=random.uniform(100, 300)),
         '4403': dict(Is=10 ** random.uniform(-14.5, -13.5), bf=random.uniform(100, 250)),
         'D': dict(Is=10 ** random.uniform(-9.3, -8.3), n=random.uniform(1.65, 1.95))}
    run(f"random b3904={m['3904']['bf']:.0f} b4403={m['4403']['bf']:.0f}", models=m)
