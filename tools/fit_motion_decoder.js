// Fit a linear read-out of the T4/T5 subtypes into a 2-D motion vector (least squares, ridge), and store it in
// data/fly.json as motion_decoder. Training set: drifting gratings (2 SF/TF) and ON/OFF edges in 24 directions,
// plus flicker and counterphase gratings with target zero, so non-directional responses decode to no motion.
// Prints held-out accuracy. A plain vector sum along preferred directions is biased in this model because some
// subtypes (T4d, T5b) are only weakly direction selective and respond to almost any motion.
const FlyEngine = require('../js/engine.js'), GainControl = require('../js/gain.js');
const m = JSON.parse(require('fs').readFileSync(__dirname + '/../data/fly.json'));
const e = new FlyEngine(m), nC = e.nC, x = e.x, y = e.y, dt = e.dt;
delete m.motion_decoder; e.settle(0.5, 3);
// the read-out has to hold with and without the optional gain control (js/gain.js), so it is fit on both regimes
const gc = new GainControl(e), REGIMES = [{adapt: false, norm: false}, {adapt: true, norm: true, target: 'both'}];
const sub = ['T4a','T4b','T4c','T4d','T5a','T5b','T5c','T5d'], ti = sub.map(t => m.types.indexOf(t));
const nodes = ti.map(t => Array.from(e.nodeOf[t]));
const R = Math.max(...Array.from(x, (v, k) => Math.hypot(v, y[k])));
const inner = Array.from({length: nC}, (_, k) => Math.hypot(x[k], y[k]) < R - 2.5);
const nIn = inner.filter(Boolean).length, deg = Math.PI / 180;
// features: mean positive depolarisation per subtype over inner columns, averaged over the last 2/3 of the run
function run(fn, n) { e.V.set(e.V0); gc.reset(0.5); const lum = new Float32Array(nC).fill(0.5), acc = sub.map(() => 0); let cnt = 0;
  for (let s = 0; s < 20; s++) e.step(gc.process(lum));
  for (let s = 0; s < n; s++) { fn(s, lum); e.step(gc.process(lum)); if (s > n / 3) { cnt++; sub.forEach((t, j) => { for (let k = 0; k < nC; k++) if (inner[k]) { const d = e.V[nodes[j][k]] - e.V0[nodes[j][k]]; if (d > 0) acc[j] += d; } }); } }
  return acc.map(v => v / cnt / nIn); }
const proj = (k, th) => x[k] * Math.cos(th) + y[k] * Math.sin(th);
const grating = (th, per, tf, c = 0.8) => (s, L) => { for (let k = 0; k < nC; k++) L[k] = 0.5 * (1 + c * Math.sin(2 * Math.PI * (proj(k, th) / per - tf * s * dt))); };
const edge = (th, pol, sp) => (s, L) => { const pos = -R + sp * s * dt; for (let k = 0; k < nC; k++) L[k] = 0.5 * (1 + (proj(k, th) < pos ? 0.8 * pol : 0)); };
const rows = [], tg = [];
const add = (f, th, n, w = 1) => { const r = run(f, n); rows.push(r.map(v => v * w)); tg.push(th === null ? [0, 0] : [w * Math.cos(th), w * Math.sin(th)]); return r; };
for (const rg of REGIMES) {
  gc.set(rg);
  // responses are much smaller with gain control on; weight each regime's rows so both count equally
  const w0 = rows.length;
  for (let d = 0; d < 360; d += 15) { const th = d * deg; add(grating(th, 8, 1), th, 75); add(grating(th, 12, 2, 0.3), th, 60); add(edge(th, 1, 12), th, 90); add(edge(th, -1, 12), th, 90); }
  for (const f of [0.5, 1, 2, 4]) add((s, L) => L.fill(0.5 * (1 + 0.8 * Math.sin(2 * Math.PI * f * s * dt))), null, 75, 3);
  for (const th of [0, 60, 120]) add((s, L) => { for (let k = 0; k < nC; k++) L[k] = 0.5 * (1 + 0.8 * Math.sin(2 * Math.PI * proj(k, th * deg) / 8) * Math.sin(2 * Math.PI * 2 * s * dt)); }, null, 75, 3); // counterphase
  const sz = rows.slice(w0).reduce((a, r) => a + Math.hypot(...r), 0) / (rows.length - w0);
  for (let q = w0; q < rows.length; q++) { rows[q] = rows[q].map(v => v / sz); }
  console.log('regime', JSON.stringify(rg), 'mean feature norm', sz.toFixed(3));
}
// least squares (ridge) W: 8x2
const A = rows, n = A.length, p = 8, lam = 1e-3;
const AtA = Array.from({length: p}, (_, i) => Array.from({length: p}, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lam * n : 0)));
const solve = (M, b) => { const k = M.length, a = M.map((r, i) => [...r, b[i]]); for (let i = 0; i < k; i++) { let mx = i; for (let r = i + 1; r < k; r++) if (Math.abs(a[r][i]) > Math.abs(a[mx][i])) mx = r; [a[i], a[mx]] = [a[mx], a[i]]; for (let r = 0; r < k; r++) if (r !== i) { const f = a[r][i] / a[i][i]; for (let c = i; c <= k; c++) a[r][c] -= f * a[i][c]; } } return a.map((r, i) => r[k] / r[i]); };
const W = [0, 1].map(c => solve(AtA, Array.from({length: p}, (_, i) => A.reduce((s, r, q) => s + r[i] * tg[q][c], 0))));
console.log('W', sub.map((t, j) => `${t}:[${W[0][j].toFixed(3)},${W[1][j].toFixed(3)}]`).join(' '));
const dec = r => [r.reduce((s, v, j) => s + v * W[0][j], 0), r.reduce((s, v, j) => s + v * W[1][j], 0)];
const old = r => { let vx = 0, vy = 0; sub.forEach((t, j) => { vx += r[j] * Math.cos(m.pref_dir[t]); vy += r[j] * Math.sin(m.pref_dir[t]); }); return [vx, vy]; };
const ang = v => Math.round(Math.atan2(v[1], v[0]) / deg), mag = v => Math.hypot(v[0], v[1]);
console.log('HELD-OUT  stim  new(dir,|v|)  old(dir)');
for (const rg of REGIMES) { gc.set(rg); console.log('regime', JSON.stringify(rg));
const err = [];
for (let d = 7; d < 360; d += 30) { const th = d * deg;
  for (const [nm, f, nn] of [['grat6/1.5Hz', grating(th, 6, 1.5, 0.5), 75], ['edge OFF fast', edge(th, -1, 20), 60], ['grat10/0.7', grating(th, 10, 0.7), 90]]) {
    const r = run(f, nn), v = dec(r), o = old(r), er = ((ang(v) - d + 540) % 360) - 180; err.push(Math.abs(er));
    if (nm === 'grat6/1.5Hz') console.log(String(d).padStart(4), nm.padEnd(14), String(ang(v)).padStart(5), mag(v).toFixed(2), '   old', String(ang(o)).padStart(5));
  } }
err.sort((a, b) => a - b); console.log('held-out abs angle error: median', err[err.length >> 1], ' 90th pct', err[Math.floor(0.9 * err.length)]);
}
gc.set(REGIMES[0]);
const fl = run((s, L) => L.fill(0.5 * (1 + 0.8 * Math.sin(2 * Math.PI * 3 * s * dt))), 75);
const g0 = run(grating(0, 8, 1), 75);
console.log('flicker 3Hz |v| new', mag(dec(fl)).toFixed(3), 'vs motion', mag(dec(g0)).toFixed(3), ' | old flicker', mag(old(fl)).toFixed(0), 'vs', mag(old(g0)).toFixed(0));
m.motion_decoder = Object.fromEntries(sub.map((t, j) => [t, [+W[0][j].toFixed(5), +W[1][j].toFixed(5)]])); require('fs').writeFileSync(__dirname + '/../data/fly.json', JSON.stringify(m)); console.log('wrote motion_decoder to data/fly.json');
