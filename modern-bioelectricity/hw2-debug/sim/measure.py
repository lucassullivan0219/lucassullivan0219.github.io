"""Shared measurement helpers for variants.py and sweep_q4.py.

Why SW is pressed 1 ms after t = 0: on the PCB as built the resting point sits
right at threshold, and with typical parameters the model fires small spontaneous
bumps every ~0.5 s.  Starting every run from the DC resting point and pressing
SW at once measures the response to SW instead of whatever spontaneous bump
happens to be in progress.  spontaneous() checks the no-press behaviour separately.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, dc, transient, press

DT = 2e-4


def evoked(t_press=0.35, window=0.15, **kw):
    """Press SW at 1 ms for t_press seconds. Returns a dict of AP measures."""
    c = Circuit(**kw)
    V, _ = dc(c)
    base = c.v(V, 'VM')
    t_on = 1e-3
    out, _ = transient(c, press(t_on, t_on + t_press), t_on + t_press + 0.25, DT, V0=V, record=['VM'])
    t = [p[0] for p in out]
    v = [p[1]['VM'] for p in out]
    w = [i for i, ti in enumerate(t) if t_on <= ti <= t_on + window]
    ip = max(w, key=lambda i: v[i])
    half = base + (v[ip] - base) / 2
    a = ip
    while a > 0 and v[a] >= half:
        a -= 1
    b = ip
    while b < len(v) - 1 and v[b] >= half:
        b += 1
    held = min(range(len(t)), key=lambda i: abs(t[i] - (t_on + t_press - 0.01)))
    return dict(base=base, peak=v[ip], amp=v[ip] - base, t_peak=(t[ip] - t_on) * 1e3,
                half_width=(t[b] - t[a]) * 1e3, held=v[held], end=v[-1])


def spontaneous(tstop=1.5, **kw):
    """No SW press. Returns (number of bumps > 0.3 V above rest, max Vm)."""
    c = Circuit(**kw)
    V, _ = dc(c)
    base = c.v(V, 'VM')
    out, _ = transient(c, [], tstop, DT, V0=V, record=['VM'])
    v = [p[1]['VM'] for p in out]
    n, armed = 0, True
    for x in v:
        if armed and x > base + 0.3:
            n, armed = n + 1, False
        elif not armed and x < base + 0.1:
            armed = True
    return n, max(v)
