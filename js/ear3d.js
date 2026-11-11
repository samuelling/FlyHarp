// Inside the auditory connectome: the 4,222 neurons of The Tonnectome's ear network as balls at their real places in
// the FlyWire brain, the strongest synapses as sticks, lit live by the ear model (js/tonnectome.js).
import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';

const $ = id => document.getElementById(id);
const box = $('earWrap'), canvas = $('ear3d'), tip = $('earTip');
const V = window.FH_V ? '?v=' + window.FH_V : '';
const TIER = ['#4fb3a4', '#e0c35a', '#e88a4f', '#e2576b'].map(c => new THREE.Color(c));
const TIER_NAME = ["Johnston's organ (the ear)", '2nd step', '3rd step', '4th step'];
const HOT = new THREE.Color('#fff4d6'), REST = new THREE.Color('#2b2f37'), EXC = new THREE.Color('#ffae42'), INH = new THREE.Color('#6a7dff');
const NSTICK = 6000;

let meta = null, N = 0, tier = null, renderer, scene, camera, controls, points, lines = null, colAttr, sizeAttr, eCol = null;
let eSrc = null, eTgt = null, eW = null, visible = false, started = false, lastDraw = 0, showSticks = true;

const VS = `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
  void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const FS = `varying vec3 vC;
  void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c,c)*4.0; if (r2 > 1.0) discard;
    float sph = sqrt(1.0 - r2); vec2 l = normalize(vec2(-0.6,0.6)); float hl = pow(max(0.0, dot(c*2.0, l)*0.5 + sph*0.6), 3.0);
    gl_FragColor = vec4(vC * (0.25 + 0.75*sph) + vC*hl*0.6, 1.0); }`;

async function load() {
  meta = await (await fetch('data/ear.json' + V)).json();
  let bin;
  try { const r = await fetch('data/ear.bin' + V); if (!r.ok) throw 0; bin = await r.arrayBuffer(); }
  catch (e) { const j = await (await fetch('data/ear.b64.json' + V)).json(), s = atob(j.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); bin = u.buffer; }
  N = meta.n; tier = new Uint8Array(N); let k = 0; meta.tiers.forEach((n, t) => { for (let j = 0; j < n; j++) tier[k++] = t; });
  // the strongest synapses, as a fraction of their target's input
  const rowptr = new Int32Array(bin, 0, N + 1), E = rowptr[N], pre = new Uint16Array(bin, 4 * (N + 1), E), syn = new Uint16Array(bin, 4 * (N + 1) + 2 * E, E);
  const all = [];
  for (let i = 0; i < N; i++) for (let p = rowptr[i]; p < rowptr[i + 1]; p++) all.push([syn[p] / Math.max(1, meta.intot[i]), pre[p], i]);
  all.sort((a, b) => b[0] - a[0]);
  const top = all.slice(0, NSTICK);
  eSrc = Int32Array.from(top, e => e[1]); eTgt = Int32Array.from(top, e => e[2]); eW = Float32Array.from(top, e => meta.sign[e[1]] * Math.sqrt(e[0] / top[0][0]));
  $('earCount').textContent = `${N.toLocaleString()} neurons · ${NSTICK.toLocaleString()} strongest of ${E.toLocaleString()} connections shown`;
}

function build() {
  renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
  camera.position.set(0, 0.15, 2.0);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.5; controls.target.set(0.07, 0.13, 0);
  controls.minDistance = 0.6; controls.maxDistance = 8;
  // frontal view of the brain: x across, y up, z toward the viewer (anterior)
  const pos = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) { pos[3 * i] = meta.x[i]; pos[3 * i + 1] = meta.y[i]; pos[3 * i + 2] = -meta.z[i]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  colAttr = new THREE.BufferAttribute(new Float32Array(3 * N), 3); colAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr = new THREE.BufferAttribute(new Float32Array(N).fill(0.02), 1); sizeAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('color', colAttr); g.setAttribute('size', sizeAttr);
  points = new THREE.Points(g, new THREE.ShaderMaterial({vertexShader: VS, fragmentShader: FS, uniforms: {uScale: {value: 600}}, depthWrite: true, depthTest: true}));
  scene.add(points);
  const E = eSrc.length, P = new Float32Array(6 * E);
  for (let e = 0; e < E; e++) { const a = eSrc[e], b = eTgt[e]; P.set([pos[3 * a], pos[3 * a + 1], pos[3 * a + 2], pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]], 6 * e); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(P, 3));
  eCol = new THREE.BufferAttribute(new Float32Array(8 * E), 4); eCol.setUsage(THREE.DynamicDrawUsage); lg.setAttribute('color', eCol);
  lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({transparent: true, depthWrite: false,
    vertexShader: 'attribute vec4 color; varying vec4 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec4 vC; void main(){ gl_FragColor = vC; }'}));
  lines.visible = showSticks; scene.add(lines);
  resize(); new ResizeObserver(resize).observe(box);
  paint(null); bindHover();
}

let act = new Float32Array(0);
function paint(r) {
  const c = colAttr.array, s = sizeAttr.array;
  if (act.length !== N) act = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = r ? Math.min(1, r[i] * 1.5) : 0, T = TIER[tier[i]], k = 3 * i, h = a * a;
    act[i] = r ? r[i] : 0;
    // at rest each neuron keeps a dim trace of its step's colour; active, it glows toward white-hot
    const b = 0.22 + 0.78 * a;
    c[k] = REST.r + (T.r * b + (HOT.r - T.r) * h - REST.r) * Math.max(0.55, a); c[k + 1] = REST.g + (T.g * b + (HOT.g - T.g) * h - REST.g) * Math.max(0.55, a); c[k + 2] = REST.b + (T.b * b + (HOT.b - T.b) * h - REST.b) * Math.max(0.55, a);
    s[i] = 0.02 + 0.035 * a;
  }
  colAttr.needsUpdate = true; sizeAttr.needsUpdate = true;
  const ec = eCol.array, E = eSrc.length;
  for (let e = 0; e < E; e++) {
    // a stick lights with how hard its synapse is driving its target now: presynaptic activity x weight
    const x = act[eSrc[e]] * eW[e], m = Math.min(1, Math.abs(x) * 1.6), col = x >= 0 ? EXC : INH, q = m * m, k8 = 8 * e, al = 0.02 + 0.6 * q;
    ec[k8] = col.r; ec[k8 + 1] = col.g; ec[k8 + 2] = col.b; ec[k8 + 3] = al;
    ec[k8 + 4] = col.r; ec[k8 + 5] = col.g; ec[k8 + 6] = col.b; ec[k8 + 7] = al * 0.3;
  }
  eCol.needsUpdate = true;
}

function resize() {
  const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  points.material.uniforms.uScale.value = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * Math.PI / 360));
}

function bindHover() {
  const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.015;
  const ptr = new THREE.Vector2(); let pending = false, last = null;
  canvas.addEventListener('pointermove', e => {
    if (e.buttons) { tip.style.opacity = 0; return; }
    last = e; if (pending) return; pending = true;
    setTimeout(() => {
      pending = false; const r = canvas.getBoundingClientRect();
      ptr.set(((last.clientX - r.left) / r.width) * 2 - 1, -((last.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObject(points)[0];
      if (!hit) { tip.style.opacity = 0; return; }
      const i = hit.index, side = {L: 'left', R: 'right', C: 'midline'}[meta.side[i]];
      tip.innerHTML = `<b>${meta.type[i] || 'untyped'}</b> · ${side} · ${TIER_NAME[tier[i]]}<br><span class="${act[i] > 0.05 ? 'dep' : ''}">${act[i] > 0.05 ? 'active' : 'quiet'} (${(act[i] * 100).toFixed(0)}%)</span>`;
      tip.style.left = (last.clientX - r.left + 14) + 'px'; tip.style.top = (last.clientY - r.top + 10) + 'px'; tip.style.opacity = 1;
    }, 60);
  });
  canvas.addEventListener('pointerleave', () => tip.style.opacity = 0);
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; $('earSpin').classList.remove('on'); });
}

let lastR = null;
function frame() {
  if (!visible) { started = false; return; }
  requestAnimationFrame(frame);
  const now = performance.now(); if (now - lastDraw < 32) return; lastDraw = now;
  const r = window.Tonnectome && Tonnectome.rates;
  if (r && r !== lastR) { lastR = r; paint(r); }
  controls.update(); renderer.render(scene, camera);
}
let loading = null;
async function start() {
  if (!loading) loading = load().then(build);
  await loading;
  if (!started) { started = true; requestAnimationFrame(frame); }
}
new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) start(); }, {rootMargin: '120px'}).observe(box);
$('earSpin').onclick = e => { controls.autoRotate = !controls.autoRotate; e.currentTarget.classList.toggle('on', controls.autoRotate); };
$('earSticks').onclick = e => { showSticks = !showSticks; if (lines) lines.visible = showSticks; e.currentTarget.classList.toggle('on', showSticks); };
$('earFront').onclick = () => { camera.position.set(0, 0.15, 2.0); controls.target.set(0.07, 0.13, 0); };
$('earTop').onclick = () => { camera.position.set(0.07, 2.1, 0.01); controls.target.set(0.07, 0.13, 0); controls.autoRotate = false; $('earSpin').classList.remove('on'); };
