"""Export a trained flyvis network (Lappalainen et al. 2024) into a compact JSON for the browser.

Each (source type, target type) pair connects through the same spatial filter at every
column (ConnectomeFromAvgFilters), so the network is: per-type bias and time constant, plus a
list of (source, target, du, dv, weight) filters. The browser rebuilds the full 45,669-neuron,
~1.5M-synapse network on the 721-column hex eye from that.
"""
import json, sys, numpy as np, torch, flyvis
from flyvis import NetworkView

model = sys.argv[1] if len(sys.argv) > 1 else '000'
net = NetworkView(flyvis.results_dir / f'flow/0000/{model}').init_network(); net.eval()
c = net.connectome
types = list(np.array(c.unique_cell_types[:]).astype(str))
params = net._param_api()
net.dynamics.write_derived_params(params) if hasattr(net.dynamics, 'write_derived_params') else None
nt = np.array(c.nodes.type[:]).astype(str)
bias = params.nodes.bias.detach().numpy().ravel(); tau = params.nodes.time_const.detach().numpy().ravel()
w = params.edges.weight.detach().numpy().ravel()
e = c.edges
st = np.array(e.source_type[:]).astype(str); tt = np.array(e.target_type[:]).astype(str)
du = np.array(e.du[:]); dv = np.array(e.dv[:])
su, sv, tu, tv = np.array(e.source_u[:]), np.array(e.source_v[:]), np.array(e.target_u[:]), np.array(e.target_v[:])
assert np.all(su - tu == du) or np.all(tu - su == du)
conv = 'source_minus_target' if np.all(su - tu == du) else 'target_minus_source'
ptype = {}
for t in types:
    m = nt == t
    ptype[t] = dict(bias=float(np.median(bias[m])), tau=float(np.median(tau[m])), bias_sd=float(bias[m].std()))
import pandas as pd
df = pd.DataFrame(dict(st=st, tt=tt, du=du, dv=dv, w=w))
g = df.groupby(['st', 'tt', 'du', 'dv']).w.agg(['mean', 'std', 'count']).reset_index()
print('unique filters', len(g), 'max within-group sd', float(g['std'].fillna(0).max()), 'convention', conv)
ti = {t: i for i, t in enumerate(types)}
filters = [[ti[a], ti[b], int(x), int(y), round(float(m), 6)] for a, b, x, y, m in g[['st', 'tt', 'du', 'dv', 'mean']].values if abs(m) > 1e-7]
from flyvis.utils.hex_utils import get_hex_coords
u, v = get_hex_coords(15)
colpos = {(a, b): i for i, (a, b) in enumerate(zip(u, v))}
nu, nv = np.array(c.nodes.u[:]), np.array(c.nodes.v[:])
sparse = {t: sorted(colpos[(a, b)] for a, b in zip(nu[nt == t], nv[nt == t])) for t in types if (nt == t).sum() != len(u)}
out = dict(model=model, types=types, sparse_types=sparse, bias=[ptype[t]['bias'] for t in types], tau=[ptype[t]['tau'] for t in types],
           input_types=[t.decode() if isinstance(t, bytes) else str(t) for t in c.input_cell_types[:]],
           columns=[[int(a), int(b)] for a, b in zip(u, v)], offset_convention=conv, filters=filters, dt=0.02)
json.dump(out, open('/home/claude/flyharp/data/fly.json', 'w'), separators=(',', ':'))
# reference trace for validating the JS port: grey 1 s then a drifting grating, central cells
sys.path.insert(0, '/home/claude/thefly/analysis')
from stimuli import grating_movie
mov, _ = grating_movie(1.0, 0.0, 0, r_center=20, r_gap=99, dt=0.02, t_pre=0.5, t_stim=1.0)
x = torch.tensor(mov[None])
with torch.no_grad():
    s = net.fade_in_state(1.0, 0.02, x[:, 0]); r = net.simulate(x, 0.02, initial_state=s).numpy()[0]
cen = dict(zip(types, c.central_cells_index[:]))
ref = dict(stim=np.round(mov[:, 0, :], 5).tolist(), central={t: np.round(r[:, cen[t]], 5).tolist() for t in types},
           init_central={t: float(s.nodes.activity[0, cen[t]]) for t in types})
json.dump(ref, open('/home/claude/flyharp/tools/reference_trace.json', 'w'))
print('bias/tau check', {t: (round(ptype[t]['bias'], 3), round(ptype[t]['tau'], 3), round(ptype[t]['bias_sd'], 4)) for t in types[:6]})
