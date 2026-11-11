"""The Tonnectome: export the fly's early auditory network from FlyWire (v783) for the browser.

Membership (both hemispheres):
  tier 0  Johnston's organ neurons (cell_type JO-*), 1,104 cells: the ear
  tier 1  neurons receiving >= 10 synapses from JO neurons (AMMC, SAD, GNG, WED ...)
  tier 2  neurons getting >= 20% of their input (and >= 20 synapses) from tiers 0-1
  tier 3  neurons getting >= 25% of their input (and >= 20 synapses) from tiers 0-2
Other sensory neurons are left out (nothing drives them here).

Weights: w_ij = sign(j) * synapses(j -> i) / total input synapses onto i (whole brain), so input from outside
the network counts as silence. sign: acetylcholine +1, GABA and glutamate -1, monoamines +0.3 (weak).

Output: data/ear.json (neurons) and data/ear.bin (Int32 rowptr[N+1] | Uint16 pre[E] | Uint16 syn[E], CSR by target).

    python tools/ear_export.py /path/to/flywire data/
"""
import sys, json, re
import numpy as np, pandas as pd, pyarrow.feather as pf

D, OUT = sys.argv[1].rstrip('/') + '/', sys.argv[2].rstrip('/') + '/'
ann = pd.read_csv(D + 'neuron_annotations.tsv', sep='\t', dtype=str,
                  usecols=['root_id', 'pos_x', 'pos_y', 'pos_z', 'super_class', 'cell_class', 'cell_sub_class', 'cell_type', 'top_nt', 'side', 'synonyms'])
ann['root_id'] = ann.root_id.astype(np.int64)
A = ann.set_index('root_id')
t = pf.read_table(D + 'proofread_connections_783.feather', columns=['pre_pt_root_id', 'post_pt_root_id', 'neuropil', 'syn_count']).to_pandas()
e = t.groupby(['pre_pt_root_id', 'post_pt_root_id'], as_index=False).syn_count.sum()
intot = e.groupby('post_pt_root_id').syn_count.sum()
sensory = set(ann[ann.super_class == 'sensory'].root_id)

jo = set(ann[ann.cell_type.fillna('').str.startswith('JO')].root_id)
fromjo = e[e.pre_pt_root_id.isin(jo) & ~e.post_pt_root_id.isin(jo)].groupby('post_pt_root_id').syn_count.sum()
t1 = set(fromjo[fromjo >= 10].index) - sensory
def next_tier(S, frac_min):
    f = e[e.pre_pt_root_id.isin(S) & ~e.post_pt_root_id.isin(S)].groupby('post_pt_root_id').syn_count.sum()
    frac = f / intot.reindex(f.index)
    return set(f[(frac >= frac_min) & (f >= 20)].index) - sensory
t2 = next_tier(jo | t1, 0.20)
t3 = next_tier(jo | t1 | t2, 0.25)
tiers = [sorted(jo), sorted(t1), sorted(t2), sorted(t3)]
ids = [r for T in tiers for r in T]
idx = {r: i for i, r in enumerate(ids)}
N = len(ids)

ee = e[e.pre_pt_root_id.isin(idx) & e.post_pt_root_id.isin(idx)].copy()
ee['pre'] = ee.pre_pt_root_id.map(idx); ee['post'] = ee.post_pt_root_id.map(idx)
ee = ee.sort_values(['post', 'pre'])
rowptr = np.zeros(N + 1, np.int32); np.add.at(rowptr, ee.post.values + 1, 1); rowptr = np.cumsum(rowptr).astype(np.int32)
pre = ee.pre.values.astype(np.uint16); syn = np.minimum(ee.syn_count.values, 65535).astype(np.uint16)
with open(OUT + 'ear.bin', 'wb') as f:
    f.write(rowptr.tobytes()); f.write(pre.tobytes()); f.write(syn.tobytes())

SIGN = {'acetylcholine': 1, 'gaba': -1, 'glutamate': -1, 'dopamine': 0.3, 'serotonin': 0.3, 'octopamine': 0.3}
def jo_group(ct):
    g = re.sub(r'^JO-?', '', ct)
    return 'A' if g.startswith('A') else 'B' if g.startswith('B') else 'C' if g.startswith('C') else 'D' if g.startswith('D') else \
        'E' if g.startswith('E') else 'F' if g.startswith('F') else 'X'
P = A.reindex(ids)
x = P.pos_x.astype(float).values; y = P.pos_y.astype(float).values
z = P.pos_z.astype(float).values
x = np.where(np.isnan(x), np.nanmean(x), x); y = np.where(np.isnan(y), np.nanmean(y), y); z = np.where(np.isnan(z), np.nanmean(z), z)   # a few lack a position
# where each neuron listens: the neuropil holding most of its input synapses (sides merged; JONs: the antenna)
inp = t[t.post_pt_root_id.isin(idx)].copy(); inp['np'] = inp.neuropil.fillna('').str.replace(r'_[LR]$', '', regex=True)
inp = inp.groupby(['post_pt_root_id', 'np']).syn_count.sum().reset_index().sort_values('syn_count').drop_duplicates('post_pt_root_id', keep='last')
npl = dict(zip(inp.post_pt_root_id, inp.np))
NP = [('JO' if i < len(tiers[0]) else (npl.get(r) or '?')) for i, r in enumerate(ids)]
# a few classic names from the literature, carried in FlyWire's synonyms (e.g. Baker 2022: WV-WV)
def nick(syn):
    if not isinstance(syn, str): return ''
    m = re.findall(r'(?:Baker 2022|Matsuo 2016|Vaughan 2014|Kamikouchi 2009|Lai 2012): ([^;]+)', syn)
    return m[-1].strip() if m else ''
neurons = dict(
    n=N, tiers=[len(T) for T in tiers], edges=int(len(ee)), synapses=int(ee.syn_count.sum()),
    type=[(c if isinstance(c, str) else '') for c in P.cell_type.values],
    side=[('L' if s == 'left' else 'R' if s == 'right' else 'C') for s in P.side.values],
    sign=[SIGN.get(nt, 0.3) for nt in P.top_nt.values],
    intot=[int(intot.get(r, 0)) for r in ids],
    # frontal view: x across the brain, y down; scaled to roughly [-1, 1]
    x=list(np.round((x - np.nanmean(x)) / 90000, 4)), y=list(np.round(-(y - np.nanmean(y)) / 90000, 4)),
    z=list(np.round((z - np.nanmean(z)) / 9000, 4)),    # anterior-posterior: z is in 40 nm sections, x and y in 4 nm voxels
    jo=[jo_group(c) for c in P.cell_type.values[:len(tiers[0])]],
    np=NP, cls=[(c if isinstance(c, str) else '') for c in P.super_class.values], nick=[nick(c) for c in P.synonyms.values],
    source='FlyWire v783 (Dorkenwald et al. 2024; Schlegel et al. 2024): proofread connections and cell-type annotations')
json.dump(neurons, open(OUT + 'ear.json', 'w'), separators=(',', ':'))
print(f'{N} neurons (tiers {neurons["tiers"]}), {len(ee)} connections, {ee.syn_count.sum()} synapses; ear.bin {rowptr.nbytes + pre.nbytes + syn.nbytes} bytes')
print('JO groups', pd.Series(neurons['jo']).value_counts().to_dict())
