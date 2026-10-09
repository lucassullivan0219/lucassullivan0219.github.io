"""Is it an action potential?  AP criteria for the add-on fixes, and the undershoot question.

Every fix here only ADDS a resistor clipped onto existing component legs (sim.py `extra`);
nothing on the PCBs is cut, desoldered or rewired.  Slow out R2 = 1 Mohm (as built now).

Criteria, typical parameters, pot 700 ohm (~90 uA) unless noted:
  quiet       no spontaneous firing with SW released (last 0.7 s of 1.5 s after power-on)
  threshold   shortest SW press that fires: the peak is more than 0.5 V above the passive
              response to the same press (Fast inward unplugged).  Searched upward in 2 ms
              steps, then bisected to 0.5 ms.  V_th = highest Vm of the longest press that
              does not fire
  all-or-none peak for a 50 ms press at pot 0.7k and pot 10k (~90 and ~44 uA; 64 and 19 uA
              with the 22k add-on), and the same with the Fast inward unplugged (passive)
  shape       press T_th + 5 ms: peak, time from peak back to rest + 10 % of the amplitude,
              lowest Vm afterwards minus rest (undershoot) and how long Vm stays more than
              0.05 V below rest
  held        Vm range in the last 0.25 s of a 0.5 s hold

    python check_ap.py              (all cases, about 3 minutes)
    python check_ap.py 3 5          (cases 3..4 only)
    python check_ap.py mc 6 8 1     (case 6 with 8 random parameter sets, seed 1)
"""
import os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, transient

DT = 2e-4
RPOT = 700.0
RX = ('ST.Q', 'ST.R', 22e3)          # 22 kohm across Qpass E-B: 7K-R1 lower end to 7K-R2 upper end
R13_11K = ('FI.V+', 'FI.E4', 11e3)   # across R13: 100k || 11k = 9.9 kohm
R13_1K = ('FI.V+', 'FI.E4', 1e3)     # 100k || 1k = 0.99 kohm
RF_1M = ('FI.V+', 'FI.E3', 1e6)      # R13 lower end to 100K-R2 upper end: FI threshold up ~0.8 V
RF_470K = ('FI.V+', 'FI.E3', 470e3)  # same clip points: FI threshold up ~1.5 V
RB_470K = ('V+', 'Vm', 470e3)        # breadboard V+ row to Vm row: raises the resting potential
RS_47K = ('SO.S', 'SO.GND', 47e3)    # across SO C1: Slow out threshold up (SO.S = 0.32 Vm)

CASES = [
    ('now: R2 = 1M, nothing added', {}),
    ('Qsense emitter after SW (reference only, not a fix to make)', dict(qsense_on_switched=True)),
    ('fix 1: 22k across Qpass E-B', dict(extra=[RX])),
    ('fix 1 + 2: and 11k across R13', dict(extra=[RX, R13_11K])),
    ("fix 1 + 2': and 1k across R13", dict(extra=[RX, R13_1K])),
    ('fix 1b + 2: 1M V+ -> FI.E3, 11k across R13 (Stimulator untouched)', dict(extra=[RF_1M, R13_11K])),
    ('fix 1 + 1b + 2: 22k, 1M, 11k', dict(extra=[RX, RF_1M, R13_11K])),
    ('undershoot: 470k V+ -> Vm, 470k V+ -> FI.E3, 47k across SO C1, 11k across R13',
     dict(extra=[RB_470K, RF_470K, RS_47K, R13_11K])),
    # why each of the four parts is needed
    ('attempt: only 470k V+ -> Vm (with 11k across R13)', dict(extra=[RB_470K, R13_11K])),
    ('attempt: 470k V+ -> Vm and 470k V+ -> FI.E3, no 47k (with 11k across R13)',
     dict(extra=[RB_470K, RF_470K, R13_11K])),
    ('attempt: 470k, 470k, 47k, R13 left at 100k', dict(extra=[RB_470K, RF_470K, RS_47K])),
]


def free(c, T=1.5):
    """Power on (all nodes 0 V), SW released.  Returns (state, Vm min, Vm max) of the last 0.7 s."""
    out, V = transient(c, [], T, DT, V0=[0.0] * len(c.nodes), record=['Vm'])
    v = [d['Vm'] for t, d, _ in out if t > T - 0.7]
    return V, min(v), max(v)


def press(kw, V, T, after=0.4, rpot=RPOT, fi=True):
    """Press SW for T seconds starting from state V.  Returns (t, Vm) lists; release at t = T."""
    c = Circuit(rpot=rpot, r_so_r2=1e6, fi=fi, **kw)
    ev = [(0.0, lambda k: k.set_sw(True)), (T, lambda k: k.set_sw(False))]
    out, _ = transient(c, ev, T + after, DT, V0=V, record=['Vm'])
    return [0.0] + [p[0] for p in out], [c.v(V, 'Vm')] + [p[1]['Vm'] for p in out]


def fires(kw, V, Vp, T):
    """(fired?, highest Vm) for a T-second press: compare with the passive response."""
    v = press(kw, V, T, after=0.2)[1]
    vp = press(kw, Vp, T, after=0.2, fi=False)[1]
    return max(v) > max(vp) + 0.5, max(v)


def threshold(kw, V, Vp):
    """Press 2, 4, 6 ... 80 ms until one fires, then bisect."""
    lo, hi, vlo = 0.0, 2e-3, None
    while True:
        ok, vmax = fires(kw, V, Vp, hi)
        if ok:
            break
        if hi >= 80e-3:
            return None, None
        lo, vlo, hi = hi, vmax, hi + 2e-3
    while hi - lo > 0.5e-3:
        mid = (lo + hi) / 2
        ok, vmax = fires(kw, V, Vp, mid)
        if ok:
            hi = mid
        else:
            lo, vlo = mid, vmax
    return hi, vlo


def shape(t, v, rest):
    ip = max(range(len(v)), key=lambda i: v[i])
    pk = v[ip]
    lvl = rest + 0.1 * (pk - rest)
    back = next((t[i] for i in range(ip, len(v)) if v[i] <= lvl), None)
    im = min(range(ip, len(v)), key=lambda i: v[i])
    below = [t[i] for i in range(ip, len(v)) if v[i] < rest - 0.05]
    return dict(peak=pk, t_peak=t[ip], repol=(back - t[ip]) if back else None,
                vmin=v[im], under=rest - v[im], under_ms=(below[-1] - below[0]) * 1e3 if below else 0.0)


def held(kw, V, T=0.5):
    t, v = press(kw, V, T, after=0.01)
    w = [x for ti, x in zip(t, v) if T - 0.25 < ti < T]
    return min(w), max(w)


def run(title, kw):
    c = Circuit(rpot=RPOT, r_so_r2=1e6, **kw)
    V, lo, hi = free(c)
    quiet = hi - lo < 0.1
    print(title)
    print(f'   SW released: Vm {lo:.2f}-{hi:.2f} V ' + ('(quiet)' if quiet else '(fires by itself)'))
    if not quiet:
        return
    rest = c.v(V, 'Vm')
    Vp = free(Circuit(rpot=RPOT, r_so_r2=1e6, fi=False, **kw))[0]
    pk = {}
    for name, rp in (('0.7k', RPOT), ('10k', 10e3)):
        pk[name] = max(press(kw, V, 0.05, rpot=rp)[1])
        pk[name + ' noFI'] = max(press(kw, Vp, 0.05, rpot=rp, fi=False)[1])
    print(f'   50 ms press peak: {pk["0.7k"]:.2f} V at pot 0.7k, {pk["10k"]:.2f} V at pot 10k;'
          f'  FI unplugged: {pk["0.7k noFI"]:.2f} / {pk["10k noFI"]:.2f} V')
    T, vth = threshold(kw, V, Vp)
    vth = rest if vth is None else vth
    if T is None:
        print('   no press up to 80 ms makes it fire')
    else:
        Ts = round(T * 1e3 + 5) / 1e3
        t, v = press(kw, V, Ts)
        s = shape(t, v, rest)
        rp = f'{s["repol"]*1e3:.0f} ms' if s['repol'] else 'not within 0.4 s'
        print(f'   threshold: press >= {T*1e3:.1f} ms; Vm reaches {vth:.2f} V without firing (rest {rest:.2f} V)')
        print(f'   {Ts*1e3:.0f} ms press: peak {s["peak"]:.2f} V at {s["t_peak"]*1e3:.1f} ms, back to rest+10% in {rp},'
              f' lowest after peak {s["vmin"]:.2f} V -> undershoot {s["under"]:+.2f} V'
              + (f' for {s["under_ms"]:.0f} ms' if s['under_ms'] else ''))
    hl, hh = held(kw, V)
    print(f'   held 0.5 s: Vm {hl:.2f}-{hh:.2f} V', flush=True)


def monte_carlo(kw, runs, seed):
    """Random transistor / diode parameters (same ranges as monte_carlo.py)."""
    random.seed(seed)
    for k in range(runs):
        m = {'3904': dict(Is=10 ** random.uniform(-14.7, -13.7), bf=random.uniform(100, 300)),
             '4403': dict(Is=10 ** random.uniform(-14.5, -13.5), bf=random.uniform(100, 250)),
             'D': dict(Is=10 ** random.uniform(-9.3, -8.3), n=random.uniform(1.65, 1.95))}
        k2 = dict(kw, models=m)
        V, lo, hi = free(Circuit(rpot=RPOT, r_so_r2=1e6, **k2))
        s = f"b3904={m['3904']['bf']:3.0f} b4403={m['4403']['bf']:3.0f}  released {lo:.2f}-{hi:.2f}"
        if hi - lo < 0.1:
            for T in (0.02, 0.05):
                t, v = press(k2, V, T)
                s += f' | {T*1e3:.0f} ms: peak {max(v):.2f} low {min(v[v.index(max(v)):]):.2f} end {v[-1]:.2f}'
            hl, hh = held(k2, V)
            s += f' | held {hl:.2f}-{hh:.2f}'
        print(s, flush=True)


if __name__ == '__main__':
    if sys.argv[1:2] == ['mc']:
        i = int(sys.argv[2])
        print(CASES[i][0])
        monte_carlo(CASES[i][1], int(sys.argv[3]) if len(sys.argv) > 3 else 8,
                    int(sys.argv[4]) if len(sys.argv) > 4 else 1)
    else:
        a = int(sys.argv[1]) if len(sys.argv) > 1 else 0
        b = int(sys.argv[2]) if len(sys.argv) > 2 else len(CASES)
        for title, kw in CASES[a:b]:
            run(title, kw)
