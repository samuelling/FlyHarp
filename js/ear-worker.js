// The Tonnectome: runs the fly's auditory network (js/ear-net.js) off the main thread, in step with the ear.
//   in  {cmd:'init', json, bin}  -> out {cmd:'ready', n}
//   in  {cmd:'port', port}       frames from the ear worklet arrive on this port, every 5 ms of sound
//   in  {cmd:'gain', G}          network gain
//   in  {cmd:'pops', pops: [Int32Array]}   populations to read out every frame (the Hears lenses)
//   out {cmd:'state', rates: Float32Array(N), coch: Float32Array(k * 2 * NB), pv: Float32Array(k * npop * (2 * NB + 1))}
//       about 30 times a second. pv: for each 5 ms frame and population, its band profile (mean rate of its cells,
//       weighted by how much each listens to that antenna and band; see EarNet.tuning) and then its mean rate.
importScripts('ear-net.js' + self.location.search);
let net = null, coch = [], nFrames = 0, pops = [], pv = [], gen = 0;
const PK = 2 * 32 + 1;
function setPops(list) {
  const K = 2 * EarNet.NB, T = net.T;
  pops = list.map(idx => {
    const norm = new Float32Array(K); for (const i of idx) for (let k = 0; k < K; k++) norm[k] += T[i * K + k];
    // bands this population barely listens to read as silence rather than as noise divided by almost nothing
    let mx = 0; for (let k = 0; k < K; k++) if (norm[k] > mx) mx = norm[k];
    for (let k = 0; k < K; k++) norm[k] = norm[k] > 0.04 * mx ? 1 / norm[k] : 0;
    return {idx, norm};
  });
}
function readPops() {
  const K = 2 * EarNet.NB, T = net.T, r = net.r, out = new Float32Array(pops.length * PK), acc = new Float32Array(K);
  pops.forEach((P, q) => {
    acc.fill(0); let m = 0;
    for (const i of P.idx) { const a = r[i]; m += a; if (a < 0.0005) continue; const o = i * K; for (let k = 0; k < K; k++) acc[k] += a * T[o + k]; }
    for (let k = 0; k < K; k++) out[q * PK + k] = acc[k] * P.norm[k];
    out[q * PK + K] = m / Math.max(1, P.idx.length);
  });
  return out;
}
async function loadBin(url) {
  try { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); } catch (e) {}
  // hosts that refuse .bin get a base64-in-JSON copy
  const j = await (await fetch(url.replace(/\.bin(\?|$)/, '.b64.json$1'))).json();
  const s = atob(j.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
function onFrame(f) {
  if (!net) return;
  net.input(f); net.step();
  // what each antenna hears per band (push + pull), for the cochleogram
  const NB = EarNet.NB, c = new Float32Array(2 * NB);
  for (let e = 0; e < 2; e++) for (let k = 0; k < NB; k++) c[e * NB + k] = f[e * 2 * NB + k] + f[e * 2 * NB + NB + k];
  coch.push(c); if (pops.length) pv.push(readPops());
  if (++nFrames % 6 === 0) {
    const rates = Float32Array.from(net.r), cc = new Float32Array(coch.length * 2 * NB);
    coch.forEach((x, i) => cc.set(x, i * 2 * NB)); coch = [];
    const pp = new Float32Array(pv.length * pops.length * PK); pv.forEach((x, i) => pp.set(x, i * x.length)); pv = [];
    self.postMessage({cmd: 'state', rates, coch: cc, pv: pp, npop: pops.length, gen}, [rates.buffer, cc.buffer, pp.buffer]);
  }
}
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.cmd === 'init') {
    const meta = await (await fetch(m.json)).json(), bin = await loadBin(m.bin);
    net = new EarNet(meta, bin); net.tuning();
    self.postMessage({cmd: 'ready', n: net.N, T: net.T});
  } else if (m.cmd === 'port') {
    m.port.onmessage = e => onFrame(e.data);
  } else if (m.cmd === 'gain') { if (net) net.G = m.G; }
  else if (m.cmd === 'pops') { if (net) { setPops(m.pops); pv = []; coch = []; gen = m.gen; } }   // keep the two streams frame-aligned
  else if (m.cmd === 'reset') { if (net) net.reset(); }
};
