// Extras: World. The city's Earth, up close: drag to turn it, scroll or pinch to come in, pick a place from the list.
// Airports and race tracks are fixed lists; live flights come from the flights relay (worker-flights.js) when it is deployed.

// Set this to the deployed relay's URL (for example https://flights.<you>.workers.dev). While it is null, the Live tab says so.
const FLIGHTS_URL = null;

const PLACES = {
  airports: [
    ['Hartsfield-Jackson Atlanta', 'ATL · Atlanta, Georgia', 33.6407, -84.4277],
    ['Dallas/Fort Worth', 'DFW · Texas', 32.8998, -97.0403],
    ['Denver International', 'DEN · Colorado', 39.8561, -104.6737],
    ["Chicago O'Hare", 'ORD · Illinois', 41.9742, -87.9073],
    ['Los Angeles International', 'LAX · California', 33.9416, -118.4085],
    ['John F. Kennedy', 'JFK · New York', 40.6413, -73.7781],
    ['Harry Reid', 'LAS · Las Vegas, Nevada', 36.084, -115.1537],
    ['Orlando International', 'MCO · Florida', 28.4312, -81.3081],
    ['Charlotte Douglas', 'CLT · North Carolina', 35.2144, -80.9473],
    ['Seattle-Tacoma', 'SEA · Washington', 47.4502, -122.3088],
    ['Phoenix Sky Harbor', 'PHX · Arizona', 33.4342, -112.0116],
    ['Miami International', 'MIA · Florida', 25.7959, -80.287],
    ['San Francisco International', 'SFO · California', 37.6213, -122.379],
    ['George Bush Intercontinental', 'IAH · Houston, Texas', 29.9902, -95.3368],
    ['Boston Logan', 'BOS · Massachusetts', 42.3656, -71.0096],
    ['Nashville International', 'BNA · Tennessee', 36.1263, -86.6774],
  ],
  tracks: [
    ['Daytona International Speedway', 'Daytona Beach, Florida', 29.1852, -81.0705],
    ['Talladega Superspeedway', 'Talladega, Alabama', 33.5669, -86.0661],
    ['Bristol Motor Speedway', 'Bristol, Tennessee', 36.5157, -82.257],
    ['Indianapolis Motor Speedway', 'Speedway, Indiana', 39.795, -86.2353],
    ['Circuit of the Americas', 'Austin, Texas', 30.1328, -97.6411],
    ['Watkins Glen International', 'Watkins Glen, New York', 42.3369, -76.9272],
    ['Road America', 'Elkhart Lake, Wisconsin', 43.7975, -87.9897],
    ['Laguna Seca', 'Monterey, California', 36.5843, -121.7535],
    ['Charlotte Motor Speedway', 'Concord, North Carolina', 35.352, -80.6828],
    ['Sebring International Raceway', 'Sebring, Florida', 27.4544, -81.3483],
    ['Road Atlanta', 'Braselton, Georgia', 34.149, -83.815],
    ['Las Vegas Motor Speedway', 'Las Vegas, Nevada', 36.2719, -115.0106],
    ['Miami International Autodrome', 'Miami Gardens, Florida', 25.9581, -80.2389],
  ],
};

const $ = (id) => document.getElementById(id);
const panel = $('world');
const openBtns = document.querySelectorAll('[data-world]');
let view = null; // built on first open, so the page doesn't pay for it until someone asks

// lat/lon to a point on three's SphereGeometry, matching how an equirectangular map wraps it
function toVec(lat, lon, r) {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) / 180) * Math.PI;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}

function build() {
  const canvas = $('worldCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5);
  sun.position.set(-3, 2, 4);
  scene.add(sun);

  const pitch = new THREE.Group();
  const yaw = new THREE.Group();
  pitch.add(yaw);
  scene.add(pitch);
  const map = new THREE.TextureLoader().load('earth.png');
  map.anisotropy = 4;
  yaw.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.35, roughness: 1 })));

  // place markers: small white squares standing on the surface
  const markerGeo = new THREE.BoxGeometry(0.014, 0.014, 0.006);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const markers = {};
  Object.entries(PLACES).forEach(([kind, list]) => {
    markers[kind] = list.map(([, , lat, lon]) => {
      const m = new THREE.Mesh(markerGeo, markerMat);
      m.position.copy(toVec(lat, lon, 1.004));
      m.lookAt(0, 0, 0);
      m.visible = false;
      yaw.add(m);
      return m;
    });
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.028, 32), hiMat);
  ring.visible = false;
  yaw.add(ring);

  // flights: one point per aircraft, a touch above the ground
  const flightGeo = new THREE.BufferGeometry();
  const flights = new THREE.Points(flightGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, sizeAttenuation: false }));
  flights.visible = false;
  yaw.add(flights);

  const state = { yaw: 1.4, pitch: 0.55, dist: 4.2, targetYaw: 1.4, targetPitch: 0.55, targetDist: 4.2, drag: null, pinch: null };

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => view?.open && resize());

  // drag to turn, wheel or pinch to come in
  canvas.addEventListener('pointerdown', (e) => {
    state.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    state.hold = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.drag || state.drag.id !== e.pointerId || state.pinch) return;
    const k = 0.005 * (state.dist / 4.2);
    state.targetYaw += (e.clientX - state.drag.x) * k;
    state.targetPitch = Math.max(-1.3, Math.min(1.3, state.targetPitch + (e.clientY - state.drag.y) * k));
    state.drag.x = e.clientX;
    state.drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { state.drag = null; });
  canvas.addEventListener('pointercancel', () => { state.drag = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.targetDist = Math.max(1.35, Math.min(7, state.targetDist * (1 + Math.sign(e.deltaY) * 0.12)));
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) { state.pinch = null; return; }
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (state.pinch) state.targetDist = Math.max(1.35, Math.min(7, state.targetDist * (state.pinch / d)));
    state.pinch = d;
  }, { passive: true });
  canvas.addEventListener('touchend', () => { state.pinch = null; });

  // turn the globe so a place faces the camera, and come in a little
  function focus(lat, lon) {
    const p = toVec(lat, lon, 1);
    let y = -Math.atan2(p.x, p.z);
    while (y - state.targetYaw > Math.PI) y -= Math.PI * 2;
    while (state.targetYaw - y > Math.PI) y += Math.PI * 2;
    state.targetYaw = y;
    state.targetPitch = Math.atan2(p.y, Math.hypot(p.x, p.z));
    state.targetDist = Math.min(state.targetDist, 2.4);
    state.hold = true; // stay on the picked place until someone drags
    ring.position.copy(toVec(lat, lon, 1.005));
    ring.lookAt(0, 0, 0);
    ring.visible = true;
  }

  let last = performance.now();
  function frame(now) {
    if (!view.open) return;
    window.requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // rAF's timestamp can trail performance.now(); a negative step would push the easing the wrong way
    last = now;
    const ease = 1 - Math.exp(-dt * 6);
    if (!state.drag && !state.hold) state.targetYaw += dt * 0.02; // a slow drift when nobody is holding it
    state.yaw += (state.targetYaw - state.yaw) * ease;
    state.pitch += (state.targetPitch - state.pitch) * ease;
    state.dist += (state.targetDist - state.dist) * ease;
    yaw.rotation.y = state.yaw;
    pitch.rotation.x = state.pitch;
    camera.position.set(0, 0, state.dist);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  return {
    open: false,
    markers,
    flights,
    flightGeo,
    focus,
    start() { resize(); last = performance.now(); window.requestAnimationFrame(frame); },
  };
}

// ---------- the list ----------
const list = $('worldList');
const note = $('worldNote');
let tab = 'airports';
let flightTimer = 0;
let flightData = [];

function showMarkers() {
  Object.entries(view.markers).forEach(([kind, ms]) => ms.forEach((m) => { m.visible = kind === tab; }));
  view.flights.visible = tab === 'flights';
}

function renderList() {
  document.querySelectorAll('[data-world-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.worldTab === tab)));
  if (tab === 'flights') {
    if (!FLIGHTS_URL) {
      note.textContent = 'Live flights are offline right now.';
      list.innerHTML = '';
      return;
    }
    note.textContent = flightData.length ? `${flightData.length.toLocaleString()} aircraft over the US right now. Updates every minute.` : 'Loading flights...';
    const sample = flightData.filter((f) => f[4]).slice(0, 60);
    list.innerHTML = sample.map((f, i) => `<li><button type="button" data-i="${i}"><b>${f[4]}</b><small>${Math.round(f[3]).toLocaleString()} ft</small></button></li>`).join('');
    list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const f = sample[Number(b.dataset.i)]; view.focus(f[0], f[1]); }));
    return;
  }
  const items = PLACES[tab];
  note.textContent = `${items.length} on the globe. Drag to turn it, scroll or pinch to come in, and pick one.`;
  list.innerHTML = items.map(([name, where], i) => `<li><button type="button" data-i="${i}"><b>${name}</b><small>${where}</small></button></li>`).join('');
  list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const [, , lat, lon] = items[Number(b.dataset.i)];
    view.focus(lat, lon);
  }));
}

async function loadFlights() {
  if (!FLIGHTS_URL || !view?.open) return;
  try {
    const r = await fetch(FLIGHTS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    flightData = Array.isArray(data.ac) ? data.ac.filter((f) => Number.isFinite(f[0]) && Number.isFinite(f[1])) : [];
    const pos = new Float32Array(flightData.length * 3);
    flightData.forEach((f, i) => toVec(f[0], f[1], 1.008).toArray(pos, i * 3));
    view.flightGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    view.flightGeo.computeBoundingSphere();
  } catch {
    flightData = [];
    if (tab === 'flights') note.textContent = 'Flights could not be loaded. Try again in a minute.';
    return;
  }
  if (tab === 'flights') renderList();
}

function setTab(next) {
  tab = next;
  showMarkers();
  renderList();
  if (tab === 'flights') loadFlights();
}

function open() {
  if (!window.THREE) return;
  if (!view) view = build();
  panel.hidden = false;
  document.documentElement.classList.add('world-open');
  view.open = true;
  view.start();
  setTab(tab);
  window.clearInterval(flightTimer);
  flightTimer = window.setInterval(loadFlights, 60000);
  $('worldExit').focus();
}

function close() {
  panel.hidden = true;
  document.documentElement.classList.remove('world-open');
  if (view) view.open = false;
  window.clearInterval(flightTimer);
}

openBtns.forEach((b) => b.addEventListener('click', open));
$('worldExit').addEventListener('click', close);
document.querySelectorAll('[data-world-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.worldTab)));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
if (location.hash === '#world') open();
