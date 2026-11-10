// FlyHarp main thread: stimulus → worker (fly network) → string detectors → notes; plus drawing.
(() => {
  const $ = id => document.getElementById(id);
  const DT = 0.02;
  const GROUP_NAMES = ['retina', 'lamina', 'medulla', 'transmedulla / lobula', 'motion (T4/T5)'];
  const GROUP_COL = ['#8f7fd6', '#4fb3a4', '#e0c35a', '#e88a4f', '#e2576b'];
  const DECAY = [0.9988, 0.9982, 0.9975, 0.9966, 0.9955], DUR = [1.2, 0.8, 0.5, 0.35, 0.25];
  const SCALES = {majpent: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    hirajoshi: [0, 2, 3, 7, 8], whole: [0, 2, 4, 6, 8, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]};
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const PRESETS = {
    cascade: ['R1', 'R7', 'R8', 'L1', 'L2', 'L3', 'L4', 'L5', 'Mi1', 'Mi4', 'Mi9', 'Tm3', 'Tm1', 'Tm2', 'Tm4', 'Tm9', 'T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d'],
    motion: ['T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d'],
    early: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'L1', 'L2', 'L3', 'L4', 'L5', 'Am', 'C2', 'C3', 'Lawf1', 'Lawf2', 'T1'],
  };
  const groupOf = t => /^R\d/.test(t) ? 0 : /^(L\d|Lawf|Am|C2|C3|T1)$/.test(t) || /^Lawf/.test(t) ? 1 : /^(Mi|CT1\(M10\))/.test(t) ? 2 :
    /^(T4|T5|CT1\(Lo1\))/.test(t) ? 4 : 3;

  const P = {kind: 'grating', contrast: 0.8, size: 8, speed: 1, direction: 0, polarity: -1};
  let types = [], X = [], Y = [], nodeOf = [], region = [], NR = 7, scale = [];
  let strings = [], det = null;
  let simT = 0, acc = 0, lastNow = performance.now(), busy = false, ready = false, playing = false;
  let lastLum = new Float32Array(721).fill(0.5), lastDV = null, rings = [], tokens = 24;
  const worker = new Worker('js/worker.js');

  // ---------------------------------------------------------------- controls
  for (const id of ['contrast', 'size', 'speed', 'direction']) bindRange(id, v => P[id] = v);
  bindRange('tempo', () => {}); bindRange('thresh', () => {}); bindRange('rate', () => {}); bindRange('spread', buildStrings);
  bindRange('vol', v => Sound.setVolume(v)); bindRange('rev', v => Sound.setReverb(v));
  function bindRange(id, fn) {
    const el = $(id), o = el.parentElement.querySelector('output');
    const upd = () => { const v = +el.value; if (o) o.textContent = id === 'direction' ? v + '°' : (id === 'tempo' ? v.toFixed(2) + '×' : v); fn(v); };
    el.addEventListener('input', upd); upd();
  }
  $('kind').onchange = async () => {
    P.kind = $('kind').value;
    $('eyehint').textContent = P.kind === 'paint' ? '· drag on the eye to draw (polarity sets dark/bright)' : '';
    if (P.kind === 'webcam') { const ok = await Stimuli.startCamera(); if (!ok) { status('camera unavailable here; try another stimulus'); } }
  };
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b)); P.polarity = +b.dataset.pol;
  });
  $('root').innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}" ${i === 2 ? 'selected' : ''}>${n}</option>`).join('');
  ['preset', 'scale', 'root'].forEach(k => $(k).onchange = buildStrings);
  $('spatial').onchange = buildStrings;
  $('reset').onclick = () => worker.postMessage({cmd: 'reset'});
  $('midiOut').onchange = () => Sound.setOutput($('midiOut').value);
  $('go').onclick = async () => {
    if (!playing) {
      await Sound.start(); Sound.setVolume(+$('vol').value); Sound.setReverb(+$('rev').value);
      playing = true; $('go').textContent = '❚❚ Pause sound'; $('go').classList.add('playing');
      const outs = await Sound.initMIDI();
      $('midiOut').innerHTML = '<option value="">none</option>' + outs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
    } else { playing = false; Sound.allNotesOff(); $('go').textContent = '▶ Start'; $('go').classList.remove('playing'); }
  };
  const status = s => $('status').textContent = s;

  // ---------------------------------------------------------------- strings and pitches
  function buildStrings() {
    if (!ready) return;
    const pre = $('preset').value, names = pre === 'all' ? types.slice() : PRESETS[pre].filter(t => types.includes(t));
    const sc = SCALES[$('scale').value], root = 36 + +$('root').value, spread = +$('spread').value;
    const byG = [[], [], [], [], []];
    names.forEach(n => byG[groupOf(n)].push(n));
    strings = [];
    byG.forEach((list, g) => list.forEach((n, i) => {
      const deg = i % sc.length, oct = Math.floor(i / sc.length) % 2;
      strings.push({name: n, t: types.indexOf(n), g, midi: root + Math.round(12 * g * spread) + 12 * oct + sc[deg]});
    }));
    const nR = $('spatial').checked ? NR : 1;
    det = {nR, base: new Float32Array(strings.length * nR), armed: new Uint8Array(strings.length * nR).fill(1), last: new Float32Array(strings.length * nR).fill(-9)};
    status(`${types.length} cell types · ${strings.length} strings${nR > 1 ? ' × 7 eye regions' : ''}`);
  }

  // per-step detection: a string plucks when its activity (in units of that type's response range)
  // rises past threshold above a slow running baseline; it re-arms once it falls back.
  function detect(a, tSim, events) {
    const th = +$('thresh').value, nR = det.nR;
    for (let s = 0; s < strings.length; s++) {
      const st = strings[s], t = st.t, sc = scale[t];
      for (let r = 0; r < nR; r++) {
        let x;
        if (nR === 1) { x = 0; for (let q = 0; q < NR; q++) x += a[t * NR + q]; x /= NR; } else x = a[t * NR + r];
        x /= sc;
        const k = s * nR + r;
        det.base[k] += (x - det.base[k]) * DT / 1.5;
        const d = x - det.base[k];
        if (det.armed[k] && d > th && tSim - det.last[k] > 0.06) {
          det.armed[k] = 0; det.last[k] = tSim;
          const ang = r === 0 ? null : -Math.PI + (r - 0.5) * Math.PI / 3;
          events.push({s, r, vel: Math.min(1, 0.25 + d), pan: ang === null ? 0 : 0.8 * Math.cos(ang), lift: ang === null ? 0 : Math.sin(ang)});
        } else if (!det.armed[k] && d < th * 0.4) det.armed[k] = 1;
      }
    }
  }

  function fire(ev) {
    const st = strings[ev.s];
    const n = {midi: st.midi, vel: ev.vel, pan: ev.pan, dur: DUR[st.g], decay: DECAY[st.g], bright: 0.35 + 0.5 * ev.vel + 0.1 * ev.lift,
      channel: $('midiCh').value === 'layer' ? st.g : 0};
    if (playing) Sound.play(n, {internal: $('internal').checked, midi: true});
    roll.push({midi: st.midi, g: st.g, vel: ev.vel, x: rollW}); stats.notes++; stats.byGroup[st.g]++;
    rings.push({t: st.t, r: det.nR > 1 ? ev.r : -1, born: performance.now(), g: st.g});
  }

  // ---------------------------------------------------------------- worker
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.cmd === 'ready') {
      types = m.types; X = m.x; Y = m.y; nodeOf = m.nodeOf; region = m.region; NR = m.NR; scale = m.scale;
      Stimuli.init(X, Y); layoutCascade(); ready = true; buildStrings();
      status(`${m.N.toLocaleString()} neurons, ${(m.nE / 1e6).toFixed(2)}M synapses running · press Start for sound`);
    } else if (m.cmd === 'frames') {
      busy = false; lastDV = m.dV;
      const batch = pendingBatch; pendingBatch = null;
      const events = [];
      m.steps.forEach((a, k) => { const evs = []; detect(a, batch.t0 + k * DT, evs); evs.forEach(ev => { ev.delay = k * DT / batch.tempo * 1000; events.push(ev); }); });
      // rate limit (token bucket), loudest first within the batch
      events.sort((p, q) => q.vel - p.vel);
      const keep = events.slice(0, Math.max(0, Math.floor(tokens))); tokens -= keep.length;
      keep.forEach(ev => setTimeout(() => fire(ev), ev.delay));
    }
  };
  worker.postMessage({cmd: 'init', url: new URL('data/fly.json', location.href).href});
  let pendingBatch = null;

  function tick(now) {
    const realDt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    tokens = Math.min(+$('rate').value, tokens + realDt * +$('rate').value);
    if (ready && !busy) {
      const tempo = +$('tempo').value;
      acc += realDt * tempo;
      const n = Math.min(10, Math.floor(acc / DT));
      if (n > 0) {
        acc -= n * DT;
        const frames = [];
        for (let k = 0; k < n; k++) frames.push(Stimuli.frame(P, simT + k * DT, new Float32Array(X.length)));
        lastLum = frames[frames.length - 1].slice();
        pendingBatch = {t0: simT, tempo}; simT += n * DT;
        busy = true; worker.postMessage({cmd: 'run', frames}, frames.map(f => f.buffer));
      }
      if (acc > 10 * DT) acc = 10 * DT; // don't build up debt if the browser can't keep up
    }
    drawEye(); drawRoll(realDt); if ((frameN++ & 1) === 0) drawCascade();
    requestAnimationFrame(tick);
  }
  let frameN = 0;
  const stats = {notes: 0, byGroup: [0, 0, 0, 0, 0]};
  window.__flyharp = {stats, P, get strings() { return strings; }, get simT() { return simT; }};

  // ---------------------------------------------------------------- drawing: eye
  const eye = $('eye'), ex = eye.getContext('2d');
  function eyeScale() { return (eye.width / 2 - 12) / 15.5; }
  function drawEye() {
    if (!ready) return;
    const s = eyeScale(), cx = eye.width / 2, cy = eye.height / 2;
    ex.fillStyle = '#0a0b0d'; ex.fillRect(0, 0, eye.width, eye.height);
    for (let i = 0; i < X.length; i++) {
      const v = Math.round(lastLum[i] * 255);
      ex.fillStyle = `rgb(${v},${v},${v})`;
      ex.beginPath(); ex.arc(cx + X[i] * s, cy + Y[i] * s, s * 0.52, 0, 2 * Math.PI); ex.fill();
    }
  }
  let drawing = false;
  const paintAt = (e) => {
    const r = eye.getBoundingClientRect(), s = eyeScale() * r.width / eye.width;
    Stimuli.addPaint((e.clientX - r.left - r.width / 2) / s, (e.clientY - r.top - r.height / 2) / s, simT, P.polarity);
  };
  eye.addEventListener('pointerdown', e => { if (P.kind !== 'paint') { $('kind').value = 'paint'; $('kind').onchange(); } drawing = true; eye.setPointerCapture(e.pointerId); paintAt(e); });
  eye.addEventListener('pointermove', e => { if (drawing) paintAt(e); });
  eye.addEventListener('pointerup', () => drawing = false);

  // ---------------------------------------------------------------- drawing: piano roll
  const rollC = $('roll'), rx = rollC.getContext('2d'), rollW = rollC.width, roll = [];
  function drawRoll(dt) {
    rx.fillStyle = '#0a0b0d'; rx.fillRect(0, 0, rollC.width, rollC.height);
    const lo = 30, hi = 110, h = rollC.height;
    rx.strokeStyle = '#1c1f26'; rx.lineWidth = 1;
    for (let m = 36; m < hi; m += 12) { const y = h - (m - lo) / (hi - lo) * h; rx.beginPath(); rx.moveTo(0, y); rx.lineTo(rollC.width, y); rx.stroke(); }
    for (let i = roll.length - 1; i >= 0; i--) {
      const n = roll[i]; n.x -= dt * 90;
      if (n.x < -20) { roll.splice(i, 1); continue; }
      const y = h - (n.midi - lo) / (hi - lo) * h;
      rx.globalAlpha = 0.35 + 0.65 * n.vel; rx.fillStyle = GROUP_COL[n.g];
      rx.fillRect(n.x - 8, y - 3, 6 + 18 * DUR[n.g], 6);
    }
    rx.globalAlpha = 1;
    rx.font = '11px sans-serif';
    GROUP_NAMES.forEach((g, i) => { rx.fillStyle = GROUP_COL[i]; rx.fillRect(10, 10 + i * 16, 10, 10); rx.fillStyle = '#8d8a83'; rx.fillText(g, 26, 19 + i * 16); });
  }

  // ---------------------------------------------------------------- drawing: cascade of cell-type maps
  const casC = $('cascade'), cx2 = casC.getContext('2d');
  let tiles = [], img = null, pix = null;
  const ROWS = [t => groupOf(t) === 0, t => groupOf(t) === 1, t => groupOf(t) === 2, t => groupOf(t) === 3 && /^Tm\d/.test(t),
    t => groupOf(t) === 3 && !/^Tm\d/.test(t), t => groupOf(t) === 4];
  const TW = 86, TH = 70, MS = 2.05;
  function layoutCascade() {
    tiles = [];
    ROWS.forEach((f, row) => types.filter(f).forEach((t, i) => tiles.push({t: types.indexOf(t), name: t, x0: 8 + i * TW, y0: 6 + row * TH, g: groupOf(t)})));
    img = cx2.createImageData(casC.width, casC.height); pix = img.data;
  }
  function drawCascade() {
    if (!ready || !lastDV) return;
    pix.fill(0);
    for (let i = 3; i < pix.length; i += 4) pix[i] = 255;
    for (let i = 0; i < pix.length; i += 4) { pix[i] = 10; pix[i + 1] = 11; pix[i + 2] = 13; }
    for (const tl of tiles) {
      const arr = nodeOf[tl.t], sc = 3 * scale[tl.t], ox = tl.x0 + 38, oy = tl.y0 + 34;
      for (let k = 0; k < arr.length; k++) {
        const id = arr[k]; if (id < 0) continue;
        let v = lastDV[id] / sc; v = v > 1 ? 1 : v < -1 ? -1 : v;
        const r = v > 0 ? 30 + 225 * v : 30 + 60 * -v, g = v > 0 ? 32 + 128 * v : 32 + 134 * -v, b = v > 0 ? 36 + 40 * v : 36 + 196 * -v;
        const px = Math.round(ox + X[k] * MS), py = Math.round(oy + Y[k] * MS);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = 4 * ((py + dy) * casC.width + px + dx); pix[o] = r; pix[o + 1] = g; pix[o + 2] = b; }
      }
    }
    cx2.putImageData(img, 0, 0);
    cx2.font = '10px sans-serif';
    for (const tl of tiles) { cx2.fillStyle = GROUP_COL[tl.g]; cx2.fillText(tl.name, tl.x0, tl.y0 + 68); }
    const now = performance.now();
    rings = rings.filter(r => now - r.born < 400);
    for (const rg of rings) {
      const tl = tiles.find(x => x.t === rg.t); if (!tl) continue;
      const a = 1 - (now - rg.born) / 400;
      cx2.strokeStyle = GROUP_COL[rg.g]; cx2.globalAlpha = a; cx2.lineWidth = 2;
      let px = tl.x0 + 38, py = tl.y0 + 34, rad = 32;
      if (rg.r > 0) { const ang = -Math.PI + (rg.r - 0.5) * Math.PI / 3; px += Math.cos(ang) * 20; py += Math.sin(ang) * 20; rad = 11; } else if (rg.r === 0) rad = 11;
      cx2.beginPath(); cx2.arc(px, py, rad, 0, 2 * Math.PI); cx2.stroke();
    }
    cx2.globalAlpha = 1;
  }

  requestAnimationFrame(tick);
})();
