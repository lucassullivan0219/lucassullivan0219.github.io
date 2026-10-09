"""Small SPICE-style simulator for the HW2 #2-2 active membrane, wired as the PCBs are.

Method
  * Modified nodal analysis: unknowns are node voltages; GND and V+ are fixed.
  * Capacitors: backward Euler companion model (G = C/dt, current source).
  * Diodes and BJTs: Ebers-Moll transport model with analytic Jacobian.
  * Each time step is solved with damped Newton-Raphson
    (no node may move more than 0.1 V per iteration, so the exponentials stay tame).
  * Every node has 1e-12 S to ground (gmin) so floating nodes stay solvable.

Circuit.  Node names follow the node dictionary (../nodes.html):
board code + node, ST = Stimulator, LK = Leak, FI = Fast inward, SO = Slow out;
B3/E3 = 2N3904 base/emitter node, B4/E4/C4 = 2N4403 base/emitter/collector node.
'V+' and 'GND' are the battery terminals on the Stimulator (ST.V+, ST.GND);
'Vm' is the Stimulator's output (ST.Vm), the point CH1 normally probes.

  Stimulator   SW: V+ -> ST.P       (switch closed = 0.05 ohm, open = 1e13 ohm)
               pot: ST.P -> ST.K;  7K-R1: ST.K -> ST.Q
               Q1 2N4403 Qpass : E=ST.Q, B=ST.R, C=Vm
               Q2 2N4403 Qsense: E=V+ (PCB: before the switch!), B=ST.Q, C=ST.R
               7K-R2: ST.R -> GND
  Leak         contact Vm--LK.Vm;  1 uF || 100 kohm: LK.Vm -> GND
  Fast inward  contacts Vm--FI.Vm, V+--FI.V+, GND--FI.GND
               D1 1N4148: FI.Vm -> FI.B3;  3M-R1: FI.B3 -> FI.GND
               2N3904: B=FI.B3, E=FI.E3, C=FI.B4;  100K-R2: FI.E3 -> FI.GND
               2N4403: E=FI.E4, B=FI.B4, C=FI.Vm;  R13 (PCB 100 kohm): FI.V+ -> FI.E4
  Slow out     contacts Vm--SO.Vm, GND--SO.GND
               100K-R1: SO.Vm -> SO.S;  C1 1 uF: SO.S -> SO.GND
               D1 1N4148: SO.S -> SO.B3;  3M-R2: SO.B3 -> SO.GND   (r_so_r2: PCB label 3 Mohm,
                                                    TA spec 1 Mohm, kit shipped 100 ohm)
               2N3904: B=SO.B3, E=SO.GND, C=SO.B4
               2N4403: E=SO.Vm, B=SO.B4, C=SO.C4;  1K-R3: SO.C4 -> SO.GND
  Scope probe  10 Mohm from the probed node to GND (x10 probe)

Only the Python standard library is used.
"""
import math

VT = 0.02585          # thermal voltage at about 27 C
EXPLIM = 40.0         # exp() is continued linearly above this argument
GMIN = 1e-12
SHORT, OPEN = 0.05, 1e13

# Typical small-signal parameters.  run monte_carlo.py to see how much the
# results move when these change.
DEFAULT_MODELS = {
    '3904': dict(Is=6.7e-15, bf=200.0, br=0.74),
    '4403': dict(Is=1.0e-14, bf=150.0, br=4.0),
    'D':    dict(Is=2.52e-9, n=1.752),            # 1N4148
}


def _exp(x):
    """exp(x) and its derivative, continued linearly above EXPLIM."""
    if x > EXPLIM:
        e = math.exp(EXPLIM)
        return e * (1.0 + x - EXPLIM), e
    e = math.exp(x)
    return e, e


def bjt(kind, vc, vb, ve, Is, bf, br):
    """Currents INTO the (C, B, E) terminals and their partial derivatives.

    Returns (i, d) where i = [ic, ib, ie] and d[k] = [di_k/dvc, di_k/dvb, di_k/dve].
    """
    if kind == 'npn':
        ef, def_ = _exp((vb - ve) / VT)
        er, der = _exp((vb - vc) / VT)
        If, gf = Is * (ef - 1.0), Is * def_ / VT
        Ir, gr = Is * (er - 1.0), Is * der / VT
        k = 1.0 + 1.0 / br
        ic = If - Ir * k
        ib = If / bf + Ir / br
        dic = [gr * k, gf - gr * k, -gf]
        dib = [-gr / br, gf / bf + gr / br, -gf / bf]
    else:  # pnp
        ef, def_ = _exp((ve - vb) / VT)
        er, der = _exp((vc - vb) / VT)
        If, gf = Is * (ef - 1.0), Is * def_ / VT
        Ir, gr = Is * (er - 1.0), Is * der / VT
        k = 1.0 + 1.0 / br
        out_c = If - Ir * k                   # current out of the collector
        out_b = If / bf + Ir / br             # current out of the base
        d_out_c = [-gr * k, -gf + gr * k, gf]
        d_out_b = [gr / br, -gf / bf - gr / br, gf / bf]
        ic, ib = -out_c, -out_b
        dic = [-x for x in d_out_c]
        dib = [-x for x in d_out_b]
    ie = -ic - ib
    die = [-(a + b) for a, b in zip(dic, dib)]
    return [ic, ib, ie], [dic, dib, die]


def diode(va, vk, Is, n):
    e, de = _exp((va - vk) / (n * VT))
    return Is * (e - 1.0), Is * de / (n * VT)


class Circuit:
    def __init__(self, vplus=7.8, sw=False, rpot=5e3, r13=100e3, r_fi_e=100e3,
                 stim=True, leak=True, fi=True, so=True, lk_vm=True,
                 fi_vm=True, fi_vplus=True, fi_gnd=True, so_vm=True, so_gnd=True,
                 qsense_on_switched=False, rleak=100e3, probe='Vm', rprobe=10e6,
                 r_so_r2=3e6, r_so_r3=1e3, models=None):
        m = {k: dict(v) for k, v in DEFAULT_MODELS.items()}
        for k, v in (models or {}).items():
            m[k].update(v)
        self.models = m
        self.fixed = {'GND': 0.0, 'V+': vplus}
        self.R, self.C, self.D, self.Q = [], [], [], []
        R, C, D, Q = self.R, self.C, self.D, self.Q
        link = lambda ok: SHORT if ok else OPEN
        if stim:
            R.append(['V+', 'ST.P', link(sw), 'sw'])
            R.append(['ST.P', 'ST.K', max(rpot, 1.0), 'pot'])   # a real pot never reaches 0 ohm
            R.append(['ST.K', 'ST.Q', 7e3, None])
            Q.append(('pnp', 'Vm', 'ST.R', 'ST.Q', '4403'))                                     # Qpass
            Q.append(('pnp', 'ST.R', 'ST.Q', 'ST.P' if qsense_on_switched else 'V+', '4403'))   # Qsense
            R.append(['ST.R', 'GND', 7e3, None])
        if leak:
            R.append(['LK.Vm', 'Vm', link(lk_vm), 'lk_vm'])
            C.append(('LK.Vm', 'GND', 1e-6))
            R.append(['LK.Vm', 'GND', rleak, None])
        if fi:
            R.append(['FI.Vm', 'Vm', link(fi_vm), 'fi_vm'])
            R.append(['FI.V+', 'V+', link(fi_vplus), 'fi_vplus'])
            R.append(['FI.GND', 'GND', link(fi_gnd), 'fi_gnd'])
            D.append(('FI.Vm', 'FI.B3'))
            R.append(['FI.B3', 'FI.GND', 3e6, None])
            Q.append(('npn', 'FI.B4', 'FI.B3', 'FI.E3', '3904'))
            R.append(['FI.E3', 'FI.GND', r_fi_e, None])
            Q.append(('pnp', 'FI.Vm', 'FI.B4', 'FI.E4', '4403'))
            R.append(['FI.E4', 'FI.V+', r13, None])
        if so:
            R.append(['SO.Vm', 'Vm', link(so_vm), 'so_vm'])
            R.append(['SO.GND', 'GND', link(so_gnd), 'so_gnd'])
            R.append(['SO.Vm', 'SO.S', 100e3, None])
            C.append(('SO.S', 'SO.GND', 1e-6))
            D.append(('SO.S', 'SO.B3'))
            R.append(['SO.B3', 'SO.GND', r_so_r2, None])     # 3M-R2; 1 ohm models SO.B3 shorted to GND
            Q.append(('npn', 'SO.B4', 'SO.B3', 'SO.GND', '3904'))
            Q.append(('pnp', 'SO.C4', 'SO.B4', 'SO.Vm', '4403'))
            R.append(['SO.C4', 'SO.GND', r_so_r3, None])     # 1K-R3
        if probe:
            R.append([probe, 'GND', rprobe, None])
        nodes = []
        for el in R + C + D:
            for n in el[:2]:
                if n not in self.fixed and n not in nodes:
                    nodes.append(n)
        for q in Q:
            for n in q[1:4]:
                if n not in self.fixed and n not in nodes:
                    nodes.append(n)
        self.nodes = nodes
        self.idx = {n: i for i, n in enumerate(nodes)}

    # ---- switches -------------------------------------------------------
    def set(self, tag, closed):
        for r in self.R:
            if r[3] == tag:
                r[2] = SHORT if closed else OPEN

    def set_sw(self, on):
        self.set('sw', on)

    def v(self, V, n):
        return self.fixed[n] if n in self.fixed else V[self.idx[n]]

    # ---- one Newton solve (DC if dt is None) ----------------------------
    def solve(self, V0, Vprev=None, dt=None, maxit=300, gmin=GMIN):
        N = len(self.nodes)
        idx = self.idx
        V = list(V0)
        for _ in range(maxit):
            F = [0.0] * N
            J = [[0.0] * N for _ in range(N)]

            def stamp_g(a, b, g, ieq=0.0):
                ia, ib = idx.get(a), idx.get(b)
                cur = g * (self.v(V, a) - self.v(V, b)) + ieq
                if ia is not None:
                    F[ia] += cur
                    J[ia][ia] += g
                    if ib is not None:
                        J[ia][ib] -= g
                if ib is not None:
                    F[ib] -= cur
                    J[ib][ib] += g
                    if ia is not None:
                        J[ib][ia] -= g

            for a, b, r, _t in self.R:
                stamp_g(a, b, 1.0 / r)
            for n in self.nodes:
                stamp_g(n, 'GND', gmin)
            if dt is not None:
                for a, b, c in self.C:
                    g = c / dt
                    stamp_g(a, b, g, -g * (self.v(Vprev, a) - self.v(Vprev, b)))
            pd = self.models['D']
            for a, k in self.D:
                i, g = diode(self.v(V, a), self.v(V, k), pd['Is'], pd['n'])
                ia, ik = idx.get(a), idx.get(k)
                if ia is not None:
                    F[ia] += i
                    J[ia][ia] += g
                    if ik is not None:
                        J[ia][ik] -= g
                if ik is not None:
                    F[ik] -= i
                    J[ik][ik] += g
                    if ia is not None:
                        J[ik][ia] -= g
            for kind, c, b, e, model in self.Q:
                terms = (c, b, e)
                cur, d = bjt(kind, self.v(V, c), self.v(V, b), self.v(V, e), **self.models[model])
                for t, n in enumerate(terms):
                    i = idx.get(n)
                    if i is None:
                        continue
                    F[i] += cur[t]                  # current leaving the node into the device
                    for s, ns in enumerate(terms):
                        j = idx.get(ns)
                        if j is not None:
                            J[i][j] += d[t][s]
            dx = _gauss(J, [-f for f in F])
            mx = max(abs(x) for x in dx)
            sc = 1.0 if mx <= 0.1 else 0.1 / mx
            V = [V[i] + sc * dx[i] for i in range(N)]
            if mx < 1e-7:
                return V, True
        return V, False


def _gauss(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        pv = M[c][c]
        for r in range(c + 1, n):
            f = M[r][c] / pv
            if f:
                Mr, Mc = M[r], M[c]
                for k in range(c, n + 1):
                    Mr[k] -= f * Mc[k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (M[r][n] - sum(M[r][k] * x[k] for k in range(r + 1, n))) / M[r][r]
    return x


def dc(ckt, guess=None):
    """DC operating point (capacitors open). guess picks the branch of a bistable circuit.

    Plain Newton first.  If it stalls (FI.B4 is almost floating while the Fast inward
    is off), fall back to gmin stepping: solve with a conductance g on every node,
    then shrink g tenfold at a time down to GMIN, each solve starting from the last.
    """
    V = [0.0] * len(ckt.nodes)
    for n, val in (guess or {}).items():
        if n in ckt.idx:
            V[ckt.idx[n]] = val
    Vn, ok = ckt.solve(V, maxit=3000)
    if ok:
        return Vn, ok
    g = 1e-9 if guess else 1e-4      # start gentler when following a latched branch
    while g > GMIN * 1.01:
        V, ok = ckt.solve(V, maxit=3000, gmin=g)
        g /= 10
    return ckt.solve(V, maxit=3000)


def transient(ckt, events, tstop, dt, V0=None, record=('VM',)):
    """Backward-Euler transient.  events = [(t, fn(ckt)), ...]."""
    V = V0 if V0 is not None else dc(ckt)[0]
    ev = sorted(events, key=lambda e: e[0])
    out, t, k = [], 0.0, 0
    while t < tstop - 1e-12:
        while k < len(ev) and ev[k][0] <= t + 1e-12:
            ev[k][1](ckt)
            k += 1
        Vn, ok = ckt.solve(V, Vprev=V, dt=dt)
        if not ok:                       # fall back to 10 sub-steps
            Vn = V
            for _ in range(10):
                Vn, ok = ckt.solve(Vn, Vprev=Vn, dt=dt / 10, maxit=2000)
        V = Vn
        t += dt
        out.append((t, {n: ckt.v(V, n) for n in record if n in ckt.idx or n in ckt.fixed}, ok))
    return out, V


def press(t_on, t_off):
    """Events for pressing SW at t_on and releasing it at t_off."""
    return [(t_on, lambda c: c.set_sw(True)), (t_off, lambda c: c.set_sw(False))]


def rest(ckt, dt=2e-4, settle=1.0, wait=0.6):
    """Starting state for "press SW from rest", the way it happens on the bench.

    Power on with every capacitor at 0 V, wait `settle` seconds with SW released,
    then keep going until Vm reaches a local minimum (at most `wait` s more).
    Depending on the transistor parameters the circuit then either sits still near
    0.4-0.7 V or fires small spontaneous bumps about every 0.2 s (it does so with
    the default parameters); starting in the quiet trough makes both comparable.
    """
    V = [0.0] * len(ckt.nodes)
    _, V = transient(ckt, [], settle, dt, V0=V, record=[])
    prev, falling, t = ckt.v(V, 'Vm'), False, 0.0
    while t < wait:
        _, Vn = transient(ckt, [], dt, dt, V0=V, record=[])
        vm = ckt.v(Vn, 'Vm')
        if falling and vm > prev:
            return V                     # V is the local minimum
        falling = vm < prev - 1e-7
        prev, V, t = vm, Vn, t + dt
    return V
