"""#2-3 Passive to active: Stimulator -> n passive units (1 uF || 100 kohm, 10 kohm apart)
-> active membrane (Leak + Fast inward + Slow out), wired as in the handout figure
(sim.py chain=n).  Slow out R2 = 1 Mohm.  CH1 = Vm at the active end, CH2 = AX, the
extracellular node of the active end (both against the Stimulator GND).

FI supply: the passive base PCB does not carry V+ between slots, so FI.V+ needs a flying
wire from the Stimulator's battery and the FI current then returns through the extracellular
100 ohm row ('stim', default).  Without that wire FI has no supply at n >= 1 (fi_vplus=False,
'no V+ wire' states; at n = 0 they also open the header's V+ contact): only the passive
response is left.  The '... own battery' states give
FI a battery between FI.V+ and its own extracellular node, as drawn in the handout's
simulator ('local').

For each active-membrane state (add-ons from check_ap.py) and n = 0..4:
  quiet   SW released, last 0.7 s of 1.5 s after power-on: Vm range at the active end
  Q3      I_min: smallest current of a 1 s pulse that fires (peak more than 0.5 V above the
          response with the Fast inward unplugged), bisection to 1 %.  An ideal current
          source is used so any value can be tried; the Stimulator stays in place with SW
          released, so its leak (if not fixed) is still there.  The real pot only reaches
          about 44-99 uA (19-73 uA with the 22k add-on).
  Q4      delay from pulse start to the first AP peak at 1.05 x I_min(n = 4)
  Q2/Q5   the real Stimulator at pot 0.7k, SW held 1 s: first AP at the active end
          (CH1) and the extracellular signal (CH2): baseline, peak, amplitude,
          half-width, rise tau (pulse start -> 63 %), decay tau (peak -> 37 %)

    python check_23.py              (all states, a few minutes on 4+ cores)
    python check_23.py 1            (state 1 only)
    python check_23.py combos       (the original circuit with and without the V+ wire to FI,
                                     SW held 1 s at pot 0.7k, n = 1-4; tells from the bench
                                     waveform whether FI is powered)
"""
import os, sys
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, transient
from check_ap import RX, R13_11K, RF_470K, RB_470K, RS_47K

DT = 2e-4
RPOT = 700.0
PULSE = 1.0
NS = range(5)
STATES = [
    ('now: R2 = 1M, V+ wire to FI, nothing added', {}),
    ('11k across R13 only (leak not fixed)', dict(extra=[R13_11K])),
    ('fix 1 + 2: 22k across Qpass E-B, 11k across R13', dict(extra=[RX, R13_11K])),
    ('undershoot set (plan 3)', dict(extra=[RB_470K, RF_470K, RS_47K, R13_11K])),
    ('now, FI on its own battery (handout simulator)', dict(fi_supply='local')),
    ('11k across R13 only, FI on its own battery', dict(extra=[R13_11K], fi_supply='local')),
    ('fix 1 + 2, FI on its own battery', dict(extra=[RX, R13_11K], fi_supply='local')),
    ('R2 = 1M, no V+ wire to FI', dict(fi_vplus=False)),
]


def circuit(n, kw, fi=True, rpot=RPOT, src=True):
    c = Circuit(**dict(dict(rpot=rpot, r_so_r2=1e6, chain=n, fi=fi), **kw))
    if src:                                   # ideal current source: IS (1e9 x I volts) -> 1 Gohm
        c.fixed['IS'] = 0.0
        c.R.append(['IS', 'PC1' if n else 'Vm', 1e9, 'src'])
    return c


def settle(c, T=1.5):
    out, V = transient(c, [], T, DT, V0=[0.0] * len(c.nodes), record=['Vm'])
    v = [d['Vm'] for t, d, _ in out if t > T - 0.7]
    return V, min(v), max(v)


def pulse(n, kw, V, I, fi=True, T=PULSE, after=0.2):
    """Ideal current pulse I (A) for T s from state V.  Returns t, Vm, AX lists."""
    c = circuit(n, kw, fi=fi)
    def on(k): k.fixed['IS'] = I * 1e9
    def off(k): k.fixed['IS'] = 0.0
    out, _ = transient(c, [(0.0, on), (T, off)], T + after, DT, V0=V, record=['Vm', 'AX'])
    t = [p[0] for p in out]
    return t, [p[1]['Vm'] for p in out], [p[1].get('AX', 0.0) for p in out]


def press(n, kw, V, T=PULSE, after=0.2):
    """The real Stimulator (pot 0.7k), SW held T s."""
    c = circuit(n, kw, src=False)
    ev = [(0.0, lambda k: k.set_sw(True)), (T, lambda k: k.set_sw(False))]
    out, _ = transient(c, ev, T + after, DT, V0=V, record=['Vm', 'AX'])
    return [p[0] for p in out], [p[1]['Vm'] for p in out], [p[1].get('AX', 0.0) for p in out]


def imin(n, kw, V, Vp):
    def fires(I):
        return max(pulse(n, kw, V, I)[1]) > max(pulse(n, kw, Vp, I, fi=False)[1]) + 0.5
    lo, hi = 0.0, 2e-6
    while not fires(hi):
        lo, hi = hi, hi * 2
        if hi > 1.1e-3:
            return None
    while hi - lo > 0.01 * hi:
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if fires(mid) else (mid, hi)
    return hi


def first_peak(t, v, base, thr=0.5):
    """Index of the first local maximum more than thr above base."""
    for i in range(1, len(v) - 1):
        if v[i] - base > thr and v[i] >= v[i - 1] and v[i] > v[i + 1]:
            return i
    return None


def measure(t, v, ip, base):
    """Amplitude, half-width, rise tau (start -> 63 %), decay tau (peak -> 37 %) of the
    excursion at ip (works for a negative excursion too)."""
    a = v[ip] - base
    f = lambda x: (x - base) / a
    lo = ip
    while lo > 0 and f(v[lo]) >= 0.5:
        lo -= 1
    hi = ip
    while hi < len(v) - 1 and f(v[hi]) >= 0.5:
        hi += 1
    r = next(i for i in range(ip + 1) if f(v[i]) >= 0.632)
    d = next((i for i in range(ip, len(v)) if f(v[i]) <= 0.368), None)
    return dict(peak=v[ip], amp=a, t_peak=t[ip] * 1e3, half=(t[hi] - t[lo]) * 1e3,
                rise=t[r] * 1e3, decay=(t[d] - t[ip]) * 1e3 if d else None)


def job(args):
    """Everything for one (state, n) that does not need I_min(4)."""
    si, n = args
    kw = STATES[si][1]
    V, lo, hi = settle(circuit(n, kw, src=False))
    res = dict(n=n, lo=lo, hi=hi)
    if hi - lo > 0.1:                      # fires by itself: nothing else is meaningful
        return si, res
    Vp = settle(circuit(n, kw, fi=False))[0]
    res['imin'] = imin(n, kw, V, Vp)
    t, v, x = press(n, kw, V)
    base, xbase = v[0], x[0]
    ip = first_peak(t, v, base)
    if ip is not None:
        res['ch1'] = measure(t, v, ip, base)
    if ip is not None and n:               # n = 0 has no extracellular resistor: CH2 is 0
        w = range(0, min(len(t), ip + int(0.05 / DT)))   # CH2: largest excursion up to 50 ms after the CH1 peak
        jx = max(w, key=lambda i: abs(x[i] - xbase))
        res['ch2'] = dict(measure(t, x, jx, xbase), base=xbase)
        imx, imn = max(w, key=lambda i: x[i]), min(w, key=lambda i: x[i])
        res['ch2_max'], res['ch2_min'] = x[imx] - xbase, x[imn] - xbase
        res['ch2_tmax'], res['ch2_tmin'] = (t[imx] - t[ip]) * 1e3, (t[imn] - t[ip]) * 1e3
    res['base'] = base
    res['V'] = V
    return si, res


def delay(args):
    si, n, I, V = args
    kw = STATES[si][1]
    t, v, x = pulse(n, kw, V, I)
    ip = first_peak(t, v, v[0])
    return si, n, (t[ip] * 1e3 if ip is not None else None), (v[ip] if ip is not None else None)


def report(si, rows, dl):
    print(STATES[si][0])
    for r in rows:
        n = r['n']
        if 'imin' not in r:
            print(f'   n={n}: SW released Vm {r["lo"]:.2f}-{r["hi"]:.2f} V, fires by itself')
            continue
        im = f'{r["imin"]*1e6:6.1f} uA' if r['imin'] else '  > 1 mA'
        d = dl.get(n)
        ds = (f'{d[0]:6.0f} ms (peak {d[1]:.2f} V)' if d and d[0] is not None else '  no AP') if d else '   -'
        s = f'   n={n}: rest {r["base"]:.2f} V | Q3 I_min {im} | Q4 delay {ds}'
        if 'ch1' in r:
            a, b = r['ch1'], r.get('ch2')
            dec = lambda m: f'{m["decay"]:.1f}' if m['decay'] else '-'
            s += (f'\n          pot 0.7k: CH1 peak {a["peak"]:.2f} V amp {a["amp"]:.2f} V at {a["t_peak"]:.1f} ms,'
                  f' half {a["half"]:.1f} ms, rise {a["rise"]:.1f} ms, decay {dec(a)} ms')
            if b:
                s += (f'\n                    CH2 base {b["base"]*1e3:.2f} mV, largest {b["amp"]*1e3:+.2f} mV at {b["t_peak"]:.1f} ms,'
                      f' half {b["half"]:.1f} ms, rise {b["rise"]:.1f} ms, decay {dec(b)} ms'
                      f'\n                    CH2 max {r["ch2_max"]*1e3:+.2f} mV at {r["ch2_tmax"]:+.1f} ms, min {r["ch2_min"]*1e3:+.2f} mV'
                      f' at {r["ch2_tmin"]:+.1f} ms (times from the CH1 peak)')
        else:
            s += '\n          pot 0.7k: no AP within 1 s'
        print(s, flush=True)


COMBOS = [('V+ wire', {}), ('no wire', dict(fi_vplus=False))]


def combo(args):
    """Original circuit, real Stimulator at pot 0.7k, SW held 1 s, then 0.5 s released."""
    ci, n = args
    kw = COMBOS[ci][1]
    c = circuit(n, kw, src=False)
    V, lo, hi = settle(c)
    t, v, _ = press(n, kw, V, after=0.5)
    held = [x for tt, x in zip(t, v) if tt <= PULSE]
    return ci, n, dict(rest=v[0], peak=max(held), t_peak=t[v.index(max(held))] * 1e3,
                       end=held[-1], after=v[-1])


def report_combos(res):
    print('original circuit, pot 0.7k, SW held 1 s (V): rest | max while held (at ms) | Vm at the end of'
          ' the press | 0.5 s after release')
    for ci, (lab, _) in enumerate(COMBOS):
        print(lab)
        for n in range(1, 5):
            r = res[ci, n]
            print(f'   n={n}: rest {r["rest"]:.2f} | max {r["peak"]:.2f} ({r["t_peak"]:.0f} ms) |'
                  f' end of press {r["end"]:.2f} | after {r["after"]:.2f}')


if __name__ == '__main__':
    if sys.argv[1:] == ['combos']:
        with Pool() as pool:
            out = pool.map(combo, [(ci, n) for ci in range(len(COMBOS)) for n in range(1, 5)])
        report_combos({(ci, n): r for ci, n, r in out})
        sys.exit()
    sel = [int(a) for a in sys.argv[1:]] or list(range(len(STATES)))
    with Pool() as pool:
        out = pool.map(job, [(si, n) for si in sel for n in NS])
        rows = {si: sorted([r for s, r in out if s == si], key=lambda r: r['n']) for si in sel}
        jobs = []
        for si in sel:
            r4 = rows[si][4]
            if r4.get('imin'):
                I = 1.05 * r4['imin']
                jobs += [(si, r['n'], I, r['V']) for r in rows[si] if 'imin' in r]
        dls = pool.map(delay, jobs)
    for si in sel:
        dl = {n: (d, p) for s, n, d, p in dls if s == si}
        r4 = rows[si][4]
        if r4.get('imin'):
            print(f'[Q4 uses 1.05 x I_min(4) = {1.05 * r4["imin"] * 1e6:.1f} uA]')
        report(si, rows[si], dl)
