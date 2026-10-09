"""Random transistor / diode parameters: which conclusions survive?

    python monte_carlo.py [seed] [runs] [healthy|so_open]
"""
import os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, dc, transient, press

T_ON, T_OFF, T_END, DT = 0.15, 0.55, 0.9, 2e-4
seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
runs = int(sys.argv[2]) if len(sys.argv) > 2 else 12
mode = sys.argv[3] if len(sys.argv) > 3 else 'healthy'
random.seed(seed)

for k in range(runs):
    models = {
        '3904': dict(Is=10 ** random.uniform(-14.7, -13.7), bf=random.uniform(100, 300)),
        '4403': dict(Is=10 ** random.uniform(-14.5, -13.5), bf=random.uniform(100, 250)),
        'D':    dict(Is=10 ** random.uniform(-9.3, -8.3), n=random.uniform(1.65, 1.95)),
    }
    rpot = random.choice([0.0, 5e3, 10e3])
    kw = dict(so_vm=False) if mode == 'so_open' else {}
    c = Circuit(rpot=rpot, models=models, **kw)
    V, _ = dc(c)
    out, _ = transient(c, press(T_ON, T_OFF), T_END, DT, V0=V, record=['VM'])
    vm = [(t, d['VM']) for t, d, _ in out]
    pre = [v for t, v in vm if t < T_ON]
    dur = [v for t, v in vm if T_ON <= t <= T_OFF]
    late = [v for t, v in vm if T_ON + 0.15 <= t <= T_OFF]
    post = [v for t, v in vm if t > T_OFF + 0.1]
    print(f"b3904={models['3904']['bf']:3.0f} b4403={models['4403']['bf']:3.0f} pot={rpot/1e3:4.1f}k  "
          f"rest={pre[-1]:4.2f}  spont={'Y' if max(pre)-min(pre) > 0.5 else 'n'}  "
          f"peak={max(dur):4.2f}  held={sum(late)/len(late):4.2f}  end={post[-1]:4.2f}", flush=True)
