"""DC operating points compared with the bench measurements (tests 4, 5, 10a, 10b, 10d).

    python check_dc.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim import Circuit, dc


def row(title, c, V, names):
    print(f'{title}\n    ' + '  '.join(f'{n}={c.v(V, n):6.3f}' for n in names))


print('== Stimulator (V+ = 7.8 V) ==')
for rp in (10e6, 1e6):
    c = Circuit(leak=False, fi=False, so=False, rprobe=rp)
    V, ok = dc(c)
    row(f'10a  Stimulator only, SW open, probe {rp/1e6:.0f} Mohm', c, V, ['VM', 'Q', 'R'])
c = Circuit(fi=False, so=False)
V, ok = dc(c)
row('10b  Stimulator + Leak, SW open', c, V, ['VM', 'Q', 'R'])
for rpot in (0.0, 5e3, 10e3):
    c = Circuit(sw=True, rpot=rpot, fi=False, so=False)
    V, ok = dc(c)
    vm = c.v(V, 'VM')
    print(f'10b  Stimulator + Leak, SW held, pot={rpot/1e3:4.1f} k:  VM={vm:5.2f} V  '
          f'I_out={(vm/100e3 + vm/10e6)*1e6:5.1f} uA   0.65/(pot+7k)={0.65/(rpot+7e3)*1e6:5.1f} uA')
print('     SW-open leak current vs beta of Qsense (with the 100 kohm leak):')
for bf in (100, 150, 250):
    c = Circuit(fi=False, so=False, models={'4403': {'bf': bf}})
    V, ok = dc(c)
    vm = c.v(V, 'VM')
    print(f'       beta={bf:3d}: VM={vm:.3f} V -> I_off={vm/100e3*1e6:4.1f} uA   '
          f'hand formula (V+ - 2*0.6)/(7k*beta)={(7.8-1.2)/(7e3*bf)*1e6:4.1f} uA')

print('\n== Fast inward on its own, Vm pin disconnected, probe on its Vm pin (tests 4-5) ==')
on = dict(VMF=4.0, E4=4.0, X=3.5, B1=3.7, E3=3.0)
names = ['VMF', 'E4', 'X', 'B1', 'E3']
print('    (VMF = 4403 C = Vm pin, E4 = 4403 E, X = 4403 B = 3904 C, B1 = 3904 B, E3 = 3904 E)')
print('    measured:  VMF= 4.0  E4= 4.0  X= 3.5  B1= 3.7  E3= 3.0')
for r13 in (100e3, 1e3):
    c = Circuit(fi_vm=False, so=False, probe='VMF', r13=r13)
    V, ok = dc(c, on)
    row(f'    R13={r13/1e3:5.0f} k, latched (ON) branch', c, V, names)
    V, ok = dc(c)
    row(f'    R13={r13/1e3:5.0f} k, OFF branch', c, V, names)

print('\n== Stimulator(SW open) + Leak + Fast inward, latched (test 10d) ==')
c = Circuit(so=False)
V, ok = dc(c, dict(VM=3, VMF=3, E4=3, X=2.5, B1=2.7, E3=2.2))
row('    latched', c, V, ['VM', 'E4', 'X', 'B1', 'E3'])
for rc in (30e3, 100e3):
    c = Circuit(so=False)
    for r in c.R:
        if r[3] == 'fi_vplus':
            r[2] = rc
    V, ok = dc(c, dict(VM=3, VMF=3, E4=3, X=2.5, B1=2.7, E3=2.2))
    row(f'    latched, V+ through a {rc/1e3:.0f} k bad contact', c, V, ['VM', 'VPF'])
