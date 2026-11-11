// Runs the gain-control probe (js/probe.js) on a private copy of the network, so the instrument keeps playing.
//   in  {cmd:'init', url}                     -> out {cmd:'ready'}
//   in  {cmd:'probe', type, theta, p}         -> out {cmd:'progress', f} ..., {cmd:'result', type, base, cur}
importScripts(...['engine.js', 'gain.js', 'probe.js'].map(f => f + self.location.search));
let eng = null, gc = null;
const baseCache = {};
self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.cmd === 'init') {
    eng = new FlyEngine(await (await fetch(msg.url)).json());
    eng.settle(0.5, 3); gc = new GainControl(eng);
    self.postMessage({cmd: 'ready'});
  } else if (msg.cmd === 'probe') {
    const off = Object.assign({}, msg.p, {adapt: false, norm: false}), same = !msg.p.adapt && !msg.p.norm;
    const half = same ? 1 : 0.5;
    if (!baseCache[msg.type]) {
      gc.set(off);
      baseCache[msg.type] = FlyProbe.run(eng, gc, msg.type, msg.theta, f => self.postMessage({cmd: 'progress', f: f * half}));
    }
    let cur = baseCache[msg.type];
    if (!same) { gc.set(msg.p); cur = FlyProbe.run(eng, gc, msg.type, msg.theta, f => self.postMessage({cmd: 'progress', f: half + f * half})); }
    self.postMessage({cmd: 'result', type: msg.type, base: baseCache[msg.type], cur, p: msg.p});
  }
};
