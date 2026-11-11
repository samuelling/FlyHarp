// Synthesthesia: the fly's visual system wired into its auditory system, drawn live as a schematic fly head seen
// from the front. Light enters the compound eyes and runs inward through the optic lobe (lamina, medulla, lobula,
// lobula plate); the optic lobe plays the instrument; its sound reaches the antennae, where Johnston's organ hears
// it; the auditory areas pass it inward; the lens population (chosen in Hears) paints a picture; the picture is
// what the eyes see next.
//
// Everything that glows is a live read-out, each relative to its own recent peak:
//   eyes and optic lobe   mean |response| of each optic-lobe stage in the model (the instrument's area meters)
//   instrument            notes per second
//   auditory areas        mean firing of each area in the ear model (js/tonnectome.js)
//   the beam to the eyes  how much of the eye's input is the ear's picture (the loop slider)
const Synth = (() => {
  const $ = id => document.getElementById(id);
  const W = 1200, H = 520, CX = 600;
  const VIS = [{k: 0, name: 'retina', col: '#8f7fd6'}, {k: 1, name: 'lamina', col: '#4fb3a4'}, {k: 2, name: 'medulla', col: '#e0c35a'},
    {k: 3, name: 'lobula', col: '#e88a4f'}, {k: 4, name: 'lobula plate', col: '#e2576b'}];
  // left-side positions; the right side mirrors them
  const EYE = {x: 205, y: 262, rx: 104, ry: 160};
  const LOBE = [null, {rx: 124, ry: 146, a: 50, w: 7}, {rx: 152, ry: 124, a: 46, w: 15}, {rx: 181, ry: 92, a: 36, w: 10}, {rx: 199, ry: 78, a: 30, w: 8}];
  const NODE = {
    sound: {x: 556, y: 422, rx: 11, ry: 11, name: "Johnston's organ"}, wind: {x: 556, y: 422, rx: 11, ry: 11},
    ammc: {x: 566, y: 330, rx: 18, ry: 11, name: 'AMMC'}, sad: {x: 532, y: 306, rx: 22, ry: 12, name: 'saddle'},
    wed: {x: 514, y: 268, rx: 23, ry: 13, name: 'wedge'}, vlp: {x: 520, y: 222, rx: 26, ry: 14, name: 'ventrolateral'},
    slope: {x: 566, y: 182, rx: 22, ry: 11, name: 'posterior slope'}, vision: {x: 500, y: 178, rx: 17, ry: 10, name: 'to vision'},
    gng: {x: 600, y: 360, rx: 30, ry: 14, name: 'GNG', mid: true},
  };
  const INST = {x: CX, y: 484}, PIC = {x: CX - 52, y: 8, s: 104};
  let ctx = null, visible = false, raf = 0, last = 0, t0 = performance.now();
  const peak = {}, lvl = {};
  let notes0 = 0, nT0 = performance.now(), nps = 0;

  function norm(key, v, floor) {
    // each read-out relative to its own recent peak, with a floor so silence stays dark
    peak[key] = Math.max(floor, (peak[key] || floor) * 0.996, v);
    const g = v / peak[key];
    lvl[key] = (lvl[key] || 0) + (g - (lvl[key] || 0)) * 0.25;
    return lvl[key];
  }
  const mx = (x, side) => side ? W - x : x;

  // ---------------------------------------------------------------- paths and their travelling dots
  function bez(p0, p1, p2, p3, n = 48) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; }
  function poly(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return {pts, L, len: L[L.length - 1]}; }
  function at(P, d) { let i = 1; while (i < P.L.length - 1 && P.L[i] < d) i++; const a = P.pts[i - 1], b = P.pts[i], f = (d - P.L[i - 1]) / Math.max(1e-6, P.L[i] - P.L[i - 1]); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
  function dots(P, level, col, speed = 70, gap = 24, r = 2.2, dash = false) {
    if (level < 0.02) return;
    const t = (performance.now() - t0) / 1000, off = (t * speed) % gap;
    ctx.fillStyle = col;
    for (let d = off; d < P.len; d += gap) {
      const [x, y] = at(P, d), fade = Math.min(1, d / 20, (P.len - d) / 20);
      ctx.globalAlpha = Math.min(1, level) * fade * (dash ? 0.8 : 1);
      ctx.beginPath(); ctx.arc(x, y, r * (0.7 + 0.5 * level), 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function trace(P, col, a = 0.18, w = 1.2, dash) {
    ctx.strokeStyle = col; ctx.globalAlpha = a; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); P.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  let paths = null;
  function buildPaths() {
    paths = {vis: [], play: [], ear: [], pic: [], back: []};
    for (const side of [0, 1]) {
      const x = v => mx(v, side);
      // light: eye -> lamina -> medulla -> lobula -> lobula plate, one segment per stage
      const xs = [EYE.x + 40, EYE.x + LOBE[1].rx, EYE.x + LOBE[2].rx, EYE.x + LOBE[3].rx, EYE.x + LOBE[4].rx];
      for (let s = 0; s < 4; s++) paths.vis.push({k: s, P: poly([[x(xs[s]), EYE.y + (s % 2 ? 3 : -3)], [x(xs[s + 1]), EYE.y + (s % 2 ? -3 : 3)]])});
      // the optic lobe plays: lobula plate -> instrument
      paths.play.push(poly(bez([x(xs[4] + 4), EYE.y + 14], [x(xs[4] + 2), 420], [x(CX - 70), 486], [x(CX - 18), INST.y])));
      // the auditory chain, along the main excitatory area-to-area connections
      const E = [['sound', 'ammc'], ['wind', 'sad'], ['ammc', 'wed'], ['sad', 'wed'], ['ammc', 'vlp'], ['wind', 'gng'], ['wed', 'vision'], ['vision', 'slope'], ['sad', 'gng']];
      for (const [a, b] of E) {
        const A = NODE[a], B = NODE[b], ax = A.mid ? CX : x(A.x), bx = B.mid ? CX : x(B.x);
        const bend = a === 'ammc' && b === 'vlp' ? 34 : 10;
        paths.ear.push({a, b, P: poly(bez([ax, A.y], [ax + (side ? bend : -bend) * 0.2, (A.y + B.y) / 2], [bx + (side ? bend : -bend), (A.y + B.y) / 2], [bx, B.y], 24))});
      }
      // what the eyes see next: the picture beams back to both eyes
      paths.back.push(poly(bez([side ? PIC.x + PIC.s : PIC.x, PIC.y + 10], [x(380), 2], [x(EYE.x + 20), 24], [x(EYE.x), EYE.y - EYE.ry + 6])));
    }
  }
  function picPath(id, side) {
    // from the lens population up to the picture
    const n = NODE[id] || (id === 'all' ? {x: CX, y: 260, mid: true} : null), x = n ? (n.mid ? CX : mx(n.x, side)) : mx(556, side), y = n ? n.y : 422;
    return poly(bez([x, y], [x, y - 80], [side ? PIC.x + PIC.s - 20 : PIC.x + 20, PIC.y + PIC.s + 60], [side ? PIC.x + PIC.s - 22 : PIC.x + 22, PIC.y + PIC.s]));
  }

  // ---------------------------------------------------------------- drawing
  function ell(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI); }
  function glow(col, g, blur) { ctx.shadowColor = col; ctx.shadowBlur = blur * g; }
  function hexa(c, a) { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  function frame(now) {
    if (!visible) return; raf = requestAnimationFrame(frame);
    if (now - last < 33) return; last = now;
    const F = window.__flyharp, TN = window.Tonnectome; if (!F || !ctx) return;
    // read-outs
    if (now - nT0 > 400) { nps = nps * 0.5 + 0.5 * (F.stats.notes - notes0) / ((now - nT0) / 1000); notes0 = F.stats.notes; nT0 = now; }
    const vis = VIS.map(v => norm('v' + v.k, F.meter ? F.meter[v.k] : 0, 0.02));
    const play = Math.min(1, nps / 14);
    const A = TN && TN.areaLvl || {}, ear = {};
    for (const k of Object.keys(NODE)) ear[k] = norm('e' + k, A[k] || 0, 0.01);
    const loop = F.P.kind === 'ear' ? 1 : (F.P.earMix || 0);

    ctx.clearRect(0, 0, W, H);
    // head capsule and central brain
    ctx.fillStyle = '#101216'; ctx.strokeStyle = '#2a2e37'; ctx.lineWidth = 1.5; ell(CX, 262, 400, 204); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#22262e'; ell(CX, 255, 118, 132); ctx.stroke();
    // compound eyes, showing what the eye is shown
    const eyeC = $('eye');
    for (const side of [0, 1]) {
      const x = mx(EYE.x, side);
      ctx.save(); ell(x, EYE.y, EYE.rx, EYE.ry); ctx.clip();
      ctx.fillStyle = '#07080a'; ctx.fillRect(x - EYE.rx, EYE.y - EYE.ry, 2 * EYE.rx, 2 * EYE.ry);
      if (eyeC) { ctx.translate(x, EYE.y); if (side) ctx.scale(-1, 1); ctx.globalAlpha = 0.9; ctx.drawImage(eyeC, -EYE.ry, -EYE.ry, 2 * EYE.ry, 2 * EYE.ry); ctx.globalAlpha = 1; }
      ctx.restore();
      glow(VIS[0].col, vis[0], 26); ctx.strokeStyle = hexa(VIS[0].col, 0.35 + 0.65 * vis[0]); ctx.lineWidth = 2.5; ell(x, EYE.y, EYE.rx, EYE.ry); ctx.stroke(); ctx.shadowBlur = 0;
      // optic lobe neuropils: crescents medial to the eye
      for (let s = 1; s <= 4; s++) {
        const L = LOBE[s], g = vis[s], a0 = (side ? 180 - L.a : -L.a) * Math.PI / 180, a1 = (side ? 180 + L.a : L.a) * Math.PI / 180;
        glow(VIS[s].col, g, 18); ctx.strokeStyle = hexa(VIS[s].col, 0.22 + 0.78 * g); ctx.lineWidth = L.w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(x, EYE.y, L.rx, L.ry, 0, a0, a1); ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
    ctx.lineCap = 'butt';
    // light flowing inward through the optic lobe
    for (const v of paths.vis) dots(v.P, 0.3 + 0.7 * vis[v.k + 1], VIS[v.k + 1].col, 55, 18, 2);
    // the optic lobe plays the instrument
    for (const P of paths.play) { trace(P, '#e2576b', 0.16); dots(P, play, '#ff8fa0', 80, 22, 2.2); }
    // the instrument, and its sound reaching the antennae
    ctx.strokeStyle = hexa('#e0c35a', 0.4 + 0.6 * play); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(INST.x - 26, INST.y + 18); ctx.lineTo(INST.x - 26, INST.y - 10); ctx.quadraticCurveTo(INST.x, INST.y - 26, INST.x + 26, INST.y - 10); ctx.lineTo(INST.x + 26, INST.y + 18); ctx.stroke();
    for (let k = -2; k <= 2; k++) { ctx.globalAlpha = 0.35 + 0.65 * play * (0.6 + 0.4 * Math.sin(now / 90 + k * 2)); ctx.beginPath(); ctx.moveTo(INST.x + k * 9, INST.y - 12 - (2 - Math.abs(k)) * 3); ctx.lineTo(INST.x + k * 9, INST.y + 16); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const tt = now / 1000;
    for (let k = 0; k < 4; k++) {
      const ph = (tt * 0.9 + k / 4) % 1, rr = 30 + ph * 70;
      ctx.strokeStyle = hexa('#e0c35a', (1 - ph) * 0.6 * play); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(INST.x, INST.y, rr, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
    }
    // antennae: three segments, Johnston's organ in the second, feathery arista
    for (const side of [0, 1]) {
      const x = v => mx(v, side), s = side ? -1 : 1;
      ctx.strokeStyle = '#3a3f4a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x(570), 392); ctx.lineTo(x(562), 408); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x(552), 434); ctx.lineTo(x(546), 452); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x(546), 450); ctx.quadraticCurveTo(x(520), 470, x(488), 474); ctx.stroke();
      for (let k = 1; k < 7; k++) { const px = x(546 - k * 8.5), py = 452 + k * 3.2 - k * k * 0.25; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + s * -2, py - 7); ctx.moveTo(px, py); ctx.lineTo(px + s * -2, py + 6); ctx.stroke(); }
      ctx.lineCap = 'butt';
      const g = Math.max(ear.sound, ear.wind);
      glow('#4fb3a4', g, 20); ctx.fillStyle = hexa('#4fb3a4', 0.25 + 0.75 * g); ell(x(NODE.sound.x), NODE.sound.y, 11, 13); ctx.fill(); ctx.shadowBlur = 0;
    }
    // the auditory areas and the connections between them
    const AR = TN ? TN.AREAS : [], colOf = id => (AR.find(a => a.id === id) || {col: '#8d8a83'}).col;
    for (const e of paths.ear) { trace(e.P, colOf(e.a), 0.14); dots(e.P, ear[e.a], colOf(e.a), 50, 14, 1.8); }
    const lensId = TN ? TN.lens : null;
    for (const side of [0, 1]) for (const [id, n] of Object.entries(NODE)) {
      if (id === 'sound' || id === 'wind' || (n.mid && side)) continue;
      const x = n.mid ? CX : mx(n.x, side), g = ear[id], c = colOf(id);
      glow(c, g, 16); ctx.fillStyle = hexa(c, 0.18 + 0.82 * g); ell(x, n.y, n.rx, n.ry); ctx.fill(); ctx.shadowBlur = 0;
      if (lensId === id) { ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 1.5; ell(x, n.y, n.rx + 4, n.ry + 4); ctx.stroke(); }
    }
    // the lens population paints the picture...
    const lensSrc = lensId === 'sound' || lensId === 'wind' ? 'sound' : lensId;
    for (const side of [0, 1]) { const P = picPath(lensSrc, side); trace(P, '#FF68BA', 0.18); dots(P, 0.25 + 0.75 * Math.max(...Object.values(ear)), '#FF68BA', 60, 16, 2); }
    const art = $('tnArt');
    ctx.save(); ctx.beginPath(); ctx.roundRect(PIC.x, PIC.y, PIC.s, PIC.s, 10); ctx.clip();
    ctx.fillStyle = '#08090b'; ctx.fillRect(PIC.x, PIC.y, PIC.s, PIC.s);
    if (art) ctx.drawImage(art, PIC.x, PIC.y, PIC.s, PIC.s);
    ctx.restore(); glow('#FF68BA', 0.5 + 0.5 * loop, 16); ctx.strokeStyle = hexa('#FF68BA', 0.5 + 0.5 * loop); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(PIC.x, PIC.y, PIC.s, PIC.s, 10); ctx.stroke(); ctx.shadowBlur = 0;
    // ...and the picture is what the eyes see next
    for (const P of paths.back) { trace(P, '#FF68BA', 0.25 * (0.3 + loop), 1.2, [5, 5]); dots(P, loop, '#ffb3dc', 90, 20, 2.4); }

    // labels: the optic lobe on the left, hearing on the right
    ctx.font = '11.5px -apple-system, Segoe UI, sans-serif'; ctx.textAlign = 'center';
    const lab = (t, x, y, c = '#a8a59d') => { ctx.fillStyle = '#0b0c0f'; ctx.globalAlpha = 0.6; const w = ctx.measureText(t).width; ctx.fillRect(x - w / 2 - 3, y - 10, w + 6, 14); ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(t, x, y); };
    lab('compound eye', EYE.x, EYE.y + EYE.ry + 18);
    lab('lamina', EYE.x + LOBE[1].rx - 4, EYE.y - 128, VIS[1].col);
    lab('medulla', EYE.x + LOBE[2].rx + 4, EYE.y - 108, VIS[2].col);
    lab('lobula', EYE.x + LOBE[3].rx - 6, EYE.y + 104, VIS[3].col);
    lab('lobula plate', EYE.x + LOBE[4].rx + 14, EYE.y + 124, VIS[4].col);
    const LX = {ammc: 40, sad: 48, wed: 50, vlp: 62, vision: 44};
    for (const id of Object.keys(LX)) { const n = NODE[id]; lab(n.name, W - n.x + LX[id], n.y + 4 + (id === 'vision' ? -8 : 0), colOf(id)); }
    lab('GNG', CX, NODE.gng.y + 4, '#e9e4f5');
    lab('posterior slope', CX, NODE.slope.y - 18, colOf('slope'));
    lab("antenna · Johnston's organ", W - 470, 494, '#4fb3a4');
    lab('compound eye', W - EYE.x, EYE.y + EYE.ry + 18);
    ctx.textAlign = 'left'; ctx.font = '12px -apple-system, Segoe UI, sans-serif';
    // live numbers
    ctx.fillStyle = '#e0c35a'; ctx.textAlign = 'center'; ctx.fillText(`the instrument · ${nps.toFixed(1)} notes/s`, INST.x, H - 3);
    const r = TN && TN.rates; let act = 0; if (r) for (let i = 0; i < r.length; i++) if (r[i] > 0.05) act++;
    ctx.fillStyle = '#FF68BA'; ctx.textAlign = 'left';
    ctx.fillText('what it hears', PIC.x + PIC.s + 12, PIC.y + 52);
    ctx.fillStyle = '#a8a59d'; ctx.font = '11.5px -apple-system, Segoe UI, sans-serif';
    const vb = document.querySelector('#tnViews button.on');
    ctx.fillText(`${vb ? vb.textContent : ''}${TN && TN.lens ? ' · through ' + (TN.AREAS.find(a => a.id === TN.lens) || {name: 'the whole network'}).name : ''}`, PIC.x + PIC.s + 12, PIC.y + 68);
    ctx.fillText(`${act.toLocaleString()} of ${r ? r.length.toLocaleString() : '4,222'} ear neurons active`, PIC.x + PIC.s + 12, PIC.y + 84);
    ctx.textAlign = 'right'; ctx.fillStyle = '#FF68BA';
    ctx.fillText('what it sees next', PIC.x - 12, PIC.y + 52);
    ctx.fillStyle = '#a8a59d'; ctx.fillText(loop >= 0.999 ? 'only what it hears' : `${Math.round(loop * 100)}% what it hears`, PIC.x - 12, PIC.y + 68);
    ctx.textAlign = 'left';
  }
  function setVisible(on) {
    visible = on;
    if (on) {
      if (!ctx) { const c = $('syn'); ctx = c.getContext('2d'); buildPaths(); }
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    }
  }
  return {setVisible};
})();
