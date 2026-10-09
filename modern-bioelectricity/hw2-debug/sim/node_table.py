"""Expected voltage at every node (../nodes.html) in five reference states.

  A  everything connected, SW released.  The model fires small spontaneous
     bumps here, so A is given as the range (min-max) over 1 s.
  B  everything connected, SW held 0.3 s, pot 0 (max current)
  C  ST + LK + FI (no Slow out), FI latched, SW released      -> test 10d
  D  ST + LK + SO (no Fast inward), SW held 0.3 s, pot 0
  E  ST + LK + FI with the FI:Vm contact open, FI latched,
     probe on FI.Vm                                           -> tests 4-5

    python node_table.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, dc, transient, press, rest

NODES = ['V+', 'ST.P', 'ST.K', 'ST.Q', 'ST.R', 'Vm', 'LK.Vm',
         'FI.Vm', 'FI.B3', 'FI.E3', 'FI.B4', 'FI.E4', 'FI.V+', 'FI.GND',
         'SO.Vm', 'SO.S', 'SO.B3', 'SO.B4', 'SO.C4', 'SO.GND']
LATCH = {'Vm': 3, 'FI.Vm': 3, 'FI.E4': 3, 'FI.B4': 2.5, 'FI.B3': 2.7, 'FI.E3': 2.2}


def held(**kw):
    c = Circuit(rpot=0.0, **kw)
    _, V = transient(c, press(0.0, 1.0), 0.3, 2e-4, V0=rest(c), record=[])
    return c, V


def fmt(c, V, n):
    return f'{c.v(V, n):8.2f}' if (n in c.idx or n in c.fixed) else f'{"-":>8s}'


# A: free-running range
cA = Circuit()
out, _ = transient(cA, [], 1.0, 2e-4, V0=rest(cA), record=NODES)
rangeA = {n: (min(d[n] for _, d, _ in out), max(d[n] for _, d, _ in out)) for n in NODES}

states = {'B': held()}
c = Circuit(so=False); V, _ = dc(c, LATCH); states['C'] = (c, V)
states['D'] = held(fi=False)
c = Circuit(so=False, fi_vm=False, probe='FI.Vm')
V, _ = dc(c, {'FI.Vm': 4, 'FI.E4': 4, 'FI.B4': 3.5, 'FI.B3': 3.7, 'FI.E3': 3.0})
states['E'] = (c, V)

print(f'{"node":8s}{"A min":>8s}{"A max":>8s}' + ''.join(f'{k:>8s}' for k in states))
for n in NODES:
    lo, hi = rangeA[n]
    print(f'{n:8s}{lo:8.2f}{hi:8.2f}' + ''.join(fmt(c, V, n) for c, V in states.values()))
print('V.  ST.P and ST.K float when SW is released (no current in the pot), so they read about ST.Q.')
