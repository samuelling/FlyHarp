// The Tonnectome: the fly's ears listen to its eyes.
// FlyHarp's own sound (and/or the microphone) -> antenna filterbank (js/ear-worklet.js) -> Johnston's organ and
// the early auditory network from the FlyWire connectome (js/ear-worker.js, js/ear-net.js) -> pictures of what
// the fly hears -> optionally back into the fly's eye as a stimulus, so sight becomes sound becomes sight again.
//
// Every picture is a faithful mapping of the ear model's outputs, drawn differently:
//   coch     cochleogram: time x frequency, both antennae
//   brain    the auditory network in frontal view, each neuron where it sits
//   chladni  a vibrating plate: each frequency band drives one plate mode (higher band, higher mode); light falls
//            where sand would gather, on the nodal lines of the sum
//   ripples  each antenna a stone dropped in a pond: the last 1.2 s of each band travels outward as rings whose
//            spacing is set by the band's pitch, and the two ears interfere
//   helix    pitch spiral: one turn per octave, chroma as angle; left antenna on the left, right on the right;
//            harmonics line up on spokes
//   rhythm   rhythm rose: autocorrelation of each ear's envelope in three frequency ranges, lag as radius
//            (0-200 ms): steady pulse trains, like the 35 ms courtship song, make rings
//   glass    stained glass: one pane per cell type and side, rings from the ear (centre) outward by step into the
//            brain, left hemisphere on the left; brightness is the pane's mean activity
const Tonnectome = (() => {
  const $ = id => document.getElementById(id);
  const V = window.FH_V ? '?v=' + window.FH_V : '';
  const NB = 32, CT = 240;                       // cochleogram: 32 bands per ear, 240 columns of 10 ms
  const GS = 128;                                // square field for every picture (u, v in [-1, 1], v up)
  const HN = 200;                                // 1 s of 5 ms frames, for the rhythm rose
  const TIER_COL = [[79, 179, 164], [224, 195, 90], [232, 138, 79], [226, 87, 107]];
  const VIEWS = {
    coch: 'Cochleogram: time runs right to left, pitch upward, both antennae together.',
    brain: 'The auditory network in frontal view, each neuron where it sits; on the eye, splatted and blurred.',
    chladni: 'Each of the 32 bands drives one mode of a square plate (higher pitch, higher mode), weighted by its loudness. Light marks where sand would gather: the still lines of the sum.',
    ripples: 'Each antenna drops stones into a pond: the last 1.2 s of every band travels outward from that ear, with ring spacing set by pitch. The two ears interfere.',
    helix: 'A pitch spiral, one turn per octave and chroma as angle: left antenna on the left, right antenna mirrored on the right. Harmonics line up along spokes.',
    rhythm: 'A rhythm rose: autocorrelation of each ear’s loudness in low, middle and high bands (six petals, low at the bottom), with delay as radius out to 200 ms. Steady pulse trains, such as a 35 ms courtship pulse song, draw rings.',
    glass: 'Stained glass: one pane per cell type and brain side, in rings from the ear at the centre to the 4th step at the rim, left hemisphere on the left. Brightness is the pane’s mean activity.',
  };
  const NAMES = {coch: 'cochleogram', brain: 'network', chladni: 'Chladni plate', ripples: 'ripples', helix: 'pitch helix', rhythm: 'rhythm rose', glass: 'stained glass'};
  let meta = null, worker = null, ready = false, attached = false, rates = null, frames = 0, P = null;
  const coch = new Float32Array(CT * 2 * NB);    // ring buffer of 10 ms columns (left bands, right bands)
  const cochV = new Float32Array(CT * 2 * NB);   // the same, as loudness 0..1
  let cHead = 0, pend = null;
  const hist = new Float32Array(HN * 6); let hHead = 0;   // 5 ms loudness: [L lo, L mid, L hi, R lo, R mid, R hi]
  const bandV = new Float32Array(2 * NB);        // current loudness per band (0..1), smoothed
  const field = new Float32Array(GS * GS);       // the current picture, 0..1
  let brainMax = 0.05, bx0 = 0, bx1 = 1, by0 = 0, by1 = 1;
  const env2v = e => { const v = (Math.log10(e + 1e-6) + 3.0) / 2.0; return v < 0 ? 0 : v > 1 ? 1 : v; };
  const FLO = 40, FHI = 1600, bandHz = b => FLO * Math.pow(FHI / FLO, b / (NB - 1));

  function init(params) {
    P = params.P;
    worker = new Worker('js/ear-worker.js' + V);
    worker.onmessage = e => { const m = e.data; if (m.cmd === 'ready') { ready = true; status(); } else if (m.cmd === 'state') onState(m); };
    buildTables();
    fetch('data/ear.json' + V).then(r => r.json()).then(j => {
      meta = j;
      const pad = 0.06; bx0 = Math.min(...j.x) - pad; bx1 = Math.max(...j.x) + pad; by0 = Math.min(...j.y) - pad; by1 = Math.max(...j.y) + pad;
      $('tnStats').textContent = `${j.n.toLocaleString()} neurons: ${j.tiers[0].toLocaleString()} Johnston's organ neurons (both antennae), then ${j.tiers.slice(1).map(x => x.toLocaleString()).join(', ')} at the 2nd, 3rd and 4th steps · ${j.synapses.toLocaleString()} synapses (FlyWire v783)`;
      buildGlass();
      worker.postMessage({cmd: 'init', json: new URL('data/ear.json' + V, location.href).href, bin: new URL('data/ear.bin' + V, location.href).href});
    });
    $('tnSource').onchange = applySource; $('tnLevel').oninput = applySource;
    $('tnGain').oninput = () => { worker.postMessage({cmd: 'gain', G: +$('tnGain').value}); $('tnGain').parentElement.querySelector('output').textContent = $('tnGain').value; };
    $('tnMix').oninput = () => { P.earMix = +$('tnMix').value; $('tnMix').parentElement.querySelector('output').textContent = P.earMix.toFixed(2); };
    $('tnViews').innerHTML = Object.keys(VIEWS).map(k => `<button class="small" data-v="${k}">${NAMES[k]}</button>`).join('');
    $('tnViews').querySelectorAll('button').forEach(b => b.onclick = () => setView(b.dataset.v));
    P.earMix = +$('tnMix').value; setView('chladni');
    Stimuli.setEarSampler(sample);
    requestAnimationFrame(draw);
  }
  function setView(v) {
    P.earView = v; $('tnViewNote').textContent = VIEWS[v];
    $('tnViews').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    recompute();
  }
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

  // ---------------------------------------------------------------- incoming ear state
  function onState(m) {
    rates = m.rates; frames++;
    const n = m.coch.length / (2 * NB);
    for (let k = 0; k < n; k++) {
      const f = m.coch.subarray(k * 2 * NB, (k + 1) * 2 * NB);
      // 5 ms loudness in three ranges per ear, for the rhythm rose
      for (let e = 0; e < 2; e++) for (let g = 0; g < 3; g++) { let s = 0; for (let b = g * 11; b < Math.min(NB, g * 11 + 11); b++) s += f[e * NB + b]; hist[hHead * 6 + e * 3 + g] = s; }
      hHead = (hHead + 1) % HN;
      for (let b = 0; b < 2 * NB; b++) bandV[b] += (env2v(f[b]) - bandV[b]) * 0.25;
      if (!pend) { pend = f.slice(); continue; }
      for (let b = 0; b < 2 * NB; b++) { const e = 0.5 * (pend[b] + f[b]); coch[cHead * 2 * NB + b] = e; cochV[cHead * 2 * NB + b] = env2v(e); }
      cHead = (cHead + 1) % CT; pend = null;
    }
    recompute();
  }
  function recompute() {
    if (!frames || !P) return;
    ({coch: fCoch, brain: fBrain, chladni: fChladni, ripples: fRipples, helix: fHelix, rhythm: fRhythm, glass: fGlass})[P.earView || 'coch']();
  }

  // ---------------------------------------------------------------- the pictures (each fills `field`, 0..1)
  const UV = new Float32Array(2 * GS * GS);      // pixel centres in eye coordinates
  let chl = null, rip = null, ripD = null, hel = null, rose = null;
  function buildTables() {
    for (let y = 0; y < GS; y++) for (let x = 0; x < GS; x++) { UV[2 * (y * GS + x)] = (x + 0.5) / GS * 2 - 1; UV[2 * (y * GS + x) + 1] = 1 - (y + 0.5) / GS * 2; }
    // Chladni: antisymmetric square-plate modes ordered by n^2 + m^2, one per band
    const modes = []; for (let n = 1; n < 12; n++) for (let m = 0; m < n; m++) modes.push([n, m]);
    modes.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));
    chl = new Float32Array(NB * GS * GS);
    for (let b = 0; b < NB; b++) {
      const [n, m] = modes[b + 1];
      for (let p = 0; p < GS * GS; p++) {
        const x = (UV[2 * p] + 1) / 2, y = (UV[2 * p + 1] + 1) / 2;
        chl[b * GS * GS + p] = Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) - Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y);
      }
    }
    // ripples: per pixel and ear, delay (in 10 ms columns) and ring phase per band
    rip = new Float32Array(2 * NB * GS * GS); ripD = new Uint8Array(2 * GS * GS);
    for (let p = 0; p < GS * GS; p++) for (let e = 0; e < 2; e++) {
      const d = Math.hypot(UV[2 * p] - (e ? 0.7 : -0.7), UV[2 * p + 1]);
      ripD[e * GS * GS + p] = Math.min(CT - 1, Math.round(d * 50));          // 1 unit of distance = 0.5 s
      for (let b = 0; b < NB; b++) {
        const lam = 0.5 * Math.pow(FLO / bandHz(b), 0.5);                       // rings tighten with pitch
        rip[(e * NB + b) * GS * GS + p] = Math.cos(2 * Math.PI * d / lam) / (1 + 2.5 * d);
      }
    }
    // helix: which band (fractional) and how close to the spiral arm, per pixel; left ear on the left half
    hel = new Float32Array(3 * GS * GS);
    const oct = Math.log2(FHI / FLO), r0 = 0.12, dr = (0.95 - r0) / oct;
    for (let p = 0; p < GS * GS; p++) {
      const u = UV[2 * p], v = UV[2 * p + 1], e = u < 0 ? 0 : 1, r = Math.hypot(u, v);
      let th = Math.atan2(v, Math.abs(u)) / (2 * Math.PI); if (th < 0) th += 1;
      const k = Math.round((r - r0) / dr - th), s = th + k, rr = r0 + s * dr;
      hel[3 * p] = e; hel[3 * p + 1] = s >= 0 && s <= oct ? s / oct * (NB - 1) : -1; hel[3 * p + 2] = Math.exp(-(((r - rr) / (0.36 * dr)) ** 2));
    }
    // rhythm rose: petal (ear x range) and lag per pixel
    rose = new Float32Array(3 * GS * GS);
    for (let p = 0; p < GS * GS; p++) {
      const u = UV[2 * p], v = UV[2 * p + 1], r = Math.hypot(u, v);
      const e = u < 0 ? 0 : 1, a = Math.atan2(v, Math.abs(u));             // -pi/2 .. pi/2 on each side
      const g = Math.min(2, Math.floor((a + Math.PI / 2) / (Math.PI / 3)));  // low at the bottom, high at the top
      const centre = -Math.PI / 2 + (g + 0.5) * Math.PI / 3, w = Math.cos((a - centre) * 3 / 2);
      rose[3 * p] = e * 3 + g; rose[3 * p + 1] = r * 40; rose[3 * p + 2] = r <= 1 ? Math.max(0, w) ** 0.6 : 0;
    }
  }
  function fCoch() {
    // the last 1 s, newest at the right
    for (let y = 0; y < GS; y++) {
      const b = Math.min(NB - 1, Math.floor((1 - (y + 0.5) / GS) * NB));
      for (let x = 0; x < GS; x++) {
        const c = (cHead - 100 + Math.floor(x / GS * 100) + CT) % CT;
        field[y * GS + x] = env2v(Math.max(coch[c * 2 * NB + b], coch[c * 2 * NB + NB + b]));
      }
    }
  }
  function fBrain() {
    if (!meta || !rates) return;
    field.fill(0);
    const span = Math.max(bx1 - bx0, by1 - by0);
    for (let i = 0; i < meta.n; i++) {
      const r = rates[i]; if (r < 0.01) continue;
      const gx = Math.round(((meta.x[i] - (bx0 + bx1) / 2) / span + 0.5) * (GS - 1)), gy = Math.round((0.5 - (meta.y[i] - (by0 + by1) / 2) / span) * (GS - 1));
      if (gx >= 0 && gy >= 0 && gx < GS && gy < GS) field[gy * GS + gx] += r;
    }
    for (let k = 0; k < 4; k++) blur(field, GS, GS);
    let mx = 0; for (let i = 0; i < field.length; i++) if (field[i] > mx) mx = field[i];
    brainMax = Math.max(0.02, mx > brainMax ? mx : brainMax * 0.97 + mx * 0.03);
    for (let i = 0; i < field.length; i++) field[i] = Math.sqrt(Math.min(1, field[i] / brainMax));
  }
  function fChladni() {
    const a = new Float32Array(NB); let tot = 0;
    for (let b = 0; b < NB; b++) { a[b] = Math.max(bandV[b], bandV[NB + b]) ** 2; tot += a[b]; }
    if (tot < 1e-3) { field.fill(0); return; }
    const z = new Float32Array(GS * GS);
    for (let b = 0; b < NB; b++) { if (a[b] < 1e-3) continue; const w = a[b] / tot, o = b * GS * GS; for (let p = 0; p < GS * GS; p++) z[p] += w * chl[o + p]; }
    const loud = Math.min(1, Math.sqrt(tot / 4));
    for (let p = 0; p < GS * GS; p++) field[p] = loud * Math.exp(-((z[p] / 0.12) ** 2));
  }
  function fRipples() {
    const z = new Float32Array(GS * GS);
    for (let e = 0; e < 2; e++) for (let b = 0; b < NB; b++) {
      const o = (e * NB + b) * GS * GS;
      for (let p = 0; p < GS * GS; p++) {
        const amp = cochV[((cHead - 1 - ripD[e * GS * GS + p] + CT) % CT) * 2 * NB + e * NB + b];
        if (amp > 0.02) z[p] += amp * rip[o + p];
      }
    }
    for (let p = 0; p < GS * GS; p++) field[p] = Math.max(0, Math.min(1, Math.abs(z[p]) / 2.5));
  }
  function fHelix() {
    for (let p = 0; p < GS * GS; p++) {
      const bf = hel[3 * p + 1]; if (bf < 0) { field[p] = 0; continue; }
      const e = hel[3 * p], b0 = Math.floor(bf), b1 = Math.min(NB - 1, b0 + 1), t = bf - b0;
      const bv = (1 - t) * bandV[e * NB + b0] + t * bandV[e * NB + b1];
      field[p] = hel[3 * p + 2] * bv * bv;   // squared: loud bands stand out from the floor
    }
  }
  function fRhythm() {
    // autocorrelation of each petal's loudness over the last second, lags 0..40 frames (0..200 ms)
    const ac = new Float32Array(6 * 41);
    for (let q = 0; q < 6; q++) {
      let mean = 0; for (let i = 0; i < HN; i++) mean += hist[i * 6 + q]; mean /= HN;
      let v0 = 0; for (let i = 0; i < HN; i++) v0 += (hist[i * 6 + q] - mean) ** 2;
      if (v0 < 1e-9) continue;
      for (let L = 0; L <= 40; L++) {
        let s = 0; for (let i = L; i < HN; i++) s += (hist[((hHead + i) % HN) * 6 + q] - mean) * (hist[((hHead + i - L) % HN) * 6 + q] - mean);
        ac[q * 41 + L] = Math.max(0, s / v0);
      }
    }
    for (let p = 0; p < GS * GS; p++) {
      const w = rose[3 * p + 2]; if (!w) { field[p] = 0; continue; }
      const q = rose[3 * p], lf = rose[3 * p + 1], L0 = Math.floor(lf), t = lf - L0;
      field[p] = w * ((1 - t) * ac[q * 41 + L0] + t * ac[q * 41 + Math.min(40, L0 + 1)]);
    }
  }
  // stained glass: Voronoi panes, one per (cell type, side), seeded on rings by step
  let paneOf = null, paneEdge = null, paneMembers = null, paneAct = null, paneTier = null, glassMax = 0.05;
  function buildGlass() {
    const groups = new Map(); let i = 0;
    meta.tiers.forEach((n, t) => { for (let k = 0; k < n; k++, i++) { const key = t + '|' + (meta.type[i] || 'untyped') + '|' + meta.side[i]; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); } });
    const keys = [...groups.keys()].sort(), seeds = [];
    const rings = [[0.04, 0.24], [0.28, 0.56], [0.6, 0.8], [0.83, 0.98]];
    for (let t = 0; t < 4; t++) for (const side of ['L', 'R', 'C']) {
      const ks = keys.filter(k => k.startsWith(t + '|') && k.endsWith('|' + side)); if (!ks.length) continue;
      ks.forEach((k, j) => {
        // spread along this side's half of the ring, radius jittered within the ring's band (golden ratio)
        const f = (j + 0.5) / ks.length, r = rings[t][0] + (rings[t][1] - rings[t][0]) * ((j * 0.618034) % 1);
        const a = (f - 0.5) * Math.PI * 0.96, x = Math.cos(a) * r * (side === 'L' ? -1 : side === 'R' ? 1 : 0.2), y = Math.sin(a) * r;
        seeds.push({x, y, members: groups.get(k), t});
      });
    }
    paneOf = new Int32Array(GS * GS); paneEdge = new Float32Array(GS * GS);
    for (let p = 0; p < GS * GS; p++) {
      const u = UV[2 * p], v = UV[2 * p + 1]; let d1 = 1e9, d2 = 1e9, best = -1;
      for (let s = 0; s < seeds.length; s++) { const d = (seeds[s].x - u) ** 2 + (seeds[s].y - v) ** 2; if (d < d1) { d2 = d1; d1 = d; best = s; } else if (d < d2) d2 = d; }
      paneOf[p] = Math.hypot(u, v) <= 1 ? best : -1; paneEdge[p] = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) * 60);   // dark leading between panes
    }
    paneMembers = seeds.map(s => s.members); paneAct = new Float32Array(seeds.length); paneTier = seeds.map(s => s.t);
  }
  function fGlass() {
    if (!paneOf || !rates) return;
    let mx = 0;
    for (let s = 0; s < paneMembers.length; s++) { let a = 0; for (const i of paneMembers[s]) a += rates[i]; paneAct[s] = a / paneMembers[s].length; if (paneAct[s] > mx) mx = paneAct[s]; }
    glassMax = Math.max(0.02, mx > glassMax ? mx : glassMax * 0.97 + mx * 0.03);
    for (let s = 0; s < paneAct.length; s++) paneAct[s] = Math.sqrt(Math.min(1, paneAct[s] / glassMax));   // relative to the loudest pane lately
    for (let p = 0; p < GS * GS; p++) field[p] = paneOf[p] < 0 ? 0 : paneAct[paneOf[p]] * paneEdge[p];
  }
  function blur(g, w, h) {
    const t = new Float32Array(g.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += g[y * w + xx] * (d ? 1 : 2); n += d ? 1 : 2; } } t[y * w + x] = s / n; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += t[yy * w + x] * (d ? 1 : 2); n += d ? 1 : 2; } } g[y * w + x] = s / n; }
  }
  // what the eye sees of the ear, at eye position (u, v) in [-1, 1] (v up): 0 (silence) .. 1
  function sample(u, v) {
    if (!frames) return 0;
    const fx = (u + 1) / 2 * GS - 0.5, fy = (1 - v) / 2 * GS - 0.5;
    if (fx < 0 || fy < 0 || fx > GS - 1 || fy > GS - 1) return 0;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(GS - 1, x0 + 1), y1 = Math.min(GS - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    return (1 - ay) * ((1 - ax) * field[y0 * GS + x0] + ax * field[y0 * GS + x1]) + ay * ((1 - ax) * field[y1 * GS + x0] + ax * field[y1 * GS + x1]);
  }

  // ---------------------------------------------------------------- drawing in the card
  function draw() { requestAnimationFrame(draw); drawCoch(); drawArt(); }
  let cImg = null;
  function inferno(v) { return [255 * Math.min(1, 0.05 + 1.25 * v), 255 * Math.max(0, Math.min(1, 1.4 * v - 0.35)), 255 * Math.max(0.08, Math.min(1, 0.45 * (1 - v) + 1.6 * Math.max(0, v - 0.75)))]; }
  function drawCoch() {
    const c = $('tnCoch'); if (!c) return;
    const x = c.getContext('2d'), W = c.width, H = c.height;
    if (!cImg) cImg = x.createImageData(CT, 2 * NB + 2);
    const d = cImg.data;
    for (let col = 0; col < CT; col++) {
      const src = (cHead + col) % CT;
      for (let e = 0; e < 2; e++) for (let b = 0; b < NB; b++) {
        const [r, g, bl] = inferno(env2v(coch[src * 2 * NB + e * NB + b])), o = 4 * ((e * (NB + 2) + (NB - 1 - b)) * CT + col);
        d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = 255;
      }
      for (const row of [NB, NB + 1]) { const o = 4 * (row * CT + col); d[o] = d[o + 1] = d[o + 2] = 14; d[o + 3] = 255; }
    }
    const tmp = drawCoch.t || (drawCoch.t = Object.assign(document.createElement('canvas'), {width: CT, height: 2 * NB + 2}));
    tmp.getContext('2d').putImageData(cImg, 0, 0);
    x.imageSmoothingEnabled = false; x.drawImage(tmp, 0, 0, W, H);
    x.fillStyle = '#cfccc4'; x.font = '11px -apple-system, Segoe UI, sans-serif';
    x.fillText('left antenna', 8, 14); x.fillText('right antenna', 8, H / 2 + 16);
    x.fillStyle = '#8d8a83'; x.textAlign = 'right'; x.fillText(`${FHI} Hz`, W - 6, 12); x.fillText(`${FLO} Hz`, W - 6, H / 2 - 6); x.textAlign = 'left';
  }
  let aImg = null;
  function drawArt() {
    const c = $('tnArt'); if (!c || !P) return;
    const x = c.getContext('2d'), view = P.earView;
    if (view === 'brain' && meta) { drawBrainDots(x, c.width, c.height); return; }
    if (!aImg) aImg = x.createImageData(GS, GS);
    const d = aImg.data;
    for (let p = 0; p < GS * GS; p++) {
      const v = field[p]; let col;
      if ((view === 'helix' && hel[3 * p + 1] < 0) || (view === 'glass' && (!paneOf || paneOf[p] < 0)) || (view === 'rhythm' && !rose[3 * p + 2])) col = [8, 9, 11];
      else if (view === 'helix') {
        // colour shows chroma (position within the octave); brightness, the variable the eye gets, shows loudness
        const s = hel[3 * p + 1] / (NB - 1) * Math.log2(FHI / FLO);
        col = hsl((s % 1) * 360, 0.8, 0.04 + 0.62 * Math.sqrt(v));
      } else if (view === 'glass') {
        const [r, g, b] = TIER_COL[paneTier[paneOf[p]]], k = 0.1 + 0.9 * (paneAct[paneOf[p]] || 0), e = paneEdge[p];
        col = [r * k * e + 8 * (1 - e), g * k * e + 8 * (1 - e), b * k * e + 10 * (1 - e)];
      } else if (view === 'chladni') col = [16 + 235 * v, 18 + 215 * v, 30 + 170 * v];
      else if (view === 'ripples') col = [10 + 90 * v, 20 + 200 * v, 30 + 210 * v];
      else if (view === 'rhythm') col = [20 + 230 * v, 14 + 140 * v * v, 40 + 160 * v];
      else col = inferno(v);
      d[4 * p] = col[0]; d[4 * p + 1] = col[1]; d[4 * p + 2] = col[2]; d[4 * p + 3] = 255;
    }
    const tmp = drawArt.t || (drawArt.t = Object.assign(document.createElement('canvas'), {width: GS, height: GS}));
    tmp.getContext('2d').putImageData(aImg, 0, 0);
    x.imageSmoothingEnabled = true; x.drawImage(tmp, 0, 0, c.width, c.height);
  }
  function hsl(h, s, l) {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [255 * f(0), 255 * f(8), 255 * f(4)];
  }
  function drawBrainDots(x, W, H) {
    x.fillStyle = '#08090b'; x.fillRect(0, 0, W, H);
    const span = Math.max(bx1 - bx0, by1 - by0);
    const sx = v => ((v - (bx0 + bx1) / 2) / span + 0.5) * W, sy = v => (0.5 - (v - (by0 + by1) / 2) / span) * H;
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
  return {init, onAudioStart, setView, get frames() { return frames; }, get attached() { return attached; }, get rates() { return rates; }};
})();
