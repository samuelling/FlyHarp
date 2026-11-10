// Runs the fly network off the main thread. Messages:
//   in  {cmd:'init', url}                      -> out {cmd:'ready', N, nE, types, groupOf..}
//   in  {cmd:'run', frames:[Float32Array(721)]} -> out {cmd:'frames', act:[Float32Array(nT)], cx, cy, V}
importScripts('engine.js');
let eng = null, typeNodes = null, xs = null, ys = null, region = null, regCount = null, NR = 7, scale = null;

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
    scale = calibrate();
    eng.settle(0.5, 2);
    self.postMessage({cmd: 'ready', N: eng.N, nE: eng.nE, types: model.types, x: Array.from(xs), y: Array.from(ys),
      nodeOf: eng.nodeOf.map(a => Array.from(a)), region: Array.from(region), NR, scale: Array.from(scale)});
  } else if (msg.cmd === 'run') {
    const out = [];
    for (const lum of msg.frames) { eng.step(lum); out.push(regionActivity()); }
    const dV = new Float32Array(eng.N);
    for (let i = 0; i < eng.N; i++) dV[i] = eng.V[i] - eng.V0[i];
    self.postMessage({cmd: 'frames', steps: out, dV}, [dV.buffer]);
  } else if (msg.cmd === 'reset') {
    eng.settle(0.5, 2);
  }
};

// mean depolarisation relative to the grey operating point, per cell type x eye region
function regionActivity() {
  const V = eng.V, V0 = eng.V0, nT = eng.nT, a = new Float32Array(nT * NR);
  for (let t = 0; t < nT; t++) {
    const nodes = typeNodes[t], base = t * NR;
    for (let n = 0; n < nodes.length; n++) {
      const i = nodes[n], d = V[i] - V0[i];
      if (d > 0) a[base + region[eng.nodeCol[i]]] += d;
    }
    for (let r = 0; r < NR; r++) a[base + r] /= Math.max(regCount[base + r], 1);
  }
  return a;
}

// response scale per cell type: peak regional activity to a full-field drifting grating and to flashes
function calibrate() {
  eng.settle(0.5, 2);
  const nC = eng.nC, nT = eng.nT, sc = new Float32Array(nT), lum = new Float32Array(nC);
  const run = (fn, n) => { for (let s = 0; s < n; s++) { fn(s, lum); eng.step(lum); const a = regionActivity(); for (let t = 0; t < nT; t++) for (let r = 0; r < NR; r++) sc[t] = Math.max(sc[t], a[t * NR + r]); } };
  for (const th of [0, Math.PI / 2]) {
    eng.settle(0.5, 1);
    run((s, L) => { for (let k = 0; k < nC; k++) L[k] = 0.5 * (1 + Math.sin(2 * Math.PI / 8 * (xs[k] * Math.cos(th) + ys[k] * Math.sin(th)) - 2 * Math.PI * 2 * s * eng.dt)); }, 60);
  }
  eng.settle(0.5, 1);
  run((s, L) => L.fill(s < 15 ? 1 : s < 30 ? 0.5 : s < 45 ? 0 : 0.5), 60);
  for (let t = 0; t < nT; t++) sc[t] = Math.max(sc[t], 1e-4);
  return sc;
}
