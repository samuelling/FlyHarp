// The Tonnectome: runs the fly's auditory network (js/ear-net.js) off the main thread, in step with the ear.
//   in  {cmd:'init', json, bin}  -> out {cmd:'ready', n}
//   in  {cmd:'port', port}       frames from the ear worklet arrive on this port, every 5 ms of sound
//   in  {cmd:'gain', G}          network gain
//   out {cmd:'state', rates: Float32Array(N), coch: Float32Array(k * 2 * NB)}  about 30 times a second
importScripts('ear-net.js' + self.location.search);
let net = null, coch = [], nFrames = 0;
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
  coch.push(c);
  if (++nFrames % 6 === 0) {
    const rates = Float32Array.from(net.r), cc = new Float32Array(coch.length * 2 * NB);
    coch.forEach((x, i) => cc.set(x, i * 2 * NB)); coch = [];
    self.postMessage({cmd: 'state', rates, coch: cc}, [rates.buffer, cc.buffer]);
  }
}
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.cmd === 'init') {
    const meta = await (await fetch(m.json)).json(), bin = await loadBin(m.bin);
    net = new EarNet(meta, bin);
    self.postMessage({cmd: 'ready', n: net.N});
  } else if (m.cmd === 'port') {
    m.port.onmessage = e => onFrame(e.data);
  } else if (m.cmd === 'gain') { if (net) net.G = m.G; }
  else if (m.cmd === 'reset') { if (net) net.reset(); }
};
