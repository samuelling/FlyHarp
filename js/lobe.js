// Inside the optic lobe: every model neuron as a ball, the strongest synapses as sticks, lit by the live simulation.
// Layout is schematic-anatomical: each area is a curved sheet with the eye's 721 columns mapped onto it
// retinotopically, cell types stacked in sublayers by depth, and the two optic chiasms flipping the map
// front-to-back between lamina and medulla and again between medulla and lobula complex.
import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';

const $ = id => document.getElementById(id);
const box = $('lobeWrap'), canvas = $('lobe'), tip = $('lobeTip'), labelsEl = $('lobeLabels');
const AREAS = [
  // name, z (depth), sheet radius, thickness, x centre, x flip, bulge
  {name: 'Retina', z: -2.5, R: 1.30, th: 0.16, cx: 0, fx: 1, bulge: 0.34},
  {name: 'Lamina', z: -1.45, R: 1.05, th: 0.20, cx: 0, fx: 1, bulge: 0.22},
  {name: 'Medulla', z: 0.1, R: 1.12, th: 0.55, cx: 0, fx: -1, bulge: 0.20},
  {name: 'Lobula', z: 1.85, R: 0.70, th: 0.45, cx: -0.52, fx: 1, bulge: 0.12},
  {name: 'Lobula plate', z: 1.95, R: 0.56, th: 0.34, cx: 0.64, fx: 1, bulge: 0.10},
];
const DEPOL = new THREE.Color('#ffb44f'), HOT = new THREE.Color('#fff1c9'), HYP = new THREE.Color('#4f9cff'), REST = new THREE.Color('#2e323b');
const EXC = new THREE.Color('#ffae42'), INH = new THREE.Color('#6a7dff');

let api = null, renderer, scene, camera, controls, points, lines, pos, nodeType, nodeArea, nodeCol, sc, N;
let colAttr, sizeAttr, eSrc = null, eTgt = null, eW = null, eCol = null, lastDV = null, visible = false, started = false;
let showSticks = true, labels = [];
const v = new Float32Array(0);
let act = v;

function layout() {
  const {types, X, Y, nodeOf, groupOf} = api;
  N = api.N; pos = new Float32Array(3 * N); nodeType = new Int32Array(N); nodeArea = new Int8Array(N); nodeCol = new Int32Array(N);
  let colR = 0; for (let k = 0; k < X.length; k++) colR = Math.max(colR, Math.hypot(X[k], Y[k]));
  // sublayer depth of each type inside its area, in list order (retina R1..R8; lobula plate by T4/T5 subtype layer)
  const byArea = [[], [], [], [], []]; types.forEach((t, i) => byArea[groupOf(t)].push(i));
  const depth = new Float32Array(types.length);
  byArea.forEach(list => list.forEach((t, j) => depth[t] = list.length > 1 ? j / (list.length - 1) : 0.5));
  types.forEach((t, i) => { const m = /^T([45])([abcd])$/.exec(t); if (m) depth[i] = 'abcd'.indexOf(m[2]) / 3 * 0.9 + (m[1] === '5' ? 0.1 : 0); });
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (let t = 0; t < types.length; t++) {
    const g = groupOf(types[t]), A = AREAS[g], arr = nodeOf[t];
    for (let k = 0; k < arr.length; k++) {
      const i = arr[k]; if (i < 0) continue;
      const nx = X[k] / colR, ny = Y[k] / colR, rr = nx * nx + ny * ny;
      const jx = rnd() * 0.012, jy = rnd() * 0.012;
      pos[3 * i] = A.cx + A.fx * nx * A.R + jx;
      pos[3 * i + 1] = -ny * A.R + jy;
      pos[3 * i + 2] = A.z + (depth[t] - 0.5) * A.th - A.bulge * (1 - rr);
      nodeType[i] = t; nodeArea[i] = g; nodeCol[i] = k;
    }
  }
  act = new Float32Array(N);
}

const VS = `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
  void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const FS = `varying vec3 vC;
  void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c,c)*4.0; if (r2 > 1.0) discard;
    float sph = sqrt(1.0 - r2); vec2 l = normalize(vec2(-0.6,0.6)); float hl = pow(max(0.0, dot(c*2.0, l)*0.5 + sph*0.6), 3.0);
    gl_FragColor = vec4(vC * (0.25 + 0.75*sph) + vC*hl*0.6, 1.0); }`;

function build() {
  renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
  camera.position.set(5.6, 2.2, -3.6);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.55; controls.target.set(0, 0, 0);
  controls.minDistance = 1.2; controls.maxDistance = 14;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  colAttr = new THREE.BufferAttribute(new Float32Array(3 * N), 3); colAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr = new THREE.BufferAttribute(new Float32Array(N).fill(0.022), 1); sizeAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('color', colAttr); g.setAttribute('size', sizeAttr);
  points = new THREE.Points(g, new THREE.ShaderMaterial({vertexShader: VS, fragmentShader: FS, uniforms: {uScale: {value: 600}},
    depthWrite: true, depthTest: true}));
  scene.add(points);
  labels = AREAS.map(A => { const d = document.createElement('span'); d.className = 'lobeLabel'; d.textContent = A.name; labelsEl.appendChild(d); return d; });
  resize(); new ResizeObserver(resize).observe(box);
  paint(null);
  api.requestEdges(2);
  bindHover();
}

function buildSticks(m) {
  eSrc = m.src; eTgt = m.tgt; eW = m.w;
  const E = eSrc.length, P = new Float32Array(6 * E);
  let wmax = 0; for (let e = 0; e < E; e++) wmax = Math.max(wmax, Math.abs(eW[e]));
  const wn = new Float32Array(E); for (let e = 0; e < E; e++) wn[e] = Math.sqrt(Math.abs(eW[e]) / wmax);
  eW = Float32Array.from(eW, (w, e) => Math.sign(w) * wn[e]);
  for (let e = 0; e < E; e++) { const a = eSrc[e], b = eTgt[e]; P.set([pos[3 * a], pos[3 * a + 1], pos[3 * a + 2], pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]], 6 * e); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  eCol = new THREE.BufferAttribute(new Float32Array(8 * E), 4); eCol.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('color', eCol);
  lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({transparent: true, depthWrite: false,
    vertexShader: 'attribute vec4 color; varying vec4 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec4 vC; void main(){ gl_FragColor = vC; }'}));
  lines.visible = showSticks; scene.add(lines);
  $('lobeCount').textContent = `${N.toLocaleString()} neurons · ${E.toLocaleString()} strongest of ${api.nE.toLocaleString()} synapses shown`;
  paint(lastDV);
}

// normalised activity per neuron: +1 = its type's full depolarising range, −1 = full hyperpolarising range
function paint(dV) {
  const c = colAttr.array, s = sizeAttr.array, nT = api.types.length, S = api.scale;
  for (let i = 0; i < N; i++) {
    let a = 0;
    if (dV) { const d = dV[i], t = nodeType[i]; a = d > 0 ? d / S[t] : d / S[nT + t]; a = a > 1 ? 1 : a < -1 ? -1 : a; }
    act[i] = a; const m = Math.abs(a), k = 3 * i;
    const C = a > 0 ? DEPOL : HYP, h = a > 0 ? m * m : 0;
    c[k] = REST.r + (C.r + (HOT.r - C.r) * h - REST.r) * m; c[k + 1] = REST.g + (C.g + (HOT.g - C.g) * h - REST.g) * m; c[k + 2] = REST.b + (C.b + (HOT.b - C.b) * h - REST.b) * m;
    s[i] = 0.022 + 0.03 * m;
  }
  colAttr.needsUpdate = true; sizeAttr.needsUpdate = true;
  if (eCol) {
    // a stick lights with how hard its synapse is pushing its target away from rest right now:
    // gold when it drives the target up (excitation, or relief of inhibition), blue when it drives it down
    const ec = eCol.array, E = eSrc.length;
    for (let e = 0; e < E; e++) {
      const x = act[eSrc[e]] * eW[e], m = Math.min(1, Math.abs(x) * 1.2), col = x > 0 ? EXC : INH;
      const q = m * m, k8 = 8 * e, al = 0.025 + 0.55 * q;
      ec[k8] = col.r; ec[k8 + 1] = col.g; ec[k8 + 2] = col.b; ec[k8 + 3] = al;
      ec[k8 + 4] = col.r; ec[k8 + 5] = col.g; ec[k8 + 6] = col.b; ec[k8 + 7] = al * 0.3;   // fades toward the target: direction of flow
    }
    eCol.needsUpdate = true;
  }
}

function resize() {
  const w = box.clientWidth, h = box.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  points.material.uniforms.uScale.value = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * Math.PI / 360));
}

const tmp = new THREE.Vector3();
function placeLabels() {
  const w = box.clientWidth, h = box.clientHeight;
  AREAS.forEach((A, i) => {
    tmp.set(A.cx + (i === 4 ? 0.2 : i === 3 ? -0.2 : 0), A.R + 0.16, A.z - A.bulge * 0.3).project(camera);
    labels[i].style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`;
    labels[i].style.opacity = tmp.z < 1 ? 1 : 0;
  });
}

function bindHover() {
  const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.025;
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
      const i = hit.index, t = api.types[nodeType[i]], a = act[i];
      const what = window.FlyInfo && FlyInfo.cells && FlyInfo.cells[t] ? FlyInfo.cells[t] : '';
      tip.innerHTML = `<b>${t}</b> · ${AREAS[nodeArea[i]].name} · column ${nodeCol[i]}<br><span class="${a > 0.05 ? 'dep' : a < -0.05 ? 'hyp' : ''}">${a > 0.05 ? 'depolarised' : a < -0.05 ? 'hyperpolarised' : 'near rest'} (${(a * 100).toFixed(0)}% of range)</span>${what ? `<br><span class="muted">${what}</span>` : ''}`;
      tip.style.left = (last.clientX - r.left + 14) + 'px'; tip.style.top = (last.clientY - r.top + 10) + 'px'; tip.style.opacity = 1;
    }, 60);
  });
  canvas.addEventListener('pointerleave', () => tip.style.opacity = 0);
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; $('lobeSpin').classList.remove('on'); });
}

function frame() {
  if (!visible) { started = false; return; }
  requestAnimationFrame(frame);
  const dV = api.dv();
  if (dV && dV !== lastDV) { lastDV = dV; paint(dV); }
  controls.update(); renderer.render(scene, camera); placeLabels();
}

function start() {
  if (!api) return;
  if (!renderer) { layout(); build(); }
  if (!started) { started = true; requestAnimationFrame(frame); }
}

window.addEventListener('flyharp-edges', e => { if (renderer) buildSticks(e.detail); });
window.addEventListener('flyharp-ready', () => { api = window.FlyHarp; if (visible) start(); });
if (window.FlyHarp) api = window.FlyHarp;
new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) start(); }, {rootMargin: '120px'}).observe(box);

$('lobeSpin').onclick = e => { controls.autoRotate = !controls.autoRotate; e.currentTarget.classList.toggle('on', controls.autoRotate); };
$('lobeSticks').onclick = e => { showSticks = !showSticks; if (lines) lines.visible = showSticks; e.currentTarget.classList.toggle('on', showSticks); };
$('lobeView').onclick = () => { camera.position.set(5.6, 2.2, -3.6); controls.target.set(0, 0, 0); };
$('lobeSide').onclick = () => { camera.position.set(6.6, 0.3, -0.2); controls.target.set(0, 0, 0); controls.autoRotate = false; $('lobeSpin').classList.remove('on'); };
