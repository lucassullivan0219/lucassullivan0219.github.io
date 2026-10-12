"""A 'true AP' add-on set for #2-2 and #2-3, checked against the textbook definition.

Definition used (Barnett & Larkman 2007, Pract Neurol 7:192; Purves et al., Neuroscience,
ch. 2-3; Hodgkin & Huxley 1952), translated to this circuit:
  C1 threshold     below it only a local (passive) response; above it the full AP
  C2 all-or-none   regenerative upstroke: once over threshold the full AP always follows,
                   size nearly independent of stimulus strength, dV/dt far above passive
  C3 peak          large, but stops short of the inward current's reversal (here ~V+)
  C4 repolarization by the outward current, much faster than the passive membrane
  C5 AHP           after the AP Vm goes below rest and recovers slowly
  C6 refractory    a second stimulus soon after an AP fails or gives a smaller AP
  ('Overshoot past 0 mV' has no meaning here: Vm is measured against GND and rest is
   already positive, so the scale has an offset.)

The add-on set (all clipped on, removable; Slow out R2 = 1 Mohm):
  22k   ST.Q-ST.R (Qpass E-B)     no Stimulator leak, so rest does not depend on n
  11k   across R13                fast, large upstroke (FI up to ~0.6 mA)
  680k  R13 lower end -> FI.E3    FI threshold ~1.7 V, above the 1.2 V rest
  56k   across SO C1              Slow out off at rest (SO.S = 0.36 Vm = 0.43 V), but on early
                                  enough during the AP; 47k let FI and Slow out lock at ~2.9 V
                                  after a long press in 3 of 8 random parameter sets at n = 4
  330k  V+ -> Vm                  active-end rest 1.2 V, above the Slow out floor (~0.6 V)
  560k  V+ -> each passive unit   (#2-3) every compartment rests at 1.2 V too, so the chain
                                  carries no current at rest and does not drag the rest down
  #2-3 also needs the V+ wire to FI (the passive base PCB does not carry V+).

    python check_trueap.py            (all checks, uses all CPU cores, several minutes)
    python check_trueap.py mc         (random transistor parameters, n = 0 and n = 4)
    python check_trueap.py q23        (#2-3 Q3 I_min, Q4 delay, Q5 CH2)
"""
import os, sys, random
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, transient

DT = 2e-4
POT_MAX, POT_MIN = 0.0, 10e3          # with the 22k: ~72 uA and ~19 uA


def true_ap(n=0, r13p=11e3, rf=680e3, rb=330e3, ru=560e3, rs=56e3, rx=22e3):
    ex = [('ST.Q', 'ST.R', rx), ('FI.V+', 'FI.E3', rf), ('SO.S', 'SO.GND', rs), ('V+', 'Vm', rb)]
    if r13p:
        ex.append(('FI.V+', 'FI.E4', r13p))
    ex += [('V+', 'PC%d' % k, ru) for k in range(1, n + 1)]
    return dict(chain=n, r_so_r2=1e6, extra=ex)


def settle(kw, rpot=POT_MAX, T=1.5, **more):
    c = Circuit(rpot=rpot, **kw, **more)
    out, V = transient(c, [], T, DT, V0=[0.0] * len(c.nodes), record=['Vm'])
    v = [d['Vm'] for t, d, _ in out if t > T - 0.7]
    return V, min(v), max(v)


def press(kw, V, T, after=0.5, rpot=POT_MAX, second=None, **more):
    """SW for T s (and again for second=(start, length)); returns t, Vm."""
    c = Circuit(rpot=rpot, **kw, **more)
    ev = [(0.0, lambda k: k.set_sw(True)), (T, lambda k: k.set_sw(False))]
    end = T
    if second:
        s0, s1 = second
        ev += [(s0, lambda k: k.set_sw(True)), (s0 + s1, lambda k: k.set_sw(False))]
        end = s0 + s1
    out, _ = transient(c, ev, end + after, DT, V0=V, record=['Vm'])
    return [0.0] + [p[0] for p in out], [c.v(V, 'Vm')] + [p[1]['Vm'] for p in out]


def first_peak(t, v, base, start=0.0):
    for i in range(1, len(v) - 1):
        if t[i] >= start and v[i] - base > 0.5 and v[i] >= v[i - 1] and v[i] > v[i + 1]:
            return i
    return None


def fires(kw, V, Vp, T, rpot=POT_MAX):
    v = press(kw, V, T, after=0.3, rpot=rpot)[1]
    vp = press(kw, Vp, T, after=0.3, rpot=rpot, fi=False)[1]
    return max(v) > max(vp) + 0.5, max(v)


def threshold(kw, V, Vp, step=2e-3, tmax=0.6):
    lo, hi, vlo = 0.0, step, None
    while True:
        ok, vm = fires(kw, V, Vp, hi)
        if ok:
            break
        if hi >= tmax:
            return None, None
        lo, vlo, hi = hi, vm, hi + step
    while hi - lo > 0.5e-3:
        mid = (lo + hi) / 2
        ok, vm = fires(kw, V, Vp, mid)
        if ok:
            hi = mid
        else:
            lo, vlo = mid, vm
    return hi, vlo


def ap_shape(t, v, rest, T):
    """First AP after a T-second press: peak, max upstroke dV/dt, repolarization, AHP."""
    ip = first_peak(t, v, rest)
    if ip is None:
        return None
    pk = v[ip]
    up = max((v[i + 1] - v[i]) / DT for i in range(ip))
    lvl = rest + 0.5 * (pk - rest)
    a = ip
    while a > 0 and v[a] >= lvl:
        a -= 1
    b = ip
    while b < len(v) - 1 and v[b] >= lvl:
        b += 1
    im = min(range(ip, len(v)), key=lambda i: v[i])
    below = [t[i] for i in range(ip, len(v)) if v[i] < rest - 0.05]
    return dict(peak=pk, t_peak=t[ip], up=up, half=t[b] - t[a], vmin=v[im], ahp=rest - v[im],
                ahp_ms=(below[-1] - below[0]) * 1e3 if below else 0.0)


def check_scene(n):
    kw = true_ap(n)
    lines = ['#2-%s, n = %d' % ('2' if n == 0 else '3', n)]
    V, lo, hi = settle(kw)
    Vp = settle(kw, fi=False)[0]
    rest = hi
    lines.append('  rest (SW released): %.3f-%.3f V %s' % (lo, hi, '(quiet)' if hi - lo < 0.05 else '(FIRES BY ITSELF)'))
    T, vth = threshold(kw, V, Vp)
    if T is None:
        lines.append('  no press up to 0.6 s fires at full current')
        return '\n'.join(lines)
    lines.append('  C1 threshold: shortest press %.1f ms at full current; Vm reaches %.2f V without firing' % (T * 1e3, vth or rest))
    Ts = T + 5e-3
    t, v = press(kw, V, Ts)
    tp, vp = press(kw, Vp, Ts, fi=False)
    s = ap_shape(t, v, rest, Ts)
    up_p = max((vp[i + 1] - vp[i]) / DT for i in range(len(vp) - 1))
    peaks = []
    for TT in (Ts, 2 * Ts, 0.3):
        tt, vv = press(kw, V, TT, after=0.2)
        i = first_peak(tt, vv, rest)
        peaks.append(vv[i] if i is not None else None)
    lines.append('  C2 all-or-none: first-AP peak %s V for presses of %.0f / %.0f / 300 ms; FI unplugged %.2f V'
                 % (' / '.join('%.2f' % p if p else '-' for p in peaks), Ts * 1e3, 2 * Ts * 1e3, max(vp)))
    lines.append('     upstroke max dV/dt %.0f V/s vs passive %.0f V/s' % (s['up'], up_p))
    lines.append('  C3 peak %.2f V (rest %.2f V, V+ 7.8 V)' % (s['peak'], rest))
    lines.append('  C4 half-width %.1f ms' % (s['half'] * 1e3))
    lines.append('  C5 AHP: lowest %.2f V, %.2f V below rest for %.0f ms' % (s['vmin'], s['ahp'], s['ahp_ms']))
    rows = []
    for gap in (0.005, 0.01, 0.02, 0.04, 0.08, 0.16):
        s0 = s['t_peak'] + gap                      # second press starts this long after the first AP's peak
        tt, vv = press(kw, V, Ts, second=(s0, Ts), after=0.3)
        base2 = vv[min(range(len(tt)), key=lambda i: abs(tt[i] - s0))]
        i2 = first_peak(tt, vv, base2, start=s0)
        p2 = vv[i2] if i2 is not None and vv[i2] - base2 > 1.0 else None
        rows.append('%3.0f ms: %s' % (gap * 1e3, '%.2f V' % p2 if p2 else 'no AP'))
    lines.append('  C6 refractory (same press again, started this long after the first AP peak): ' + '; '.join(rows))
    return '\n'.join(lines)


def check_q3(_):
    """#2-2 Q3: five pot positions, SW held 1 s, first AP."""
    kw = true_ap(0)
    out = ['#2-2 Q3 (five stimulus currents, SW held 1 s, first AP):']
    for rp in (0.0, 2.5e3, 5e3, 7.5e3, 10e3):
        V, lo, hi = settle(kw, rpot=rp)
        t, v = press(kw, V, 1.0, after=0.3, rpot=rp)
        s = ap_shape(t, v, hi, 1.0)
        c = Circuit(rpot=rp, sw=True, fi=False, so=False, rleak=10e3, extra=[('ST.Q', 'ST.R', 22e3)])
        from sim import dc
        Vd, _ = dc(c)
        I = c.v(Vd, 'Vm') / 10e3
        out.append('  pot %4.1fk (%4.1f uA): peak %.2f V at %.1f ms, half-width %.1f ms' % (rp / 1e3, I * 1e6, s['peak'], s['t_peak'] * 1e3, s['half'] * 1e3) if s else '  pot %.1fk: no AP' % (rp / 1e3))
    return '\n'.join(out)


def check_q4(_):
    """#2-2 Q4: the FI resistor (R13, effective value) 10k ... 3M."""
    out = ['#2-2 Q4 (effective R13, SW held 1 s at full current):']
    for r in (10e3, 50e3, 100e3, 300e3, 820e3, 3e6):
        kw = true_ap(0, r13p=0)
        V, lo, hi = settle(kw, r13=r)
        t, v = press(kw, V, 1.0, after=0.3, r13=r)
        s = ap_shape(t, v, hi, 1.0)
        out.append('  R13 %6.0fk: %s' % (r / 1e3, ('peak %.2f V at %.1f ms, half-width %.1f ms, max dV/dt %.0f V/s' % (s['peak'], s['t_peak'] * 1e3, s['half'] * 1e3, s['up'])) if s else 'no AP (max %.2f V)' % max(v)))
    return '\n'.join(out)


def check_q6(_):
    kw = true_ap(0)
    out = ['#2-2 Q6:']
    for lab, more in (('TTX (FI unplugged)', dict(fi=False)), ('TEA (SO unplugged)', dict(so=False))):
        V, lo, hi = settle(kw, **more)
        t, v = press(kw, V, 0.05, after=0.6, **more)
        out.append('  %s: rest %.2f V, 50 ms press -> max %.2f V, 0.6 s after release %.2f V' % (lab, hi, max(v), v[-1]))
    return '\n'.join(out)


def ideal(kw, V, I, T=1.0, after=0.3, fi=True):
    """Ideal current pulse into PC1 (or Vm) with the Stimulator in place, SW released."""
    c = Circuit(rpot=POT_MAX, fi=fi, **kw)
    c.fixed['IS'] = 0.0
    c.R.append(['IS', 'PC1' if kw['chain'] else 'Vm', 1e9, 'src'])
    def on(k): k.fixed['IS'] = I * 1e9
    def off(k): k.fixed['IS'] = 0.0
    out, _ = transient(c, [(0.0, on), (T, off)], T + after, DT, V0=V, record=['Vm', 'AX'])
    return [p[0] for p in out], [p[1]['Vm'] for p in out], [p[1].get('AX', 0.0) for p in out]


def q23(n):
    """#2-3 Q3 I_min (1 s pulse, bisection to 1 %), plus the AX signal for n = 2."""
    kw = true_ap(n)
    V, lo, hi = settle(kw)
    Vp = settle(kw, fi=False)[0]
    def fire(I):
        return max(ideal(kw, V, I)[1]) > max(ideal(kw, Vp, I, fi=False)[1]) + 0.5
    a, b = 0.0, 4e-6
    while not fire(b):
        a, b = b, b * 2
    while b - a > 0.01 * b:
        m = (a + b) / 2
        a, b = (a, m) if fire(m) else (m, b)
    return n, b, V


def q23_delay(args):
    n, I, V = args
    t, v, x = ideal(true_ap(n), V, I)
    i = first_peak(t, v, v[0])
    return n, (t[i] if i is not None else None), (v[i] if i is not None else None)


def q23_ch2(_):
    kw = true_ap(2)
    V, lo, hi = settle(kw)
    c = Circuit(rpot=POT_MAX, **kw)
    out, _ = transient(c, [(0.0, lambda k: k.set_sw(True)), (1.0, lambda k: k.set_sw(False))], 1.3, DT, V0=V, record=['Vm', 'AX'])
    t = [p[0] for p in out]; v = [p[1]['Vm'] for p in out]; x = [p[1]['AX'] for p in out]
    i = first_peak(t, v, v[0])
    w = range(max(0, i - 100), min(len(t), i + 250))
    imx, imn = max(w, key=lambda j: x[j]), min(w, key=lambda j: x[j])
    return ('#2-3 Q5 (n = 2, full current, FI V+ wired from the Stimulator): CH1 peak %.2f V at %.0f ms; '
            'CH2 (AX) %+.1f mV at %+.1f ms and %+.1f mV at %+.1f ms from the CH1 peak'
            % (v[i], t[i] * 1e3, (x[imx] - x[0]) * 1e3, (t[imx] - t[i]) * 1e3, (x[imn] - x[0]) * 1e3, (t[imn] - t[i]) * 1e3))


def mc(args):
    n, seed = args
    random.seed(seed)
    m = {'3904': dict(Is=10 ** random.uniform(-14.7, -13.7), bf=random.uniform(100, 300)),
         '4403': dict(Is=10 ** random.uniform(-14.5, -13.5), bf=random.uniform(100, 250)),
         'D': dict(Is=10 ** random.uniform(-9.3, -8.3), n=random.uniform(1.65, 1.95))}
    kw = dict(true_ap(n), models=m)
    V, lo, hi = settle(kw)
    s = 'n=%d seed %d b3904=%3.0f b4403=%3.0f rest %.2f-%.2f' % (n, seed, m['3904']['bf'], m['4403']['bf'], lo, hi)
    if hi - lo > 0.05:
        return s + '  FIRES BY ITSELF'
    T = 0.03 if n == 0 else 0.3
    t, v = press(kw, V, T, after=0.5)
    a = ap_shape(t, v, hi, T)
    t2, v2 = press(kw, V, 1.0, after=0.3, rpot=POT_MIN)
    i2 = first_peak(t2, v2, hi)
    t3, v3 = press(kw, V, 1.0, after=1.0)
    back = v3[-1]
    return s + ('  | %.0f ms press: peak %.2f, AHP %.2f V for %.0f ms, back to %.2f' % (T * 1e3, a['peak'], a['ahp'], a['ahp_ms'], v[-1]) if a else '  | no AP at full current') + \
        ('  | pot 10k: %s' % ('AP' if i2 is not None else 'no AP')) +         ('  | 1 s full press, 1 s later: %.2f V %s' % (back, 'ok' if abs(back - hi) < 0.05 else 'STUCK'))


if __name__ == '__main__':
    with Pool() as pool:
        if sys.argv[1:2] == ['q23']:
            res = pool.map(q23, range(5))
            I4 = 1.05 * res[4][1]
            dl = pool.map(q23_delay, [(n, I4, V) for n, I, V in res])
            for (n, I, V), (_, td, pk) in zip(res, dl):
                print('#2-3 n=%d: I_min %.1f uA; delay at 1.05 x I_min(4) = %.1f uA: %s' % (n, I * 1e6, I4 * 1e6, '%.0f ms (peak %.2f V)' % (td * 1e3, pk) if td else 'no AP'), flush=True)
            print(pool.apply(q23_ch2, (None,)), flush=True)
        elif sys.argv[1:2] == ['mc']:
            for line in pool.map(mc, [(n, s) for n in (0, 4) for s in range(1, 9)]):
                print(line, flush=True)
        else:
            jobs = [pool.apply_async(check_scene, (n,)) for n in range(5)]
            extra = [pool.apply_async(f, (None,)) for f in (check_q3, check_q4, check_q6)]
            for j in jobs + extra:
                print(j.get(), flush=True)
