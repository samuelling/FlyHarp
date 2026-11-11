// The Tonnectome: the fly's ears listen to the fly's eyes.
// FlyHarp's own sound (and/or the microphone) -> antenna filterbank (js/ear-worklet.js) -> Johnston's organ and
// the early auditory network from the FlyWire connectome (js/ear-worker.js, js/ear-net.js) -> two pictures of
// what the fly hears (a cochleogram and the auditory network itself) -> optionally back into the fly's eye as a
// stimulus, so sight becomes sound becomes sight again.
const Tonnectome = (() => {
  const $ = id => document.getElementById(id);
  const V = window.FH_V ? '?v=' + window.FH_V : '';
  const NB = 32, CT = 240;                       // cochleogram: 32 bands per ear, 240 columns of 10 ms
  const GW = 96, GH = 72;                        // the picture handed to the eye
  const TIER_COL = [[79, 179, 164], [224, 195, 90], [232, 138, 79], [226, 87, 107]];
  let meta = null, worker = null, ready = false, attached = false, rates = null, frames = 0;
  const coch = new Float32Array(CT * 2 * NB);    // ring buffer of columns (left ear bands, right ear bands)
  let cHead = 0, pend = null;
  const cochGrid = new Float32Array(GW * NB), brainGrid = new Float32Array(GW * GH);
  let brainMax = 0.05, bx0 = 0, bx1 = 1, by0 = 0, by1 = 1, P = null;
  const env2v = e => { const v = (Math.log10(e + 1e-6) + 3.0) / 2.0; return v < 0 ? 0 : v > 1 ? 1 : v; };

  function init(params) {
    P = params.P;
    worker = new Worker('js/ear-worker.js' + V);
    worker.onmessage = e => {
      const m = e.data;
      if (m.cmd === 'ready') { ready = true; status(); }
      else if (m.cmd === 'state') onState(m);
    };
    fetch('data/ear.json' + V).then(r => r.json()).then(j => {
      meta = j;
      const pad = 0.06; bx0 = Math.min(...j.x) - pad; bx1 = Math.max(...j.x) + pad; by0 = Math.min(...j.y) - pad; by1 = Math.max(...j.y) + pad;
      $('tnStats').textContent = `${j.n.toLocaleString()} neurons: ${j.tiers[0].toLocaleString()} Johnston's organ neurons (both antennae), then ${j.tiers.slice(1).map(x => x.toLocaleString()).join(', ')} at the 2nd, 3rd and 4th steps · ${j.synapses.toLocaleString()} synapses (FlyWire v783)`;
      worker.postMessage({cmd: 'init', json: new URL('data/ear.json' + V, location.href).href, bin: new URL('data/ear.bin' + V, location.href).href});
    });
    $('tnSource').onchange = applySource; $('tnLevel').oninput = applySource;
    $('tnGain').oninput = () => { worker.postMessage({cmd: 'gain', G: +$('tnGain').value}); $('tnGain').parentElement.querySelector('output').textContent = $('tnGain').value; };
    $('tnMix').oninput = () => { P.earMix = +$('tnMix').value; $('tnMix').parentElement.querySelector('output').textContent = P.earMix.toFixed(2); };
    $('tnView').onchange = () => P.earView = $('tnView').value;
    P.earMix = +$('tnMix').value; P.earView = $('tnView').value;
    Stimuli.setEarSampler(sample);
    requestAnimationFrame(draw);
  }
  // after the audio context exists (Start): connect the instrument's output to the ear
  async function onAudioStart() {
    if (attached) return;
    const ch = new MessageChannel();
    if (await Sound.attachEar(ch.port1)) { worker.postMessage({cmd: 'port', port: ch.port2}, [ch.port2]); attached = true; applySource(); }
    status();
  }
  async function applySource() {
    $('tnLevel').parentElement.querySelector('output').textContent = (+$('tnLevel').value).toFixed(2);
    if (!attached) return;
    const got = await Sound.setEarSource($('tnSource').value, +$('tnLevel').value);
    if (got && got !== $('tnSource').value) { $('tnSource').value = got; $('tnNote').textContent = 'microphone unavailable here (permission, or the page is sandboxed): listening to the instrument'; }
  }
  function status() {
    $('tnNote').textContent = !ready ? 'loading the auditory connectome…' : !attached ? 'Press Start: the ears listen to the instrument (and the microphone, if you choose it).' : 'listening';
  }
  function onState(m) {
    rates = m.rates; frames++;
    // cochleogram: average pairs of 5 ms frames into 10 ms columns
    const n = m.coch.length / (2 * NB);
    for (let k = 0; k < n; k++) {
      if (!pend) { pend = m.coch.slice(k * 2 * NB, (k + 1) * 2 * NB); continue; }
      for (let b = 0; b < 2 * NB; b++) coch[cHead * 2 * NB + b] = 0.5 * (pend[b] + m.coch[k * 2 * NB + b]);
      cHead = (cHead + 1) % CT; pend = null;
    }
    // the eye's version of the cochleogram: the last GW columns, both ears together, low pitches at the bottom
    for (let x = 0; x < GW; x++) {
      const c = (cHead - GW + x + CT) % CT;
      for (let b = 0; b < NB; b++) cochGrid[b * GW + x] = env2v(Math.max(coch[c * 2 * NB + b], coch[c * 2 * NB + NB + b]));
    }
    // the eye's version of the network: activity splatted at each neuron's place in the brain, blurred
    if (meta) {
      brainGrid.fill(0);
      for (let i = 0; i < meta.n; i++) {
        const r = rates[i]; if (r < 0.01) continue;
        const gx = Math.round((meta.x[i] - bx0) / (bx1 - bx0) * (GW - 1)), gy = Math.round((by1 - meta.y[i]) / (by1 - by0) * (GH - 1));
        brainGrid[gy * GW + gx] += r;
      }
      blur(brainGrid, GW, GH); blur(brainGrid, GW, GH); blur(brainGrid, GW, GH);
      let mx = 0; for (let i = 0; i < brainGrid.length; i++) if (brainGrid[i] > mx) mx = brainGrid[i];
      brainMax = Math.max(0.05, mx > brainMax ? mx : brainMax * 0.97 + mx * 0.03);
    }
  }
  function blur(g, w, h) {
    const t = new Float32Array(g.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += g[y * w + xx] * (d ? 1 : 2); n += d ? 1 : 2; } } t[y * w + x] = s / n; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += t[yy * w + x] * (d ? 1 : 2); n += d ? 1 : 2; } } g[y * w + x] = s / n; }
  }
  // what the eye sees of the ear, at eye position (u, v) in [-1, 1] (v up): 0 (silence) .. 1
  function sample(u, v) {
    if (!frames) return 0;
    const cochl = P.earView !== 'brain';
    const W = GW, H = cochl ? NB : GH, g = cochl ? cochGrid : brainGrid;
    // cochleogram: time runs right (newest at the right edge), band index grows upward (low pitches at the bottom);
    // network: the frontal view of the brain, dorsal up
    const fx = (u + 1) / 2 * (W - 1), fy = cochl ? (v + 1) / 2 * (H - 1) : (1 - v) / 2 * (H - 1);
    if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) return 0;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    const val = (1 - ay) * ((1 - ax) * g[y0 * W + x0] + ax * g[y0 * W + x1]) + ay * ((1 - ax) * g[y1 * W + x0] + ax * g[y1 * W + x1]);
    return cochl ? val : Math.sqrt(Math.min(1, val / brainMax));   // square root: let the quieter parts of the network show
  }

  // ---------------------------------------------------------------- the two pictures
  function draw() {
    requestAnimationFrame(draw);
    drawCoch(); drawBrain();
  }
  const cc = () => $('tnCoch'), bc = () => $('tnBrain');
  let cImg = null;
  function drawCoch() {
    const c = cc(); if (!c) return;
    const x = c.getContext('2d'), W = c.width, H = c.height;
    if (!cImg) cImg = x.createImageData(CT, 2 * NB + 2);
    const d = cImg.data;
    for (let col = 0; col < CT; col++) {
      const src = (cHead + col) % CT;
      for (let e = 0; e < 2; e++) for (let b = 0; b < NB; b++) {
        const v = env2v(coch[src * 2 * NB + e * NB + b]), row = e * (NB + 2) + (NB - 1 - b), o = 4 * (row * CT + col);
        // magma-ish: dark violet -> orange -> pale yellow
        d[o] = 255 * Math.min(1, 0.05 + 1.25 * v); d[o + 1] = 255 * Math.max(0, Math.min(1, 1.4 * v - 0.35)); d[o + 2] = 255 * Math.max(0.08, Math.min(1, 0.45 * (1 - v) + 1.6 * Math.max(0, v - 0.75))); d[o + 3] = 255;
      }
    }
    for (let col = 0; col < CT; col++) for (const row of [NB, NB + 1]) { const o = 4 * (row * CT + col); d[o] = d[o + 1] = d[o + 2] = 14; d[o + 3] = 255; }
    const tmp = drawCoch.t || (drawCoch.t = Object.assign(document.createElement('canvas'), {width: CT, height: 2 * NB + 2}));
    tmp.getContext('2d').putImageData(cImg, 0, 0);
    x.imageSmoothingEnabled = false; x.drawImage(tmp, 0, 0, W, H);
    x.fillStyle = '#cfccc4'; x.font = '11px -apple-system, Segoe UI, sans-serif';
    x.fillText('left antenna', 8, 14); x.fillText('right antenna', 8, H / 2 + 16);
    x.fillStyle = '#8d8a83'; x.textAlign = 'right';
    x.fillText(`${EarNet.FHI} Hz`, W - 6, 12); x.fillText(`${EarNet.FLO} Hz`, W - 6, H / 2 - 6); x.textAlign = 'left';
  }
  function drawBrain() {
    const c = bc(); if (!c || !meta) return;
    const x = c.getContext('2d'), W = c.width, H = c.height;
    x.fillStyle = '#08090b'; x.fillRect(0, 0, W, H);
    const sx = v => (v - bx0) / (bx1 - bx0) * W, sy = v => (by1 - v) / (by1 - by0) * H;
    let i = 0;
    for (let t = 0; t < 4; t++) {
      const [r, g, b] = TIER_COL[t];
      for (let k = 0; k < meta.tiers[t]; k++, i++) {
        const a = rates ? rates[i] : 0, px = sx(meta.x[i]), py = sy(meta.y[i]);
        x.fillStyle = a > 0.02 ? `rgba(${r},${g},${b},${0.35 + 0.65 * Math.min(1, a * 1.5)})` : `rgba(${r},${g},${b},0.12)`;
        const s = a > 0.02 ? 1.4 + 3.2 * Math.min(1, a) : 1.1;
        x.fillRect(px - s / 2, py - s / 2, s, s);
      }
    }
  }
  return {init, onAudioStart, get frames() { return frames; }, get attached() { return attached; }, get rates() { return rates; }};
})();
