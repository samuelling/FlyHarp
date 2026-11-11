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
//
// Lenses: like the eye's lenses, the pictures can be fed from any stage of the auditory hierarchy instead of the
// raw antennae. Each area (grouped by the neuropil holding most of a neuron's input synapses) or cell type is read
// out as a band profile: the mean rate of its cells, weighted by how much each listens to each antenna and band
// (inherited through the wiring, EarNet.tuning). Shape, brightness and colour of a picture can each follow a
// different population.
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
  let meta = null, worker = null, ready = false, attached = false, rates = null, frames = 0, P = null, T = null;
  // ---------------------------------------------------------------- the auditory hierarchy, as lenses
  const SND = new Set(['A', 'B', 'D', 'X']);
  const AREAS = [
    {id: 'sound', row: 1, c: 2, name: 'Sound', sub: 'JO-A, B, D: vibration', col: '#4fb3a4', test: i => i < meta.tiers[0] && SND.has(meta.jo[i]),
      info: 'Johnston\'s organ, in the antenna\'s second segment: stretch-sensitive neurons that follow the vibration of the feathery arista. JO-A prefer higher frequencies and adapt fast; JO-B lower ones and stay on. Courtship song, a hum near 150 Hz and pulses about 35 ms apart, lands here. In the model each cell gets a best frequency within its group\'s range, so this lens is close to a cochleogram cut down to the fly\'s hearing range.'},
    {id: 'wind', row: 1, c: 3, name: 'Wind & gravity', sub: 'JO-C, E, F: deflection', col: '#7fb0d8', test: i => i < meta.tiers[0] && !SND.has(meta.jo[i]),
      info: 'The Johnston\'s organ neurons that report a sustained push of the antenna (wind and gravity, groups C and E) and the ventral F group. They carry no pitch, so every band looks the same through this lens: only loudness and its slow changes come through. A speaker does not blow wind, so here they follow the slow envelope of the sound, a stand-in.'},
    {id: 'ammc', row: 2, c: 2, name: 'AMMC', sub: 'first relay of sound', col: '#e0c35a', np: ['AMMC'],
      info: 'The antennal mechanosensory and motor centre, where the vibration-sensitive JO-A and JO-B axons end. Its cells still keep mostly to one antenna and to the frequencies of their inputs. In FlyWire their strongest outputs go on to the ventrolateral protocerebrum and the wedge.'},
    {id: 'sad', row: 2, c: 3, name: 'Saddle', sub: 'SAD: wind, gravity, to the body', col: '#d39a4a', np: ['SAD'],
      info: 'The saddle wraps around the AMMC and takes most of the wind and gravity input, along with many descending neurons that carry it straight to the body (105 here). It sends excitation on to the wedge and the ventrolateral areas and inhibits the posterior slope. Through this lens, pitch blurs: these cells listen broadly.'},
    {id: 'wed', row: 3, c: 2, name: 'Wedge', sub: 'WED: the two ears meet', col: '#e88a4f', np: ['WED'],
      info: 'The wedge integrates the two antennae: its cells mix left and right far more than the AMMC does (wedge-to-wedge neurons, WV-WV, link the two sides directly). It is a hub between the first relays and the higher song areas. Through this lens, which side the sound came from starts to dissolve into what it was.'},
    {id: 'gng', row: 3, c: 3, name: 'Gnathal ganglia', sub: 'GNG: toward the body', col: '#b98ad8', np: ['GNG'],
      info: 'The gnathal ganglia sit below the brain, where many descending neurons start (118 of the cells here). The antennae reach motor control through this route quickly, without passing through the higher song areas first.'},
    {id: 'vlp', row: 4, c: 2, name: 'Ventrolateral', sub: 'AVLP, PVLP: song', col: '#e2576b', np: ['AVLP', 'PVLP'],
      info: 'The anterior and posterior ventrolateral protocerebrum, where the song\'s pattern is thought to be recognised: song-pattern detectors and courtship decision cells have been found in the AVLP. Most cells here are three or four synapses from the ear, listen broadly and mix both sides. What survives through this lens is timing more than pitch.'},
    {id: 'slope', row: 4, c: 3, name: 'Posterior slope', sub: 'IPS, SPS: steering', col: '#c46a9a', np: ['IPS', 'SPS'],
      info: 'The inferior and superior posterior slope: premotor areas for head and flight steering, where antennal wind and gravity signals meet optic flow from the eyes. The largest auditory population in this model (711 cells), and the one that mixes the two ears most.'},
    {id: 'vision', row: 4, c: 4, name: 'Toward vision', sub: 'PLP, optic lobe', col: '#5aa6e8', np: ['PLP', 'ME', 'LO', 'LOP', 'OCG'],
      info: 'Cells that get most of their input in the posterior lateral protocerebrum or the optic lobes, yet are reached from the ear: the connectome\'s own crossing between hearing and seeing, the two senses this instrument mixes. Fed mainly by the wedge, they pass on to the posterior slope.'},
  ];
  const EAR_STAGES = ['Antenna', 'First relay', 'Integration', 'Output'];
  // area-to-area synapses in this model (FlyWire v783); dashed blue: net inhibitory
  const EAR_EDGES = [['sound', 'ammc', 4388], ['sound', 'sad', 9508], ['wind', 'sad', 40276], ['wind', 'ammc', 7591], ['ammc', 'wed', 18708], ['sad', 'wed', 25854],
    ['wed', 'vlp', -8129], ['gng', 'slope', -3707], ['ammc', 'vlp', 26191, 'left'], ['wind', 'gng', 6733, 'right'], ['wind', 'slope', 5547, 'right2'], ['wed', 'vision', 4256], ['vision', 'slope', 5720, 'side']];
  let areaOf = null, areaIdx = {}, earLens = 'sound', earType = null;
  const MAP = {shape: 'lens', bright: 'same', colour: 'own'};
  let popKeys = [], popGen = 0, popMax = [], lvMax = [], popLv = [], popProf = [];
  const areaLvl = {};
  const cochV = new Float32Array(CT * 2 * NB);   // ring buffer of 10 ms columns (left bands, right bands), 0..1:
                                                 // loudness at the antennae, or the lens population's read-out
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
    worker.onmessage = e => { const m = e.data; if (m.cmd === 'ready') { ready = true; T = m.T; status(); sendPops(); renderEarLenses(); } else if (m.cmd === 'state') onState(m); };
    buildTables();
    fetch('data/ear.json' + V).then(r => r.json()).then(j => {
      meta = j;
      const pad = 0.06; bx0 = Math.min(...j.x) - pad; bx1 = Math.max(...j.x) + pad; by0 = Math.min(...j.y) - pad; by1 = Math.max(...j.y) + pad;
      $('tnStats').textContent = `${j.n.toLocaleString()} neurons: ${j.tiers[0].toLocaleString()} Johnston's organ neurons (both antennae), then ${j.tiers.slice(1).map(x => x.toLocaleString()).join(', ')} at the 2nd, 3rd and 4th steps · ${j.synapses.toLocaleString()} synapses (FlyWire v783)`;
      buildGlass(); buildAreas(); renderEarLenses();
      worker.postMessage({cmd: 'init', json: new URL('data/ear.json' + V, location.href).href, bin: new URL('data/ear.bin' + V, location.href).href});
    });
    $('tnSource').onchange = applySource; $('tnLevel').oninput = applySource;
    $('tnGain').oninput = () => { worker.postMessage({cmd: 'gain', G: +$('tnGain').value}); $('tnGain').parentElement.querySelector('output').textContent = $('tnGain').value; };
    $('tnMix').oninput = () => { P.earMix = +$('tnMix').value; $('tnMix').parentElement.querySelector('output').textContent = P.earMix.toFixed(2); };
    $('tnViews').innerHTML = Object.keys(VIEWS).map(k => `<button class="small" data-v="${k}">${NAMES[k]}</button>`).join('');
    $('tnViews').querySelectorAll('button').forEach(b => b.onclick = () => setView(b.dataset.v));
    P.earMix = +$('tnMix').value; setView('chladni');
    for (const k of ['shape', 'bright', 'colour']) $('em_' + k).onchange = () => { MAP[k] = $('em_' + k).value; sendPops(); renderEarLenses(); };
    new ResizeObserver(() => drawEarWires()).observe($('earLenses'));
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
    if (meta && areaOf) {
      const sum = {}, n = {};
      for (let i = 0; i < meta.n; i++) { const a = areaOf[i]; sum[a] = (sum[a] || 0) + rates[i]; n[a] = (n[a] || 0) + 1; }
      for (const a in sum) areaLvl[a] = sum[a] / n[a];
    }
    const nf = m.coch.length / (2 * NB), K = 2 * NB, PK = K + 1, np = m.gen === popGen && m.npop && m.pv.length === nf * m.npop * PK ? m.npop : 0, sq = popKeys.indexOf(MAP.shape === 'lens' ? lensKey() : MAP.shape);
    const fv = new Float32Array(K);
    for (let k = 0; k < nf; k++) {
      // population read-outs, each scaled to its own recent peak so quiet deep areas still fill the picture
      for (let q = 0; q < np; q++) {
        const o = (k * np + q) * PK; let mx = 0;
        for (let b = 0; b < K; b++) if (m.pv[o + b] > mx) mx = m.pv[o + b];
        popMax[q] = Math.max(1e-6, popMax[q] * 0.999, mx); lvMax[q] = Math.max(1e-6, lvMax[q] * 0.999, m.pv[o + K]);
        popLv[q] = m.pv[o + K] / lvMax[q];
        const pr = popProf[q] || (popProf[q] = new Float32Array(K)); for (let b = 0; b < K; b++) pr[b] += (m.pv[o + b] / popMax[q] - pr[b]) * 0.2;
      }
      // the stream that shapes the pictures: the raw antennae, or the lens population
      if (sq >= 0 && sq < np) { const o = (k * np + sq) * PK; for (let b = 0; b < K; b++) fv[b] = Math.min(1, m.pv[o + b] / popMax[sq]); }
      else { const f = m.coch.subarray(k * K, (k + 1) * K); for (let b = 0; b < K; b++) fv[b] = env2v(f[b]); }
      // 5 ms loudness in three ranges per ear, for the rhythm rose
      for (let e = 0; e < 2; e++) for (let g = 0; g < 3; g++) { let sm = 0; for (let b = g * 11; b < Math.min(NB, g * 11 + 11); b++) sm += fv[e * NB + b]; hist[hHead * 6 + e * 3 + g] = sm; }
      hHead = (hHead + 1) % HN;
      for (let b = 0; b < K; b++) bandV[b] += (fv[b] - bandV[b]) * 0.25;
      if (!pend) { pend = fv.slice(); continue; }
      for (let b = 0; b < K; b++) cochV[cHead * K + b] = 0.5 * (pend[b] + fv[b]);
      cHead = (cHead + 1) % CT; pend = null;
    }
    recompute();
  }
  // ---------------------------------------------------------------- lenses: populations, read-outs, the panel
  function buildAreas() {
    areaOf = new Array(meta.n);
    for (let i = 0; i < meta.n; i++) {
      let a = 'other';
      for (const A of AREAS) if (A.test ? A.test(i) : A.np.includes(meta.np[i])) { a = A.id; break; }
      areaOf[i] = a;
    }
    areaIdx = {}; areaOf.forEach((a, i) => (areaIdx[a] = areaIdx[a] || []).push(i));
  }
  const lensKey = () => earLens === 'all' ? 'all' : earType ? `type:${earLens}:${earType}` : earLens;
  function members(key) {
    if (key === 'all') return Array.from({length: meta.n}, (_, i) => i);
    if (key.startsWith('type:')) { const [, a, t] = key.split(':'); return (areaIdx[a] || []).filter(i => meta.type[i] === t); }
    return areaIdx[key] || [];
  }
  const resolve = k => k === 'lens' ? lensKey() : k;
  let shapeMask = null;
  function sendPops() {
    if (!meta || !areaOf) return;
    const want = [resolve(MAP.shape), MAP.bright === 'same' ? null : resolve(MAP.bright), MAP.colour === 'own' ? null : resolve(MAP.colour)].filter(k => k && k !== 'antenna');
    popKeys = [...new Set(want)]; popGen++;
    popMax = popKeys.map(() => 1e-6); lvMax = popKeys.map(() => 1e-6); popLv = popKeys.map(() => 0); popProf = popKeys.map(() => new Float32Array(2 * NB));
    const sk = resolve(MAP.shape);
    shapeMask = new Uint8Array(meta.n); if (sk === 'antenna') shapeMask.fill(1); else for (const i of members(sk)) shapeMask[i] = 1;
    if (ready) worker.postMessage({cmd: 'pops', gen: popGen, pops: popKeys.map(k => Int32Array.from(members(k)))});
  }
  const popIdx = k => popKeys.indexOf(resolve(k));
  function levelOf(k) { const q = popIdx(k); if (q >= 0) return popLv[q] || 0; let s = 0; for (let b = 0; b < 2 * NB; b++) s += bandV[b]; return s / (2 * NB); }
  function brightGain() {
    if (MAP.bright === 'same' || resolve(MAP.bright) === resolve(MAP.shape)) return 1;
    return Math.min(1.6, levelOf(MAP.bright) / Math.max(0.08, levelOf(MAP.shape)));
  }
  function tint() {
    // colour (on screen only; the eye is colour-blind here): hue from the population's pitch centre, low red to high violet,
    // saturation from how active it is now
    if (MAP.colour === 'own') return null;
    const q = popIdx(MAP.colour); const pr = q >= 0 ? popProf[q] : bandV;
    let s = 0, c = 0; for (let b = 0; b < 2 * NB; b++) { s += pr[b]; c += pr[b] * (b % NB); }
    const cen = s > 1e-6 ? c / s / (NB - 1) : 0.5;
    return {h: 10 + 270 * cen, s: 0.25 + 0.7 * Math.min(1, levelOf(MAP.colour))};
  }
  function areaName(k) {
    if (k === 'antenna') return 'the antennae'; if (k === 'all') return 'the whole network';
    if (k.startsWith('type:')) return k.split(':')[2];
    const A = AREAS.find(a => a.id === k); return A ? A.name : k;
  }
  // tuning summary of a population: how one-sided, and its central band range (from the inherited profiles)
  function tuneStats(idx) {
    if (!T || !idx.length) return null;
    const K = 2 * NB, prof = new Float64Array(NB); let lat = 0;
    for (const i of idx) { let L = 0; for (let b = 0; b < NB; b++) { L += T[i * K + b]; prof[b] += T[i * K + b] + T[i * K + NB + b]; } lat += Math.abs(2 * L - 1); }
    let tot = 0; for (let b = 0; b < NB; b++) tot += prof[b];
    let acc = 0, lo = 0, hi = NB - 1, f1 = false;
    for (let b = 0; b < NB; b++) { acc += prof[b] / tot; if (!f1 && acc >= 0.25) { lo = b; f1 = true; } if (acc >= 0.75) { hi = b; break; } }
    return {lat: lat / idx.length, lo: Math.round(bandHz(lo)), hi: Math.round(bandHz(hi))};
  }
  function upstream(id) {
    const out = new Set([id]); let grew = true;
    while (grew) { grew = false; for (const [a, b] of EAR_EDGES) if (out.has(b) && !out.has(a)) { out.add(a); grew = true; } }
    return out;
  }
  function renderEarLenses() {
    const box = $('earLenses'); if (!box || !meta || !areaOf) return;
    const lit = earLens === 'all' ? new Set(AREAS.map(a => a.id)) : upstream(earLens);
    box.innerHTML = EAR_STAGES.map((t, i) => `<span class="stage" style="grid-row:${i + 1}">${t}</span>`).join('') +
      AREAS.map(A => `<button class="lens ${A.id === earLens ? 'on' : lit.has(A.id) ? 'path' : ''}" data-l="${A.id}" style="grid-area:${A.row}/${A.c}/${A.row + 1}/${A.c + 1}"><i class="bar" style="background:${A.col}"></i><b>${A.name}</b><span>${A.sub}</span><em class="n">${(areaIdx[A.id] || []).length.toLocaleString()} cells</em></button>`).join('') +
      '<svg class="wires" aria-hidden="true"></svg>';
    box.querySelectorAll('.lens').forEach(b => b.onclick = () => { earLens = b.dataset.l; earType = null; sendPops(); renderEarLenses(); });
    $('earAll').classList.toggle('on', earLens === 'all');
    $('earAll').onclick = () => { earLens = 'all'; earType = null; sendPops(); renderEarLenses(); };
    drawEarWires();
    const A = AREAS.find(a => a.id === earLens);
    const idx = members(lensKey()), st = tuneStats(idx);
    $('earLensInfo').textContent = A ? A.info : 'All 4,222 neurons of the model at once: every step, every area, both sides. Through this lens the picture shows what the whole network is doing, which is mostly the loudest, earliest part of it.';
    $('earLensTag').textContent = areaName(lensKey());
    // cell types in this area, most numerous first, as chips (like the instrument's hierarchy)
    const pool = earLens === 'all' ? [] : areaIdx[earLens] || [];
    const cnt = {}; for (const i of pool) { const t = meta.type[i] || ''; if (t) cnt[t] = (cnt[t] || 0) + 1; }
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $('earTypes').innerHTML = pool.length ? `<span class="k">cell types</span><button class="chip ${!earType ? 'on' : ''}" data-t="">all ${pool.length}</button>` +
      top.map(([t, n]) => { const nk = pool.find(i => meta.type[i] === t && meta.nick && meta.nick[i]); return `<button class="chip ${earType === t ? 'on' : ''}" data-t="${t}">${t}${nk !== undefined ? ` <i>${meta.nick[nk]}</i>` : ''} <em>${n}</em></button>`; }).join('') : '';
    $('earTypes').querySelectorAll('.chip').forEach(b => b.onclick = () => { earType = b.dataset.t || null; sendPops(); renderEarLenses(); });
    $('earLensStats').innerHTML = st ? `<b>${idx.length.toLocaleString()}</b> cells · listens mostly to <b>${st.lo}–${st.hi} Hz</b> · ${st.lat > 0.75 ? 'one antenna' : st.lat > 0.4 ? 'mostly one antenna' : 'both antennae'} (laterality ${st.lat.toFixed(2)})` : '';
    // feature mapping: refresh option lists
    const opts = (extra) => extra.concat([['lens', `the lens: ${areaName(lensKey())}`], ['all', 'the whole network']], AREAS.map(a => [a.id, a.name])).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    $('em_shape').innerHTML = opts([['antenna', 'the antennae, before any neuron']]); $('em_shape').value = MAP.shape;
    $('em_bright').innerHTML = opts([['same', 'follows the shape']]); $('em_bright').value = MAP.bright;
    $('em_colour').innerHTML = opts([['own', 'the picture\'s own palette']]); $('em_colour').value = MAP.colour;
    $('earMapNote').textContent = MAP.shape === 'lens' && MAP.bright === 'same' && MAP.colour === 'own' ? 'Everything follows the lens. Map a feature to another area to see two stages of hearing at once.' :
      `Shape from ${areaName(resolve(MAP.shape))}${MAP.bright !== 'same' ? `, brightness from ${areaName(resolve(MAP.bright))}` : ''}${MAP.colour !== 'own' ? `, colour from ${areaName(resolve(MAP.colour))} (on screen only: the eye here sees in grey)` : ''}.`;
  }
  function drawEarWires() {
    const box = $('earLenses'), svg = box && box.querySelector('.wires'); if (!svg) return;
    const lit = earLens === 'all' ? new Set(AREAS.map(a => a.id)) : upstream(earLens);
    const R = box.getBoundingClientRect(); if (!R.width) return;
    const r = id => { const q = box.querySelector(`[data-l="${id}"]`).getBoundingClientRect(); return {l: q.left - R.left, r: q.right - R.left, t: q.top - R.top, b: q.bottom - R.top, cx: (q.left + q.right) / 2 - R.left, cy: (q.top + q.bottom) / 2 - R.top}; };
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    const head = (x, y, ang) => { const a = 5; return `M${x},${y} L${x - a * Math.cos(ang - .5)},${y - a * Math.sin(ang - .5)} M${x},${y} L${x - a * Math.cos(ang + .5)},${y - a * Math.sin(ang + .5)}`; };
    // the population at each stage, as a profile down the stage column (as for the eye): 1,104 ear cells, then
    // 773 first relays, 805 integrators and 1,483 at the output stage
    const n = id => (areaIdx[id] || []).length, rowsN = [n('sound') + n('wind'), n('ammc') + n('sad'), n('wed') + n('gng'), n('vlp') + n('slope') + n('vision')];
    const st = box.querySelector('.stage').getBoundingClientRect(), cx0 = (st.left + st.right) / 2 - R.left, wmax = Math.min(st.width, 64), max = Math.max(...rowsN);
    const rows = [['sound'], ['ammc'], ['wed'], ['vlp']].map(([id], i) => { const q = r(id); return {t: q.t + 6, b: q.b - 6, h: wmax * rowsN[i] / max / 2}; });
    let L = `M${cx0 - rows[0].h},${rows[0].t}`, Rt = '';
    rows.forEach((q, i) => { L += ` L${cx0 - q.h},${q.b}`; const nx = rows[i + 1]; if (nx) { const m = (q.b + nx.t) / 2; L += ` C${cx0 - q.h},${m} ${cx0 - nx.h},${m} ${cx0 - nx.h},${nx.t}`; } });
    for (let i = rows.length - 1; i >= 0; i--) { const q = rows[i]; Rt += ` L${cx0 + q.h},${q.b} L${cx0 + q.h},${q.t}`; const pv = rows[i - 1]; if (pv) { const m = (q.t + pv.b) / 2; Rt += ` C${cx0 + q.h},${m} ${cx0 + pv.h},${m} ${cx0 + pv.h},${pv.b}`; } }
    const glass = `<defs><linearGradient id="hgE" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fb3a4" stop-opacity=".4"/><stop offset=".35" stop-color="#e0c35a" stop-opacity=".35"/><stop offset=".65" stop-color="#e88a4f" stop-opacity=".35"/><stop offset="1" stop-color="#e2576b" stop-opacity=".4"/></linearGradient></defs><path class="glass" style="fill:url(#hgE)" d="${L}${Rt} Z"/>`;
    const sw = w => (1 + 2.2 * Math.sqrt(Math.abs(w) / 40276)).toFixed(2);
    svg.innerHTML = glass + EAR_EDGES.map(([a, b, w, kind]) => {
      const A = r(a), B = r(b), on = lit.has(a) && lit.has(b), cls = `${w < 0 ? 'inh' : ''} ${on ? 'lit' : ''}`, st = `stroke-width:${on ? (+sw(w) + 0.5) : sw(w)}`;
      let d, hd;
      if (kind === 'left') { const x = A.l - 6; d = `M${A.l},${A.cy} L${x},${A.cy} L${x},${B.cy} L${B.l},${B.cy}`; hd = head(B.l, B.cy, 0); }
      else if (kind === 'right' || kind === 'right2') { const x = A.r + (kind === 'right' ? 5 : 11), y0 = A.cy + (kind === 'right' ? -4 : 6); d = `M${A.r},${y0} L${x},${y0} L${x},${B.cy + (kind === 'right' ? 0 : -8)} L${B.r},${B.cy + (kind === 'right' ? 0 : -8)}`; hd = head(B.r, B.cy + (kind === 'right' ? 0 : -8), Math.PI); }
      else if (kind === 'side') { d = `M${A.l},${A.cy} L${B.r},${B.cy}`; hd = head(B.r, B.cy, Math.PI); }
      else { const x1 = A.cx + (B.cx - A.cx) * 0.18, x2 = B.cx - (B.cx - A.cx) * 0.18, y1 = A.b, y2 = B.t - 1, m = (y1 + y2) / 2; d = `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`; hd = head(x2, y2, Math.PI / 2); }
      return `<path class="${cls}" style="${st}" d="${d}"/><path class="hd ${cls}" d="${hd}"/>`;
    }).join('');
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
        field[y * GS + x] = Math.max(cochV[c * 2 * NB + b], cochV[c * 2 * NB + NB + b]);
      }
    }
  }
  function fBrain() {
    if (!meta || !rates) return;
    field.fill(0);
    const span = Math.max(bx1 - bx0, by1 - by0);
    for (let i = 0; i < meta.n; i++) {
      const r = rates[i]; if (r < 0.01 || (shapeMask && !shapeMask[i])) continue;
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
    for (let s = 0; s < paneMembers.length; s++) { let a = 0, n = 0; for (const i of paneMembers[s]) if (!shapeMask || shapeMask[i]) { a += rates[i]; n++; } paneAct[s] = n ? a / n : 0; if (paneAct[s] > mx) mx = paneAct[s]; }
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
    const val = (1 - ay) * ((1 - ax) * field[y0 * GS + x0] + ax * field[y0 * GS + x1]) + ay * ((1 - ax) * field[y1 * GS + x0] + ax * field[y1 * GS + x1]);
    return Math.min(1, val * bGain);
  }

  // ---------------------------------------------------------------- drawing in the card
  let bGain = 1;
  function draw() { requestAnimationFrame(draw); bGain = brightGain(); drawCoch(); drawArt(); }
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
        const [r, g, bl] = inferno(cochV[src * 2 * NB + e * NB + b]), o = 4 * ((e * (NB + 2) + (NB - 1 - b)) * CT + col);
        d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = 255;
      }
      for (const row of [NB, NB + 1]) { const o = 4 * (row * CT + col); d[o] = d[o + 1] = d[o + 2] = 14; d[o + 3] = 255; }
    }
    const tmp = drawCoch.t || (drawCoch.t = Object.assign(document.createElement('canvas'), {width: CT, height: 2 * NB + 2}));
    tmp.getContext('2d').putImageData(cImg, 0, 0);
    x.imageSmoothingEnabled = false; x.drawImage(tmp, 0, 0, W, H);
    x.fillStyle = '#cfccc4'; x.font = '11px -apple-system, Segoe UI, sans-serif';
    const who = MAP.shape === 'antenna' ? '' : ` · through ${areaName(resolve(MAP.shape))}`;
    x.fillText('left antenna' + who, 8, 14); x.fillText('right antenna' + who, 8, H / 2 + 16);
    x.fillStyle = '#8d8a83'; x.textAlign = 'right'; x.fillText(`${FHI} Hz`, W - 6, 12); x.fillText(`${FLO} Hz`, W - 6, H / 2 - 6); x.textAlign = 'left';
  }
  let aImg = null;
  function drawArt() {
    const c = $('tnArt'); if (!c || !P) return;
    const x = c.getContext('2d'), view = P.earView;
    if (view === 'brain' && meta) { drawBrainDots(x, c.width, c.height); return; }
    if (!aImg) aImg = x.createImageData(GS, GS);
    const d = aImg.data, tn = tint();
    for (let p = 0; p < GS * GS; p++) {
      const v = Math.min(1, field[p] * bGain); let col;
      if ((view === 'helix' && hel[3 * p + 1] < 0) || (view === 'glass' && (!paneOf || paneOf[p] < 0)) || (view === 'rhythm' && !rose[3 * p + 2])) col = [8, 9, 11];
      else if (tn) col = hsl(tn.h, tn.s, 0.03 + 0.72 * v);
      else if (view === 'helix') {
        // colour shows chroma (position within the octave); brightness, the variable the eye gets, shows loudness
        const s = hel[3 * p + 1] / (NB - 1) * Math.log2(FHI / FLO);
        col = hsl((s % 1) * 360, 0.8, 0.04 + 0.62 * Math.sqrt(v));
      } else if (view === 'glass') {
        const [r, g, b] = TIER_COL[paneTier[paneOf[p]]], k = (0.1 + 0.9 * (paneAct[paneOf[p]] || 0)) * Math.min(1.3, bGain), e = paneEdge[p];
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
        const a = rates && (!shapeMask || shapeMask[i]) ? rates[i] * bGain : 0, px = sx(meta.x[i]), py = sy(meta.y[i]);
        if (shapeMask && !shapeMask[i]) { x.fillStyle = `rgba(${r},${g},${b},0.05)`; x.fillRect(px - 0.5, py - 0.5, 1, 1); continue; }
        x.fillStyle = a > 0.02 ? `rgba(${r},${g},${b},${0.35 + 0.65 * Math.min(1, a * 1.5)})` : `rgba(${r},${g},${b},0.12)`;
        const s = a > 0.02 ? 1.4 + 3.2 * Math.min(1, a) : 1.1;
        x.fillRect(px - s / 2, py - s / 2, s, s);
      }
    }
  }
  const _dbg = () => ({popKeys, popGen, popMax, popLv, bandSum: bandV.reduce((a, b) => a + b, 0), fieldSum: field.reduce((a, b) => a + b, 0), view: P && P.earView});
  return {init, onAudioStart, setView, _dbg, AREAS, areaLvl, get areaOf() { return areaOf; }, get lens() { return earLens; }, get shapeMask() { return shapeMask; }, get frames() { return frames; }, get attached() { return attached; }, get rates() { return rates; }};
})();
window.Tonnectome = Tonnectome;   // for the module scripts (js/ear3d.js) and js/synth.js: a top-level const is not a window property
