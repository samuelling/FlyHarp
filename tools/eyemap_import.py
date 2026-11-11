"""Map the model's 721 hex columns onto the real Drosophila eye.

Source: Zhao et al., "Eye structure shapes neuron function in Drosophila motion vision", Nature 2025,
whole-head micro-CT eye map (fly 20240701), from github.com/reiserlab/eyemap_T4 (data/microCT).
Reads their RData with the `rdata` parser (pure data, no R code runs). Run with `python -I`.

    python -I tools/eyemap_import.py /path/to/eyemap_T4 data/fly.json data/eyemap.json

Conventions
- Their frame: +x front, +y left, +z up. The right eye's ommatidia carry hex coordinates (p, q) with
  p = posterior-dorsal and q = anterior-dorsal neighbours (measured below from the directions).
- The flyvis lattice (hex_to_pixel): +x anterior, +y dorsal. Its T4 subtypes confirm this: T4a prefers
  front-to-back motion (-x), T4b back-to-front (+x), T4c up (+y), T4d down (-y).
  So flyvis (u, v) = n_q * (-1, 1) + n_p * (0, -1), i.e. n_q = -u, n_p = -u - v, about their origin.
- Columns that fall outside the measured eye (a few at the rim) get directions from a smooth cubic fit
  of azimuth/elevation over the lattice, and are flagged real = 0.
"""
import sys, json
import numpy as np
import rdata

src, fly_json, out_json = sys.argv[1], sys.argv[2], sys.argv[3]
a = rdata.read_rda(f'{src}/data/microCT/20240701.RData')
b = rdata.read_rda(f'{src}/data/microCT/20240701_nb.RData')
ucl = np.asarray(a['ucl_rot_sm'], float)                     # viewing directions, indexed by cone
lens_order = np.argsort(np.asarray(a['i_match']))             # R: ucl_rot_sm[order(i_match),] -> lens order
left = np.asarray(a['ind_left_lens']).astype(bool)
dirs = ucl[lens_order][~left]                                 # right eye, rows = right-eye lenses
ixy = np.asarray(b['ind_xy_right'])
d = dirs[ixy[:, 0].astype(int) - 1]
P, Q = ixy[:, 1].astype(int), ixy[:, 2].astype(int)
az = np.degrees(np.arctan2(-d[:, 1], d[:, 0]))                # 0 = straight ahead, +90 = right lateral
az = np.where(az < -90, az + 360, az)
el = np.degrees(np.arcsin(np.clip(d[:, 2], -1, 1)))
pos = {(p, q): k for k, (p, q) in enumerate(zip(P, Q))}

def step(dp, dq):
    s = [(az[pos[(p + dp, q + dq)]] - az[k], el[pos[(p + dp, q + dq)]] - el[k]) for (p, q), k in pos.items() if (p + dp, q + dq) in pos]
    return np.mean(s, 0)
sp, sq = step(1, 0), step(0, 1)
assert sp[0] > 0 and sp[1] > 0 and sq[0] < 0 and sq[1] > 0, ('unexpected lattice orientation', sp, sq)

ang = [np.degrees(np.arccos(np.clip(d[k] @ d[pos[(p + dp, q + dq)]], -1, 1)))
       for (p, q), k in pos.items() for dp, dq in [(1, 0), (0, 1), (1, 1)] if (p + dp, q + dq) in pos]
dphi = float(np.median(ang))

# smooth fit for the few model columns beyond the measured eye
def design(p, q):
    p, q = np.asarray(p, float), np.asarray(q, float)
    return np.stack([np.ones_like(p), p, q, p * p, p * q, q * q, p ** 3, p * p * q, p * q * q, q ** 3], 1)
A = design(P, Q)
caz = np.linalg.lstsq(A, az, rcond=None)[0]; cel = np.linalg.lstsq(A, el, rcond=None)[0]

model = json.load(open(fly_json))
cols = []
for u, v in model['columns']:
    p, q = -u - v, -u
    k = pos.get((p, q))
    if k is not None: cols.append([round(float(az[k]), 3), round(float(el[k]), 3), 1])
    else:
        r = design([p], [q])[0]; cols.append([round(float(r @ caz), 3), round(float(r @ cel), 3), 0])
k0 = pos[(0, 0)]
out = dict(source='Zhao et al. 2025 (Nature 646:135), micro-CT eye map of fly 20240701, right eye; github.com/reiserlab/eyemap_T4',
           convention='per model column (order of fly.json columns): [azimuth deg (0 = ahead, +90 = right lateral), elevation deg, real (1) or extrapolated (0)]',
           ommatidia=int(len(P)), median_dphi_deg=round(dphi, 3), centre=[round(float(az[k0]), 3), round(float(el[k0]), 3)], columns=cols)
json.dump(out, open(out_json, 'w'), separators=(',', ':'))
print(f'{len(P)} ommatidia, median interommatidial angle {dphi:.2f} deg; {sum(c[2] for c in cols)} of {len(cols)} model columns on real ommatidia;',
      f'centre column looks at az {az[k0]:.1f}, el {el[k0]:.1f}; az {min(c[0] for c in cols):.0f}..{max(c[0] for c in cols):.0f}, el {min(c[1] for c in cols):.0f}..{max(c[1] for c in cols):.0f}')
