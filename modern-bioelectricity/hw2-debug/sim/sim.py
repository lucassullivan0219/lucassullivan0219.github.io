"""Small SPICE-style simulator for the HW2 #2-2 active membrane, wired as the PCBs are.

Method
  * Modified nodal analysis: unknowns are node voltages; GND and V+ are fixed.
  * Capacitors: backward Euler companion model (G = C/dt, current source).
  * Diodes and BJTs: Ebers-Moll transport model with analytic Jacobian.
  * Each time step is solved with damped Newton-Raphson
    (no node may move more than 0.1 V per iteration, so the exponentials stay tame).
  * Every node has 1e-12 S to ground (gmin) so floating nodes stay solvable.

Circuit (node names in capitals, matching the analysis page)
  Stimulator   SW: VP -> P          (switch closed = 0.05 ohm, open = 1e13 ohm)
               P -> Q: pot + R1 (rpot + 7 kohm)
               Q1 2N4403 Qpass : E=Q,  B=R, C=VM
               Q2 2N4403 Qsense: E=VP (PCB: before the switch!), B=Q, C=R
               R2 7 kohm: R -> GND
  Leak         1 uF || 100 kohm: VM -> GND
  Fast inward  contacts: VM--VMF, VP--VPF, GND--GF
               D1 1N4148: VMF -> B1;  R1 3 Mohm: B1 -> GF
               Q3 2N3904: B=B1, E=E3, C=X;  R2 100 kohm: E3 -> GF
               Q4 2N4403: E=E4, B=X, C=VMF;  R13 (PCB 100 kohm): VPF -> E4
  Slow out     contacts: VM--VMS, GND--GS
               R1 100 kohm: VMS -> S;  C1 1 uF: S -> GS
               D1 1N4148: S -> T;  R2 3 Mohm: T -> GS
               Q5 2N3904: B=T, E=GS, C=Y
               Q6 2N4403: E=VMS, B=Y, C=Z;  R3 1 kohm: Z -> GS
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
                 stim=True, leak=True, fi=True, so=True,
                 fi_vm=True, fi_vplus=True, fi_gnd=True, so_vm=True, so_gnd=True,
                 qsense_on_switched=False, rleak=100e3, probe='VM', rprobe=10e6,
                 models=None):
        m = {k: dict(v) for k, v in DEFAULT_MODELS.items()}
        for k, v in (models or {}).items():
            m[k].update(v)
        self.models = m
        self.fixed = {'GND': 0.0, 'VP': vplus}
        self.R, self.C, self.D, self.Q = [], [], [], []
        R, C, D, Q = self.R, self.C, self.D, self.Q
        link = lambda ok: SHORT if ok else OPEN
        if stim:
            R.append(['VP', 'P', link(sw), 'sw'])
            R.append(['P', 'Q', rpot + 7e3, 'rset'])
            Q.append(('pnp', 'VM', 'R', 'Q', '4403'))                                   # Qpass
            Q.append(('pnp', 'R', 'Q', 'P' if qsense_on_switched else 'VP', '4403'))    # Qsense
            R.append(['R', 'GND', 7e3, None])
        if leak:
            C.append(('VM', 'GND', 1e-6))
            R.append(['VM', 'GND', rleak, None])
        if fi:
            R.append(['VMF', 'VM', link(fi_vm), 'fi_vm'])
            R.append(['VPF', 'VP', link(fi_vplus), 'fi_vplus'])
            R.append(['GF', 'GND', link(fi_gnd), 'fi_gnd'])
            D.append(('VMF', 'B1'))
            R.append(['B1', 'GF', 3e6, None])
            Q.append(('npn', 'X', 'B1', 'E3', '3904'))
            R.append(['E3', 'GF', r_fi_e, None])
            Q.append(('pnp', 'VMF', 'X', 'E4', '4403'))
            R.append(['E4', 'VPF', r13, None])
        if so:
            R.append(['VMS', 'VM', link(so_vm), 'so_vm'])
            R.append(['GS', 'GND', link(so_gnd), 'so_gnd'])
            R.append(['VMS', 'S', 100e3, None])
            C.append(('S', 'GS', 1e-6))
            D.append(('S', 'T'))
            R.append(['T', 'GS', 3e6, None])
            Q.append(('npn', 'Y', 'T', 'GS', '3904'))
            Q.append(('pnp', 'Z', 'Y', 'VMS', '4403'))
            R.append(['Z', 'GS', 1e3, None])
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
    def solve(self, V0, Vprev=None, dt=None, maxit=300):
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
                stamp_g(n, 'GND', GMIN)
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
    """DC operating point (capacitors open). guess picks the branch of a bistable circuit."""
    V = [0.0] * len(ckt.nodes)
    for n, val in (guess or {}).items():
        if n in ckt.idx:
            V[ckt.idx[n]] = val
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
