// Runs the fly network off the main thread. Messages:
//   in  {cmd:'init', url}                      -> out {cmd:'ready', N, nE, types, groupOf..}
//   in  {cmd:'run', frames:[Float32Array(721)]} -> out {cmd:'frames', act:[Float32Array(nT)], cx, cy, V}
importScripts('engine.js');
let eng = null, typeNodes = null, xs = null, ys = null, region = null, regCount = null, NR = 7, scale = null;
// medulla -> lamina feedback: synapses onto L1-L5 from medulla-resident cells (C2, C3, Lawf1/2 and medulla
// interneurons contacting L-cell terminals). fbE*: edge index, target node; fb0: value on a grey screen
let fbEdge = null, fbTgt = null, fb0 = null, fbCount = null, fbScale = 1;

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.cmd === 'init') {
    const model = await (await fetch(msg.url)).json();
    eng = new FlyEngine(model);
    eng.settle(0.5, 3);
    typeNodes = model.types.map((_, t) => Array.from(eng.nodeOf[t]).filter(i => i >= 0));
    xs = eng.x; ys = eng.y;
    // 7 regions of the eye: centre disk + 6 surrounding sectors
    let R = 0; for (let k = 0; k < eng.nC; k++) R = Math.max(R, Math.hypot(xs[k], ys[k]));
    region = new Int32Array(eng.nC);
    for (let k = 0; k < eng.nC; k++) {
      const r = Math.hypot(xs[k], ys[k]);
      region[k] = r < R / 3 ? 0 : 1 + (Math.floor(((Math.atan2(ys[k], xs[k]) + Math.PI) / (2 * Math.PI)) * 6) % 6);
    }
    regCount = new Float32Array(eng.nT * NR);
    for (let t = 0; t < eng.nT; t++) for (const i of typeNodes[t]) regCount[t * NR + region[eng.nodeCol[i]]]++;
    setupFeedback(model);
    scale = calibrate();
    eng.settle(0.5, 2);
    self.postMessage({cmd: 'ready', N: eng.N, nE: eng.nE, types: model.types, x: Array.from(xs), y: Array.from(ys),
      nodeOf: eng.nodeOf.map(a => Array.from(a)), region: Array.from(region), NR, scale: Array.from(scale), tau: model.tau, fbInfo, prefDir});
  } else if (msg.cmd === 'run') {
    const out = [];
    for (const lum of msg.frames) { eng.step(lum); out.push(withFeedback(regionActivity())); }
    const dV = new Float32Array(eng.N);
    for (let i = 0; i < eng.N; i++) dV[i] = eng.V[i] - eng.V0[i];
    const fbc = feedbackCols();
    self.postMessage({cmd: 'frames', steps: out, dV, fbc}, [dV.buffer, fbc.buffer]);
  } else if (msg.cmd === 'reset') {
    eng.settle(0.5, 2);
  }
};

// per cell type x eye region: mean depolarisation (first nT*NR entries) and mean hyperpolarisation
// (second nT*NR entries) relative to the grey operating point
function regionActivity() {
  const V = eng.V, V0 = eng.V0, nT = eng.nT, M = nT * NR, a = new Float32Array(2 * M);
  for (let t = 0; t < nT; t++) {
    const nodes = typeNodes[t], base = t * NR;
    for (let n = 0; n < nodes.length; n++) {
      const i = nodes[n], d = V[i] - V0[i], r = region[eng.nodeCol[i]];
      if (d > 0) a[base + r] += d; else a[M + base + r] -= d;
    }
    for (let r = 0; r < NR; r++) { const c = Math.max(regCount[base + r], 1); a[base + r] /= c; a[M + base + r] /= c; }
  }
  return a;
}

// response scale per cell type and sign: peak regional activity to full-field gratings and ON/OFF flashes
function calibrate() {
  eng.settle(0.5, 2);
  eng.step(new Float32Array(eng.nC).fill(0.5)); fb0 = feedbackNow(); fbCol0 = null; fbCol0 = feedbackCols();
  let fbMax = 1e-6;
  const nC = eng.nC, nT = eng.nT, M = nT * NR, sc = new Float32Array(2 * nT), lum = new Float32Array(nC);
  const run = (fn, n) => { for (let s = 0; s < n; s++) { fn(s, lum); eng.step(lum); const a = regionActivity();
    const f = feedbackNow(); for (let r = 0; r < NR; r++) fbMax = Math.max(fbMax, Math.abs(f[r] - fb0[r]));
    for (let t = 0; t < nT; t++) for (let r = 0; r < NR; r++) { sc[t] = Math.max(sc[t], a[t * NR + r]); sc[nT + t] = Math.max(sc[nT + t], a[M + t * NR + r]); } } };
  for (const th of [0, Math.PI / 2]) {
    eng.settle(0.5, 1);
    run((s, L) => { for (let k = 0; k < nC; k++) L[k] = 0.5 * (1 + Math.sin(2 * Math.PI / 8 * (xs[k] * Math.cos(th) + ys[k] * Math.sin(th)) - 2 * Math.PI * 2 * s * eng.dt)); }, 60);
  }
  eng.settle(0.5, 1);
  run((s, L) => L.fill(s < 15 ? 1 : s < 30 ? 0.5 : s < 45 ? 0 : 0.5), 60);
  for (let t = 0; t < 2 * nT; t++) sc[t] = Math.max(sc[t], 1e-4);
  fbScale = 0.4 * fbMax; // so ordinary stimuli span most of the ±1 range
  if (eng.m.pref_dir) prefDir = eng.m.pref_dir; else measureDirections();  // precomputed by tools/precompute_directions.js
  return sc;
}

let fbInfo = null, fbCol0 = null, prefDir = {};
function setupFeedback(model) {
  const T = model.types, isL = new Set(['L1', 'L2', 'L3', 'L4', 'L5'].map(t => T.indexOf(t)));
  const lamina = /^(R\d|L\d|Am|T1)$/;
  const isFB = T.map(t => !lamina.test(t));          // C2, C3, Lawf and every medulla-resident type
  const E = [], G = [];
  const share = {};
  let tot = 0;
  for (let i = 0; i < eng.N; i++) {
    if (!isL.has(eng.nodeType[i])) continue;
    for (let p = eng.rowptr[i]; p < eng.rowptr[i + 1]; p++) {
      const st = eng.nodeType[eng.src[p]], a = Math.abs(eng.w[p]);
      tot += a;
      if (isFB[st]) { E.push(p); G.push(i); share[T[st]] = (share[T[st]] || 0) + a; }
    }
  }
  fbEdge = Int32Array.from(E); fbTgt = Int32Array.from(G);
  fbCount = new Float32Array(NR);
  for (const t of isL) for (const i of typeNodes[t]) fbCount[region[eng.nodeCol[i]]]++;
  const fbTot = Object.values(share).reduce((a, b) => a + b, 0);
  fbInfo = {fraction: fbTot / tot, sources: Object.entries(share).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, v / tot])};
}
// signed feedback current onto L cells relative to grey, averaged per region (negative = net inhibitory)
function feedbackNow() {
  const R = eng.R, f = new Float32Array(NR);
  for (let k = 0; k < fbEdge.length; k++) { const p = fbEdge[k], i = fbTgt[k]; f[region[eng.nodeCol[i]]] += eng.w[p] * R[eng.src[p]]; }
  for (let r = 0; r < NR; r++) f[r] /= Math.max(fbCount[r], 1);
  return f;
}
// feedback current onto L1-L5 per column (mean over the five L types), relative to grey
function feedbackCols() {
  const R = eng.R, f = new Float32Array(eng.nC);
  for (let k = 0; k < fbEdge.length; k++) { const p = fbEdge[k]; f[eng.nodeCol[fbTgt[k]]] += eng.w[p] * R[eng.src[p]]; }
  for (let c = 0; c < eng.nC; c++) f[c] = (f[c] / 5 - (fbCol0 ? fbCol0[c] : 0)) / (fbCol0 ? fbScale : 1);
  return f;
}
function withFeedback(a) {
  const f = feedbackNow(), out = new Float32Array(a.length + NR);
  out.set(a);
  for (let r = 0; r < NR; r++) out[a.length + r] = (f[r] - fb0[r]) / fbScale;
  return out;
}

// preferred direction of each T4/T5 subtype on this eye: moving ON edges (for T4) and OFF edges (for T5)
// in 12 directions, response-weighted circular mean
function measureDirections() {
  const T = eng.types, ds = Array.from({length: 12}, (_, i) => i * Math.PI / 6), nC = eng.nC, lum = new Float32Array(nC);
  const sub = T.map((t, i) => [t, i]).filter(([t]) => /^T[45][a-d]$/.test(t));
  const acc = Object.fromEntries(sub.map(([t]) => [t, [0, 0]]));
  let R = 0; for (let k = 0; k < nC; k++) R = Math.max(R, Math.hypot(xs[k], ys[k]));
  for (const pol of [1, -1]) for (const th of ds) {
    eng.settle(0.5, 0.6);
    const resp = Object.fromEntries(sub.map(([t]) => [t, 0]));
    const n = Math.round((2 * R + 4) / 12 / eng.dt);  // edge sweeps at 12 columns/s
    for (let s = 0; s < n; s++) {
      const pos = -R - 2 + 12 * s * eng.dt;
      for (let k = 0; k < nC; k++) lum[k] = 0.5 * (1 + ((xs[k] * Math.cos(th) + ys[k] * Math.sin(th)) < pos ? 0.8 * pol : 0));
      eng.step(lum);
      for (const [t, i] of sub) { if ((t[1] === '4') !== (pol > 0)) continue; for (const nd of typeNodes[i]) { const d = eng.V[nd] - eng.V0[nd]; if (d > 0) resp[t] += d; } }
    }
    for (const [t] of sub) { acc[t][0] += resp[t] * Math.cos(th); acc[t][1] += resp[t] * Math.sin(th); }
  }
  for (const [t] of sub) prefDir[t] = Math.atan2(acc[t][1], acc[t][0]);
}
