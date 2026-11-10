// Visual stimuli rendered directly onto the fly's 721-column hex eye (luminance 0..1, grey = 0.5).
const Stimuli = (() => {
  let X, Y, R, nC;
  const paint = {pts: []};          // pointer strokes: {x, y, t, sign}
  const cam = {video: null, canvas: null, ctx: null, ok: false, prev: null};

  function init(x, y) {
    X = Float32Array.from(x); Y = Float32Array.from(y); nC = X.length;
    let r = 0; for (let i = 0; i < nC; i++) r = Math.max(r, Math.hypot(X[i], Y[i])); R = r;
  }

  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const deg = Math.PI / 180;

  // p: {kind, contrast, speed, size, direction, polarity}; t: seconds of simulated time
  function frame(p, t, out) {
    const c = p.contrast, th = p.direction * deg, ct = Math.cos(th), st = Math.sin(th);
    switch (p.kind) {
      case 'grating': {          // drifting sinusoid, wavelength = size columns, speed = cycles/s
        const k = 2 * Math.PI / Math.max(p.size, 2);
        for (let i = 0; i < nC; i++) out[i] = 0.5 * (1 + c * Math.sin(k * (X[i] * ct + Y[i] * st) - 2 * Math.PI * p.speed * t));
        break;
      }
      case 'edge': {             // a single moving edge sweeping across, then repeating
        const span = 2 * R + 4, pos = -R - 2 + ((t * p.speed * 10) % span);
        for (let i = 0; i < nC; i++) out[i] = 0.5 * (1 + ((X[i] * ct + Y[i] * st) < pos ? c * p.polarity : 0));
        break;
      }
      case 'bar': {              // moving bar of width = size/2 columns
        const span = 2 * R + p.size, pos = -R - p.size / 2 + ((t * p.speed * 10) % span), half = Math.max(p.size / 4, 0.75);
        for (let i = 0; i < nC; i++) { const d = Math.abs(X[i] * ct + Y[i] * st - pos); out[i] = 0.5 * (1 + (d < half ? c * p.polarity : 0)); }
        break;
      }
      case 'loom': {             // dark disk expanding from the centre (r ~ 1/(T - t)), repeating
        const period = 3 / Math.max(p.speed, 0.05), ph = t % period, T = period * 0.9;
        const rad = ph < T ? Math.min(R + 2, 0.6 / Math.max(T - ph, 0.02) * p.size / 4) : R + 2;
        for (let i = 0; i < nC; i++) out[i] = 0.5 * (1 + (Math.hypot(X[i], Y[i]) < rad ? -c : 0));
        break;
      }
      case 'dots': {             // random dots drifting coherently
        if (!frame._dots || frame._dots.n !== Math.round(p.size * 3)) {
          const n = Math.round(p.size * 3); frame._dots = {n, d: Array.from({length: n}, () => [Math.random() * 2 * R - R, Math.random() * 2 * R - R, Math.random() < 0.5 ? -1 : 1])};
        }
        out.fill(0.5);
        for (const [x0, y0, s] of frame._dots.d) {
          let x = x0 + ct * p.speed * 6 * t, y = y0 + st * p.speed * 6 * t;
          x = ((x + R) % (2 * R) + 2 * R) % (2 * R) - R; y = ((y + R) % (2 * R) + 2 * R) % (2 * R) - R;
          for (let i = 0; i < nC; i++) if ((X[i] - x) ** 2 + (Y[i] - y) ** 2 < 1.3) out[i] = 0.5 * (1 + c * s);
        }
        break;
      }
      case 'flash': {            // full-field ON/OFF flashes
        const period = 1 / Math.max(p.speed, 0.05), ph = (t % period) / period;
        const v = ph < 0.25 ? c : ph < 0.5 ? 0 : ph < 0.75 ? -c : 0;
        out.fill(0.5 * (1 + v));
        break;
      }
      case 'paint': {            // draw on the eye with the pointer; strokes fade over ~1 s
        out.fill(0.5);
        const keep = [];
        for (const q of paint.pts) {
          const age = t - q.t; if (age < 0 || age > 1.2) { if (age < 0) keep.push(q); continue; }
          keep.push(q);
          const a = Math.exp(-age * 3) * c * q.sign;
          for (let i = 0; i < nC; i++) { const d2 = (X[i] - q.x) ** 2 + (Y[i] - q.y) ** 2; if (d2 < 2.2) out[i] = clamp(out[i] + 0.5 * a * Math.exp(-d2)); }
        }
        paint.pts = keep;
        break;
      }
      case 'webcam': {
        if (!cam.ok) { out.fill(0.5); break; }
        const w = cam.canvas.width, h = cam.canvas.height;
        cam.ctx.drawImage(cam.video, 0, 0, w, h);
        const px = cam.ctx.getImageData(0, 0, w, h).data;
        let mean = 0;
        const s = (Math.min(w, h) / 2 - 1) / R;
        for (let i = 0; i < nC; i++) {
          // box filter: average a 3x3 patch around each ommatidium's position (mirrored like a selfie)
          const cx = Math.round(w / 2 - X[i] * s), cy = Math.round(h / 2 + Y[i] * s);
          let acc = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, cx + dx)), yy = Math.min(h - 1, Math.max(0, cy + dy)), o = 4 * (yy * w + xx);
            acc += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; n++;
          }
          out[i] = acc / n / 255; mean += out[i];
        }
        // keep the camera near the network's operating point: re-centre on grey, scale by the contrast control
        mean /= nC;
        for (let i = 0; i < nC; i++) out[i] = clamp(0.5 + (out[i] - mean) * 2 * c);
        break;
      }
    }
    return out;
  }

  async function startCamera() {
    if (cam.ok) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({video: {width: 320, height: 240}, audio: false});
      cam.video = document.createElement('video'); cam.video.srcObject = s; cam.video.muted = true; cam.video.playsInline = true;
      await cam.video.play();
      cam.canvas = document.createElement('canvas'); cam.canvas.width = 160; cam.canvas.height = 120;
      cam.ctx = cam.canvas.getContext('2d', {willReadFrequently: true});
      cam.ok = true; return true;
    } catch (e) { console.warn(e); return false; }
  }

  function addPaint(x, y, t, sign) { paint.pts.push({x, y, t, sign}); }
  // render the same stimulus at any set of points (used for the full-resolution "what you see" view)
  function frameAt(xa, ya, p, t, out) {
    const sx = X, sy = Y, sn = nC, keep = paint.pts.slice();
    X = xa; Y = ya; nC = xa.length;
    try { frame(p, t, out); } finally { X = sx; Y = sy; nC = sn; paint.pts = keep; }
    return out;
  }
  return {init, frame, frameAt, startCamera, addPaint, radius: () => R, video: () => cam.ok ? cam.video : null};
})();
