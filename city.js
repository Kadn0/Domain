// The homelab as a 3D city: a gateway hub in the middle, one district per chapter, traffic on the roads.
// The camera flies to whichever chapter site.js marks as current (html[data-chapter]).
const THREE = window.THREE;
const root = document.documentElement;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (error) {
    return false;
  }
}

if (THREE && webglAvailable()) {
  try {
    build();
  } catch (error) {
    // the 2D map stays as the fallback
    root.classList.remove('three');
    console.error('city: 3D scene failed, using the flat map', error);
  }
}

function build() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => window.innerWidth < 900;
  const canvas = document.getElementById('city');
  const labelLayer = document.getElementById('labels');
  const readout = document.getElementById('fieldWidth');
  const readoutMeta = document.getElementById('fieldMeta');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow() ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const BG = 0x1d1f21;
  renderer.setClearColor(BG, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 80, 210);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 700);

  scene.add(new THREE.HemisphereLight(0xdadbd6, 0x121314, 0.62));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(45, 90, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(narrow() ? 1024 : 2048, narrow() ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 10, far: 240 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // ---------- Materials ----------
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.04, ...extra });
  const M = {
    dark: std(0x2a2c2f),
    mid: std(0x3b3e42),
    light: std(0xd2d1cc),
    ground: std(0x232528),
    road: std(0x303235),
    glow: new THREE.MeshBasicMaterial({ color: 0xeeede8 }),
  };
  const INK = new THREE.Color(0xe4e3de);
  const LINE = new THREE.LineBasicMaterial({ color: INK.clone(), transparent: true, opacity: 0.55 });
  const LINE_SOFT = new THREE.LineBasicMaterial({ color: INK.clone(), transparent: true, opacity: 0.28 });
  const LINE_FAINT = new THREE.LineBasicMaterial({ color: INK.clone(), transparent: true, opacity: 0.09 });

  // ---------- Small helpers ----------
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rad = (deg) => (deg * Math.PI) / 180;
  const polar = (deg, r) => [Math.cos(rad(deg)) * r, Math.sin(rad(deg)) * r];
  const city = new THREE.Group();
  scene.add(city);

  function mesh(geo, mat, x, y, z, parent = city, opts = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    if (opts.edges !== false) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), opts.line || LINE));
    parent.add(m);
    return m;
  }
  // a box standing on y (its base), not centred on it
  const box = (w, h, d, x, y, z, mat = M.dark, parent = city, opts) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, parent, opts);

  function lines(points, mat = LINE, parent = city) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const seg = new THREE.LineSegments(geo, mat);
    parent.add(seg);
    return seg;
  }

  function circle(r, y, mat = LINE_FAINT, parent = city, seg = 160) {
    const pts = [];
    for (let i = 0; i <= seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    parent.add(l);
    return l;
  }

  // scaffold: corner posts with X bracing on every face, the look of the reference's lattice towers
  function lattice(x, z, w, h, segs, parent = city, y0 = 0, mat = LINE) {
    const v = [];
    const c = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
    const step = h / segs;
    c.forEach(([cx, cz]) => v.push(x + cx, y0, z + cz, x + cx, y0 + h, z + cz));
    for (let s = 0; s <= segs; s += 1) {
      const y = y0 + s * step;
      for (let i = 0; i < 4; i += 1) {
        const a = c[i];
        const b = c[(i + 1) % 4];
        v.push(x + a[0], y, z + a[1], x + b[0], y, z + b[1]);
        if (s < segs) {
          v.push(x + a[0], y, z + a[1], x + b[0], y + step, z + b[1]);
          v.push(x + b[0], y, z + b[1], x + a[0], y + step, z + a[1]);
        }
      }
    }
    return lines(v, mat, parent);
  }

  function texture(draw, w = 128, h = 256) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }
  function windows(cols, rows, lit) {
    return (g, w, h) => {
      g.fillStyle = '#1f2123';
      g.fillRect(0, 0, w, h);
      const cw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r += 1) {
        for (let k = 0; k < cols; k += 1) {
          g.fillStyle = rand() < lit ? '#dcdbd6' : '#3a3d41';
          g.fillRect(k * cw + cw * 0.22, r * rh + rh * 0.28, cw * 0.56, rh * 0.36);
        }
      }
    };
  }
  const stripes = (g, w, h) => {
    g.fillStyle = '#26282b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d6d5d0';
    for (let y = 18; y < h; y += 46) g.fillRect(0, y, w, 7);
  };
  const towerGrids = [[4, 10, 0.3], [6, 14, 0.18], [3, 8, 0.4]];
  const towerMats = towerGrids.map(([c, r, lit]) => std(0xffffff, { map: texture(windows(c, r, lit)) }));
  // the city keeps the visitor's hours: more windows lit when it's evening where they are
  const litChance = () => {
    const h = new Date().getHours();
    return h >= 19 || h < 6 ? 0.5 : h >= 17 ? 0.38 : 0.22;
  };
  // someone is always switching a light on or off somewhere in the city
  function twinkle() {
    const n = Math.floor(rand() * towerMats.length);
    const [cols, rows] = towerGrids[n];
    const tex = towerMats[n].map;
    const g = tex.image.getContext('2d');
    const cw = tex.image.width / cols;
    const rh = tex.image.height / rows;
    for (let i = 0; i < 3; i += 1) {
      g.fillStyle = rand() < litChance() ? '#dcdbd6' : '#3a3d41';
      g.fillRect(Math.floor(rand() * cols) * cw + cw * 0.22, Math.floor(rand() * rows) * rh + rh * 0.28, cw * 0.56, rh * 0.36);
    }
    tex.needsUpdate = true;
  }
  const stripeMat = std(0xffffff, { map: texture(stripes) });

  // ---------- Ground: a circuit board of rings and traces ----------
  const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 120), M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  [5, 14, 19, 24, 31, 44, 50, 58, 70, 84, 100, 120].forEach((r) => circle(r, 0.03));
  const traces = [];
  for (let d = 0; d < 360; d += 7.5) {
    const [x1, z1] = polar(d, 12);
    const [x2, z2] = polar(d, 130);
    traces.push(x1, 0.03, z1, x2, 0.03, z2);
  }
  lines(traces, LINE_FAINT);

  // ---------- Roads ----------
  const DISTRICTS = [0, 45, 90, 135, 180, 225, 270, 315];
  const ringRoad = (r1, r2, y, parent = city) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r1, r2, 128), M.road);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    parent.add(m);
    circle(r1, y + 0.02, LINE_SOFT, parent);
    circle(r2, y + 0.02, LINE_SOFT, parent);
  };
  ringRoad(8, 10.5, 0.06);
  DISTRICTS.forEach((deg) => {
    const [x, z] = polar(deg, 22.5);
    const road = box(24, 0.12, 2.6, x, 0, z, M.road, city, { line: LINE_SOFT, cast: false });
    road.rotation.y = -rad(deg);
  });
  // the raised outer ring, on pillars, the way the reference's highways sit over everything
  const HIGH = 4.2;
  ringRoad(35, 37.6, HIGH);
  const under = new THREE.Mesh(new THREE.RingGeometry(35, 37.6, 128), M.dark);
  under.rotation.x = Math.PI / 2;
  under.position.y = HIGH - 0.05;
  city.add(under);
  circle(35, HIGH + 0.6, LINE_SOFT);
  circle(37.6, HIGH + 0.6, LINE_SOFT);
  for (let d = 0; d < 360; d += 9) {
    const [x, z] = polar(d, 36.3);
    box(0.7, HIGH, 0.7, x, 0, z, M.mid, city, { line: LINE_SOFT });
  }

  // ---------- Labels: anchors in the world, drawn as HTML tags on leader lines ----------
  const anchors = {};
  const tags = {};
  function anchor(id, text, x, y, z) {
    anchors[id] = new THREE.Vector3(x, y, z);
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<span>${text}</span>`;
    labelLayer.appendChild(el);
    tags[id] = el;
  }
  // place a district: a group at angle deg, radius r, with local +x pointing away from the hub
  function district(deg, r) {
    const g = new THREE.Group();
    const [x, z] = polar(deg, r);
    g.position.set(x, 0, z);
    g.rotation.y = -rad(deg);
    city.add(g);
    g.updateMatrixWorld(true); // world() below needs the placement before the first render
    return g;
  }
  const world = (g, x, y, z) => g.localToWorld(new THREE.Vector3(x, y, z));
  const animators = [];

  // ---------- Hub: the gateway ----------
  const hub = new THREE.Group();
  city.add(hub);
  mesh(new THREE.CylinderGeometry(7.4, 7.4, 0.6, 64), M.mid, 0, 0.3, 0, hub);
  [[1.5, M.dark], [4.3, M.mid], [7.1, M.dark]].forEach(([y, mat]) => mesh(new THREE.CylinderGeometry(3.6, 3.8, 2.4, 40), mat, 0, y, 0, hub));
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    box(0.9, 0.7, 0.1, Math.cos(a) * 3.85, 3.95, Math.sin(a) * 3.85, M.glow, hub, { edges: false, cast: false }).rotation.y = -a + Math.PI / 2;
  }
  const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 1.7, 0.14), M.dark, 84);
  const tmp = new THREE.Object3D();
  for (let i = 0; i < 84; i += 1) {
    const a = (i / 84) * Math.PI * 2;
    tmp.position.set(Math.cos(a) * 5.6, 1.45, Math.sin(a) * 5.6);
    tmp.rotation.set(0, -a, 0);
    tmp.updateMatrix();
    fins.setMatrixAt(i, tmp.matrix);
  }
  fins.castShadow = true;
  const finRing = new THREE.Group();
  finRing.add(fins);
  circle(4.5, 2.32, LINE_SOFT, finRing);
  circle(6.7, 2.32, LINE_SOFT, finRing);
  hub.add(finRing);
  lines([0, 8.4, 0, 0, 34, 0], LINE_SOFT, hub);
  animators.push((t) => { finRing.rotation.y = t * 0.08; });
  anchor('gw', 'GATEWAY', 0, 9, 0);

  // ---------- 02 Front door: Cloudflare gate and the internet floating above ----------
  const gate = district(0, 30);
  box(1.3, 7.5, 1.3, 0, 0, -2.4, M.mid, gate);
  box(1.3, 7.5, 1.3, 0, 0, 2.4, M.mid, gate);
  box(1.8, 1.3, 6.4, 0, 7.5, 0, M.dark, gate);
  box(1.85, 0.3, 6.45, 0, 8.1, 0, M.glow, gate, { edges: false, cast: false });
  box(0.8, 2.6, 8, 0, 0, -7.8, M.dark, gate);
  box(0.8, 2.6, 8, 0, 0, 7.8, M.dark, gate);
  box(2.2, 2.4, 2.2, 2.6, 0, -4.4, M.mid, gate);
  box(1.2, 0.6, 0.06, 2.6, 1.4, -3.28, M.glow, gate, { edges: false, cast: false });
  const armGeo = new THREE.BoxGeometry(0.16, 0.16, 4.2);
  armGeo.translate(0, 0, 2.1);
  const arm = mesh(armGeo, M.light, -1.6, 1.2, -2.2, gate);
  lattice(5, 7, 1.8, 15, 6, gate);
  animators.push((t) => {
    const phase = (t * 0.35) % 1;
    arm.rotation.x = -Math.min(1, Math.max(0, Math.sin(phase * Math.PI) * 1.6)) * 1.25;
  });
  const inet = new THREE.Group();
  const [ix, iz] = polar(0, 54);
  inet.position.set(ix, 27, iz);
  mesh(new THREE.IcosahedronGeometry(5, 0), M.mid, 0, 0, 0, inet);
  city.add(inet);
  animators.push((t) => { inet.rotation.set(t * 0.12, t * 0.2, 0); });
  const fan = [];
  for (let i = 0; i < 18; i += 1) {
    const p = world(gate, (rand() - 0.5) * 3, 8.5, (rand() - 0.5) * 6);
    fan.push(ix, 27, iz, p.x, p.y, p.z);
  }
  lines(fan, LINE_SOFT);
  // packets sliding down the beam from the internet to the gate
  const beamPackets = Array.from({ length: 16 }, () => ({ line: Math.floor(rand() * 18), t: rand(), speed: 0.25 + rand() * 0.3 }));
  const beamMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), M.glow, beamPackets.length);
  city.add(beamMesh);
  animators.push((t, dt) => {
    beamPackets.forEach((p, n) => {
      p.t += p.speed * dt;
      if (p.t > 1) {
        p.t = 0;
        p.line = Math.floor(Math.random() * 18);
      }
      const f = fan.slice(p.line * 6, p.line * 6 + 6);
      tmp.position.set(f[0] + (f[3] - f[0]) * p.t, f[1] + (f[4] - f[1]) * p.t, f[2] + (f[5] - f[2]) * p.t);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      beamMesh.setMatrixAt(n, tmp.matrix);
    });
    beamMesh.instanceMatrix.needsUpdate = true;
  });
  anchor('inet', 'INTERNET', ix, 33, iz);
  const cfTop = world(gate, 0, 9, 0);
  anchor('cf', 'CLOUDFLARE', cfTop.x, cfTop.y, cfTop.z);

  // ---------- 03 Network: the DNS Pi under its filter dome, with a mast ----------
  const dns = district(45, 26);
  box(5.2, 0.6, 4.2, 0, 0, 0, M.mid, dns);
  box(3.4, 0.25, 2.3, 0, 0.6, 0, M.dark, dns);
  [[-0.8, -0.4], [0.6, 0.3], [1.1, -0.6]].forEach(([x, z]) => box(0.7, 0.3, 0.7, x, 0.85, z, M.light, dns, { cast: false }));
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5.4, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: INK, wireframe: true, transparent: true, opacity: 0.1 })
  );
  dns.add(dome);
  lattice(-4, 4, 2.2, 21, 9, dns);
  const beacon = box(0.6, 0.6, 0.6, -4, 21.2, 4, M.glow, dns, { edges: false, cast: false });
  animators.push((t) => { beacon.visible = Math.sin(t * 3) > 0; });
  // lookups arriving at the dome: most are let through, ad and tracker lookups bounce off
  const lookups = Array.from({ length: 14 }, () => ({ a: rand() * Math.PI * 2, r: 6 + rand() * 9, y: 1 + rand() * 3, dir: -1, blocked: rand() < 0.45, speed: 2.5 + rand() * 2 }));
  const lookupMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), M.glow, lookups.length);
  dns.add(lookupMesh);
  animators.push((t, dt) => {
    lookups.forEach((l, n) => {
      l.r += l.dir * l.speed * dt;
      if (l.dir < 0 && l.blocked && l.r < 5.6) l.dir = 1;
      if (l.r < 0.6 || l.r > 15) Object.assign(l, { a: Math.random() * Math.PI * 2, r: 15, dir: -1, blocked: Math.random() < 0.45 });
      tmp.position.set(Math.cos(l.a) * l.r, l.y * Math.min(1, l.r / 5.6), Math.sin(l.a) * l.r);
      tmp.rotation.set(0, l.a, 0);
      tmp.updateMatrix();
      lookupMesh.setMatrixAt(n, tmp.matrix);
    });
    lookupMesh.instanceMatrix.needsUpdate = true;
  });
  const dnsTop = world(dns, 0, 1.4, 0);
  anchor('dns', 'DNS PI', dnsTop.x, dnsTop.y, dnsTop.z);

  // ---------- 04 Media: NAS tower, media server, Jellyfin screen, Seerr box ----------
  const media = district(90, 27);
  const nasTex = texture(windows(6, 16, 0.32));
  const nasMat = std(0xffffff, { map: nasTex });
  box(7, 19, 7, 3, 0, -4, nasMat, media);
  box(7.4, 0.8, 7.4, 3, 19, -4, M.dark, media);
  box(5, 7, 5, 3, 0, 5.5, stripeMat, media);
  lattice(3, 5.5, 5.6, 4, 2, media, 7);
  box(0.5, 4, 0.5, -4, 0, -4, M.mid, media);
  box(0.5, 4, 0.5, -4, 0, 4, M.mid, media);
  box(0.5, 6.4, 10.4, -4, 4, 0, M.dark, media);
  // Jellyfin is playing an original short: Finley the dog out for a walk, with the player UI over it
  const screenTex = texture(() => {}, 384, 228);
  const RUNTIME = 22 * 60 + 30;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function drawShow(t) {
    const g = screenTex.image.getContext('2d');
    const W = 384;
    const H = 228;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8fc6ee');
    sky.addColorStop(1, '#e6f3fb');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd56b';
    g.beginPath();
    g.arc(312, 46, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i += 1) {
      const x = ((i * 150 - t * 8) % 540 + 540) % 540 - 80;
      [[0, 0, 22], [20, -8, 18], [38, 2, 16]].forEach(([dx, dy, r]) => {
        g.beginPath();
        g.arc(x + dx, 40 + i * 14 + dy, r, 0, Math.PI * 2);
        g.fill();
      });
    }
    const hill = (color, base, amp, freq, speed) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, base + Math.sin((x + t * speed) * freq) * amp);
      g.lineTo(W, H);
      g.fill();
    };
    hill('#9cc98a', 150, 12, 0.012, 14);
    hill('#6fae63', 172, 7, 0.02, 34);
    // trees go past at walking speed
    for (let i = 0; i < 4; i += 1) {
      const x = ((i * 120 - t * 34) % 480 + 480) % 480 - 40;
      g.fillStyle = '#6b4a2b';
      g.fillRect(x - 3, 150, 6, 22);
      g.fillStyle = '#4f8f4a';
      g.beginPath();
      g.arc(x, 145, 15, 0, Math.PI * 2);
      g.fill();
    }
    // Finley
    const step = Math.sin(t * 9);
    const bob = Math.abs(Math.cos(t * 9)) * 2;
    const dx = 130;
    const dy = 160 - bob;
    g.strokeStyle = '#5a3a1e';
    g.lineWidth = 5;
    g.lineCap = 'round';
    [[-18, step], [-8, -step], [14, -step], [24, step]].forEach(([lx, s]) => {
      g.beginPath();
      g.moveTo(dx + lx, dy + 6);
      g.lineTo(dx + lx + s * 6, dy + 22 + bob);
      g.stroke();
    });
    g.beginPath();
    g.moveTo(dx - 26, dy - 4);
    g.quadraticCurveTo(dx - 40, dy - 18 + Math.sin(t * 16) * 6, dx - 34, dy - 26 + Math.sin(t * 16) * 4);
    g.stroke();
    g.fillStyle = '#9a6634';
    g.beginPath();
    g.ellipse(dx, dy, 30, 14, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(dx + 32, dy - 14, 13, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(dx + 45, dy - 10, 9, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a3a1e';
    g.beginPath();
    g.ellipse(dx + 26, dy - 18, 6, 11, 0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.arc(dx + 37, dy - 18, 2.2, 0, Math.PI * 2);
    g.arc(dx + 53, dy - 11, 3, 0, Math.PI * 2);
    g.fill();
    // a ball that keeps getting away from him
    const bx = dx + 90 + Math.sin(t * 0.7) * 30;
    const by = 174 - Math.abs(Math.sin(t * 3.2)) * 34;
    g.fillStyle = '#e8574a';
    g.beginPath();
    g.arc(bx, by, 8, 0, Math.PI * 2);
    g.fill();
    // player chrome
    const pos = (t * 4) % RUNTIME;
    g.fillStyle = 'rgba(16,17,19,0.62)';
    g.fillRect(0, 0, W, 22);
    g.fillRect(0, H - 44, W, 44);
    g.fillStyle = '#e4e3de';
    g.font = 'bold 11px monospace';
    g.fillText('JELLYFIN  ·  NOW PLAYING', 10, 15);
    g.font = 'bold 13px sans-serif';
    g.fillText("Finley's Big Day", 34, H - 26);
    g.font = '10px monospace';
    g.fillText(`S1 · E3   ${mmss(pos)} / ${mmss(RUNTIME)}`, 34, H - 12);
    g.beginPath();
    g.moveTo(12, H - 36);
    g.lineTo(12, H - 18);
    g.lineTo(26, H - 27);
    g.fill();
    g.fillStyle = 'rgba(228,227,222,0.3)';
    g.fillRect(190, H - 22, 180, 3);
    g.fillStyle = '#aa5cc3';
    g.fillRect(190, H - 22, 180 * (pos / RUNTIME), 3);
    screenTex.needsUpdate = true;
  }
  drawShow(0);
  let showClock = 0;
  animators.push((t) => {
    if (t - showClock < 1 / 15) return;
    showClock = t;
    drawShow(t);
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 5.8), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(-4.27, 7.2, 0);
  screen.rotation.y = -Math.PI / 2;
  media.add(screen);

  // The real thing on the Jellyfin screen: YouTube's own player laid over the 3D screen with CSS3D.
  // It sits above the WebGL canvas, so it only shows in the Media chapter, where nothing stands in front of it.
  const TV_VIDEO = '9v0tJsY61HU';
  const tv = { ready: false, on: false, unmuted: false };
  if (THREE.CSS3DRenderer && THREE.CSS3DObject) {
    tv.renderer = new THREE.CSS3DRenderer();
    tv.renderer.domElement.id = 'tv';
    canvas.after(tv.renderer.domElement);
    tv.scene = new THREE.Scene();
    tv.frame = document.createElement('div');
    tv.frame.className = 'tv-frame';
    tv.object = new THREE.CSS3DObject(tv.frame);
    screen.updateMatrixWorld(true);
    screen.getWorldPosition(tv.object.position);
    screen.getWorldQuaternion(tv.object.quaternion);
    tv.object.scale.setScalar(0.01); // the frame is 992×592 CSS pixels: the 9.8×5.8 screen plus a hair, so no cartoon peeks out at the edges
    tv.scene.add(tv.object);
    tv.button = document.createElement('button');
    tv.button.type = 'button';
    tv.button.className = 'tv-sound';
    tv.button.textContent = 'Sound off';
    tv.button.setAttribute('aria-pressed', 'false');
    labelLayer.after(tv.button);
    const command = (func) => tv.iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
    tv.setSound = (on) => {
      tv.unmuted = on;
      command(on ? 'unMute' : 'mute');
      if (on) command('playVideo');
      tv.button.textContent = on ? 'Sound on' : 'Sound off';
      tv.button.setAttribute('aria-pressed', String(on));
    };
    tv.button.addEventListener('click', () => tv.setSound(!tv.unmuted));
    tv.load = () => {
      if (tv.ready) return;
      tv.ready = true;
      tv.iframe = document.createElement('iframe');
      tv.iframe.src = `https://www.youtube-nocookie.com/embed/${TV_VIDEO}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&enablejsapi=1`;
      tv.iframe.title = 'Now playing on the Jellyfin screen';
      tv.iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      tv.iframe.tabIndex = -1;
      tv.frame.appendChild(tv.iframe);
    };
  }
  const tvCorner = world(media, -4.4, 4.4, -4.6);
  box(1.3, 1.8, 1.1, -3, 0, 8.4, M.mid, media);
  box(0.9, 0.12, 0.06, -3.66, 1.3, 8.4, M.glow, media, { edges: false, cast: false }).rotation.y = Math.PI / 2;
  let nasClock = 0;
  animators.push((t) => {
    if (t - nasClock < 0.35) return;
    nasClock = t;
    const g = nasTex.image.getContext('2d');
    const cw = nasTex.image.width / 6;
    const rh = nasTex.image.height / 16;
    for (let i = 0; i < 10; i += 1) {
      const k = Math.floor(rand() * 6);
      const r = Math.floor(rand() * 16);
      g.fillStyle = rand() < 0.4 ? '#dcdbd6' : '#3a3d41';
      g.fillRect(k * cw + cw * 0.22, r * rh + rh * 0.28, cw * 0.56, rh * 0.36);
    }
    nasTex.needsUpdate = true;
  });
  [['nas', 'NAS', 3, 20, -4], ['media', 'MEDIA SERVER', 3, 11, 5.5], ['jelly', 'JELLYFIN', -4, 10.8, 0], ['seerr', 'SEERR', -3, 2.4, 8.4]].forEach(([id, text, x, y, z]) => {
    const p = world(media, x, y, z);
    anchor(id, text, p.x, p.y, p.z);
  });

  // ---------- 05 Minecraft: a voxel island with a tree and a creeper ----------
  const mc = district(135, 27);
  const blocks = [];
  const tops = [];
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      if (i * i + j * j > 20) continue;
      const h = 1 + Math.round(1.6 * (Math.sin(i * 0.9) + Math.cos(j * 0.8) + 1.2));
      for (let y = 0; y < h - 1; y += 1) blocks.push([i, y, j]);
      tops.push([i, h - 1, j]);
    }
  }
  const trunkAt = [1, 0, -1];
  const trunkBase = tops.find(([i, , j]) => i === trunkAt[0] && j === trunkAt[2]);
  const ty = trunkBase ? trunkBase[1] + 1 : 3;
  for (let y = 0; y < 3; y += 1) blocks.push([1, ty + y, -1]);
  const leaves = [];
  for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (let y = 0; y < 2; y += 1) leaves.push([1 + i, ty + 3 + y, -1 + j]);
  function voxels(list, mat) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    const edges = [];
    const unit = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)).attributes.position.array;
    list.forEach(([x, y, z], n) => {
      tmp.position.set(x, y + 0.5, z);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      inst.setMatrixAt(n, tmp.matrix);
      for (let k = 0; k < unit.length; k += 3) edges.push(unit[k] + x, unit[k + 1] + y + 0.5, unit[k + 2] + z);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    mc.add(inst);
    lines(edges, LINE_SOFT, mc);
  }
  voxels(blocks, M.dark);
  voxels(tops, M.mid);
  voxels(leaves, M.light);
  const creeperBase = tops.find(([i, , j]) => i === -2 && j === 1);
  const cy = creeperBase ? creeperBase[1] + 1 : 3;
  box(0.7, 1.3, 0.45, -2, cy, 1, M.mid, mc);
  box(0.75, 0.75, 0.75, -2, cy + 1.3, 1, M.mid, mc);
  box(0.06, 0.18, 0.18, -2.39, cy + 1.75, 0.85, M.glow, mc, { edges: false, cast: false });
  box(0.06, 0.18, 0.18, -2.39, cy + 1.75, 1.15, M.glow, mc, { edges: false, cast: false });
  const mcHome = mc.position.clone();
  const mcTop = world(mc, 0, ty + 6, 0);
  anchor('mc', 'MINECRAFT', mcTop.x, mcTop.y, mcTop.z);

  // ---------- 06 LED: a billboard showing the page's own 64x64 matrix ----------
  const led = district(180, 27);
  box(0.7, 7, 0.7, 1, 0, -5.4, M.mid, led);
  box(0.7, 7, 0.7, 1, 0, 5.4, M.mid, led);
  box(1, 12.4, 12.4, 1.2, 6.4, 0, M.dark, led);
  const ledCanvas = document.getElementById('led');
  const ledTex = ledCanvas ? new THREE.CanvasTexture(ledCanvas) : null;
  const ledFace = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 11.6), new THREE.MeshBasicMaterial({ map: ledTex, color: ledTex ? 0xffffff : 0x111214 }));
  ledFace.position.set(0.68, 12.6, 0);
  ledFace.rotation.y = -Math.PI / 2;
  led.add(ledFace);
  box(3, 0.6, 3, -2, 0, 7, M.mid, led);
  box(2, 0.2, 1.3, -2, 0.6, 7, M.dark, led);
  lines([-2, 0.8, 7, 1, 6.5, 5.4], LINE_SOFT, led);
  if (ledTex) animators.push(() => { ledTex.needsUpdate = true; });
  const ledTop = world(led, 1, 19.5, 0);
  anchor('ledpanel', '64×64 LED', ledTop.x, ledTop.y, ledTop.z);
  const ledPi = world(led, -2, 1.2, 7);
  anchor('ledpi', 'LED PI', ledPi.x, ledPi.y, ledPi.z);

  // ---------- 07 Lab bench: desk, tower, monitors and the radio dish ----------
  const lab = district(225, 27);
  box(4, 0.35, 8.5, 0, 3, 0, M.mid, lab);
  [[-1.7, -4], [1.7, -4], [-1.7, 4], [1.7, 4]].forEach(([x, z]) => box(0.3, 3, 0.3, x, 0, z, M.dark, lab));
  box(2, 4.4, 4.2, 0.6, 0, 6.6, towerMats[0], lab);
  // the monitors run the LLM Scanner: a garak scan filling its probe bars, and a chat beside it
  const probes = [0.2, 0.5, 0.8, 0.35, 0.6, 0.1];
  const scanTex = texture(() => {}, 256, 160);
  const drawScan = () => {
    const g = scanTex.image.getContext('2d');
    g.fillStyle = '#d9d8d3';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#25272a';
    g.font = 'bold 14px monospace';
    g.fillText('GARAK  OWASP LLM TOP 10', 14, 24);
    probes.forEach((p, i) => {
      g.fillStyle = '#b9b8b3';
      g.fillRect(14, 40 + i * 19, 228, 9);
      g.fillStyle = '#25272a';
      g.fillRect(14, 40 + i * 19, 228 * p, 9);
    });
    scanTex.needsUpdate = true;
  };
  drawScan();
  const chatTex = texture((g) => {
    g.fillStyle = '#d9d8d3';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#25272a';
    [[120, 18, 120, 26], [16, 54, 150, 34], [100, 98, 140, 22], [16, 128, 110, 22]].forEach(([x, y, w, h]) => g.fillRect(x, y, w, h));
  }, 256, 160);
  [[-2, scanTex], [2, chatTex]].forEach(([z, map]) => {
    box(0.25, 2.3, 3.4, 0.6, 3.6, z, M.dark, lab);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2), new THREE.MeshBasicMaterial({ map }));
    s.position.set(0.46, 4.75, z);
    s.rotation.y = -Math.PI / 2;
    lab.add(s);
  });
  let scanClock = 0;
  animators.push((t) => {
    if (t - scanClock < 0.4) return;
    scanClock = t;
    probes.forEach((p, i) => { probes[i] = p >= 1 ? 0 : Math.min(1, p + Math.random() * 0.12); });
    drawScan();
  });
  box(1.2, 0.1, 3, -0.6, 3.35, 0, M.light, lab, { cast: false });
  box(0.35, 9, 0.35, 2, 0, -8, M.mid, lab);
  const dish = new THREE.Group();
  dish.position.set(2, 9.2, -8);
  lab.add(dish);
  const bowl = mesh(new THREE.SphereGeometry(2.6, 24, 10, 0, Math.PI * 2, 0, 0.95), std(0x3b3e42, { side: THREE.DoubleSide }), 0, 0, 0, dish);
  bowl.rotation.x = Math.PI / 2.4;
  lines([0, 0, 0, 0, -1.2, 2.2], LINE, dish);
  animators.push((t) => { dish.rotation.y = t * 0.4; });
  // radio waves rising off the dish
  const waves = [0, 0.5].map((phase) => {
    const mat = new THREE.LineBasicMaterial({ color: INK.clone(), transparent: true, opacity: 0.5 });
    const ring = circle(1, 0, mat, lab, 48);
    return { ring, mat, phase };
  });
  animators.push((t) => waves.forEach((w) => {
    const p = (t * 0.45 + w.phase) % 1;
    w.ring.position.set(2, 11.5 + p * 7, -8);
    w.ring.scale.setScalar(1.5 + p * 6);
    w.mat.opacity = 0.5 * (1 - p);
  }));
  const deskTop = world(lab, 0, 7.4, 0);
  anchor('desk', 'LLM SCANNER', deskTop.x, deskTop.y, deskTop.z);
  const radioTop = world(lab, 2, 12.4, -8);
  anchor('radio', 'RADIO PI', radioTop.x, radioTop.y, radioTop.z);
  // a 3D printer on its own stand: the head sweeps back and forth while the print grows a layer at a time
  box(3.6, 2.6, 3.6, -3.2, 0, -5.6, M.dark, lab);
  const pFrame = [];
  [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]].forEach(([x, z]) => pFrame.push(-3.2 + x, 2.6, -5.6 + z, -3.2 + x, 6.4, -5.6 + z));
  pFrame.push(-4.8, 6.4, -7.2, -1.6, 6.4, -7.2, -4.8, 6.4, -4, -1.6, 6.4, -4, -4.8, 6.4, -7.2, -4.8, 6.4, -4, -1.6, 6.4, -7.2, -1.6, 6.4, -4);
  lines(pFrame, LINE, lab);
  box(3, 0.12, 3, -3.2, 2.6, -5.6, M.mid, lab, { line: LINE_SOFT });
  const gantry = box(0.2, 0.2, 3.2, -3.2, 4.5, -5.6, M.light, lab, { cast: false });
  const head = box(0.6, 0.6, 0.6, -3.2, 4.3, -5.6, M.light, lab, { cast: false });
  const printGeo = new THREE.CylinderGeometry(0.7, 0.9, 1, 6);
  printGeo.translate(0, 0.5, 0);
  const print = mesh(printGeo, M.glow, -3.2, 2.72, -5.6, lab, { line: LINE_SOFT });
  animators.push((t) => {
    const layer = (t * 0.08) % 1;
    print.scale.set(1, 0.02 + layer * 1.4, 1);
    const top = 2.72 + (0.02 + layer * 1.4);
    gantry.position.y = head.position.y = top + 0.35;
    head.position.x = -3.2 + Math.sin(t * 6) * 0.7;
    head.position.z = -5.6 + Math.cos(t * 4.3) * 0.7;
    gantry.position.x = head.position.x;
  });
  const printerTop = world(lab, -3.2, 6.9, -5.6);
  anchor('printer', '3D PRINTER', printerTop.x, printerTop.y, printerTop.z);

  // ---------- 10 Off the clock: a giant retro handheld playing snake at the edge of town ----------
  const HANDHELD_AT = [160, 45];
  const arcade = district(...HANDHELD_AT);
  const handheld = new THREE.Group();
  handheld.position.set(0, 0, 0);
  handheld.rotation.z = 0.12; // leaning back a little, like it's propped up
  arcade.add(handheld);
  box(3.2, 1, 9, 1.2, 0, 0, M.mid, arcade);
  box(1.6, 7.2, 13, 0, 0.6, 0, M.light, handheld);
  box(0.2, 5, 6.6, -0.82, 1.7, 0, M.dark, handheld, { cast: false });
  const lcd = texture(() => {}, 96, 64);
  const lcdFace = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ map: lcd }));
  lcd.magFilter = THREE.NearestFilter;
  lcdFace.position.set(-0.93, 4.2, 0);
  lcdFace.rotation.y = -Math.PI / 2;
  handheld.add(lcdFace);
  box(0.2, 0.7, 2.2, -0.85, 3.7, -4.9, M.dark, handheld, { cast: false });
  box(0.2, 2.2, 0.7, -0.85, 2.95, -4.9, M.dark, handheld, { cast: false });
  [[3.8, 4.6], [4.6, 5.4]].forEach(([y, z]) => {
    const b = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16), M.dark, -0.85, y, z, handheld, { cast: false });
    b.rotation.z = Math.PI / 2;
  });
  [-0.9, 0.9].forEach((z) => box(0.15, 0.25, 1.2, -0.84, 1.3, z, M.dark, handheld, { edges: false, cast: false }));
  // snake that chases its food around the little screen
  const snake = { body: [[6, 8], [5, 8], [4, 8]], food: [16, 5] };
  function drawLcd() {
    const g = lcd.image.getContext('2d');
    g.fillStyle = '#c3c8b8';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#2b2e27';
    snake.body.forEach(([x, y]) => g.fillRect(x * 4, y * 4, 3, 3));
    g.fillRect(snake.food[0] * 4 + 1, snake.food[1] * 4 + 1, 2, 2);
    g.fillRect(0, 0, 96, 1);
    g.fillRect(0, 63, 96, 1);
    lcd.needsUpdate = true;
  }
  function stepSnake() {
    const [hx, hy] = snake.body[0];
    const [fx, fy] = snake.food;
    const next = hx !== fx ? [hx + Math.sign(fx - hx), hy] : [hx, hy + Math.sign(fy - hy)];
    snake.body.unshift(next);
    if (next[0] === fx && next[1] === fy) {
      snake.food = [1 + Math.floor(Math.random() * 22), 1 + Math.floor(Math.random() * 14)];
      if (snake.body.length > 24) snake.body.length = 3;
    } else snake.body.pop();
    drawLcd();
  }
  drawLcd();
  let snakeClock = 0;
  animators.push((t) => {
    if (t - snakeClock < 0.14) return;
    snakeClock = t;
    stepSnake();
  });
  const hhTop = world(arcade, 0, 9.4, 0);
  anchor('handheld', 'RETRO HANDHELD', hhTop.x, hhTop.y, hhTop.z);

  // ---------- 08 Services: the Launcher plaza ----------
  const plaza = district(270, 27);
  mesh(new THREE.CylinderGeometry(8.4, 8.4, 0.8, 64), M.mid, 0, 0.4, 0, plaza);
  for (let i = 0; i < 20; i += 1) {
    const a = (i / 20) * Math.PI * 2;
    box(0.4, 3.6, 0.4, Math.cos(a) * 7.4, 0.8, Math.sin(a) * 7.4, M.dark, plaza);
  }
  circle(7.4, 4.4, LINE, plaza, 80);
  box(2.2, 10, 2.2, 0, 0.8, 0, M.dark, plaza);
  box(2.25, 0.5, 2.25, 0, 7.5, 0, M.glow, plaza, { edges: false, cast: false });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(4, 0.1, 8, 80), M.glow);
  halo.position.y = 13;
  halo.rotation.x = Math.PI / 2;
  plaza.add(halo);
  const kiosks = [];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 4.6;
    const z = Math.sin(a) * 4.6;
    box(1.4, 1.6, 1.4, x, 0.8, z, M.light, plaza);
    kiosks.push(0, 10.8, 0, x, 2.4, z);
  }
  lines(kiosks, LINE_SOFT, plaza);
  animators.push((t) => {
    halo.position.y = 13 + Math.sin(t * 1.2) * 0.6;
    halo.rotation.z = t * 0.5;
  });
  const lTop = world(plaza, 0, 15, 0);
  anchor('launch', 'LAUNCHER', lTop.x, lTop.y, lTop.z);

  // ---------- Helpers Pi: a stacked cluster case ----------
  const helpers = district(315, 25);
  box(5, 0.5, 5, 0, 0, 0, M.mid, helpers);
  lattice(0, 0, 3.4, 7, 6, helpers, 0.5, LINE_SOFT);
  const leds = [];
  for (let i = 0; i < 6; i += 1) {
    box(3.2, 0.14, 3.2, 0, 0.6 + i * 1.15, 0, M.dark, helpers, { line: LINE_SOFT });
    box(2.2, 0.18, 1.4, 0, 0.74 + i * 1.15, 0, M.mid, helpers, { line: LINE_SOFT });
    leds.push(box(0.2, 0.2, 0.2, 1.1, 0.8 + i * 1.15, 0.5, M.glow, helpers, { edges: false, cast: false }));
  }
  animators.push((t) => leds.forEach((l, i) => { l.visible = Math.sin(t * (2 + i) + i) > -0.2; }));
  // 08 Hardening: a padlock over the cluster, and an audit ring sweeping outward across the ground
  const lock = new THREE.Group();
  lock.position.set(0, 11, 0);
  helpers.add(lock);
  box(2.6, 2.1, 1, 0, -1.05, 0, M.mid, lock);
  const shackle = mesh(new THREE.TorusGeometry(0.85, 0.17, 10, 28, Math.PI), M.light, 0, 1.05, 0, lock, { line: LINE_SOFT });
  shackle.rotation.z = 0;
  box(0.3, 0.6, 0.06, 0, -0.5, 0.52, M.glow, lock, { edges: false, cast: false });
  box(0.3, 0.6, 0.06, 0, -0.5, -0.52, M.glow, lock, { edges: false, cast: false });
  lines([0, 0.5, 0, 0, 9.4, 0], LINE_SOFT, helpers);
  const sweepMat = new THREE.LineBasicMaterial({ color: INK.clone(), transparent: true, opacity: 0.6 });
  const sweep = circle(1, 0.12, sweepMat, helpers, 64);
  animators.push((t) => {
    lock.rotation.y = t * 0.5;
    lock.position.y = 11 + Math.sin(t * 1.4) * 0.4;
    const p = (t * 0.35) % 1;
    sweep.scale.setScalar(1 + p * 11);
    sweepMat.opacity = 0.6 * (1 - p);
  });
  const hTop = world(helpers, 0, 13.6, 0);
  anchor('svc', 'HARDENING', hTop.x, hTop.y, hTop.z);

  // ---------- Camera shots, one per chapter ----------
  // target, then azimuth (degrees around the target), elevation (degrees) and distance
  const at = (deg, r, y) => { const [x, z] = polar(deg, r); return [x, y, z]; };
  const SHOTS = {
    'ch-01': { target: [0, 0, 0], az: 58, el: 50, dist: 118, labels: ['gw', 'cf', 'nas', 'mc', 'ledpanel', 'launch', 'desk', 'dns', 'svc'] },
    'ch-02': { target: at(0, 40, 13), az: 40, el: 18, dist: 68, labels: ['inet', 'cf'] },
    'ch-03': { target: at(26, 14, 4), az: 82, el: 32, dist: 50, labels: ['gw', 'dns'] },
    'ch-04': { target: at(90, 25, 6), az: 238, el: 16, dist: 30, labels: ['nas', 'media', 'jelly', 'seerr'] },
    'ch-05': { target: at(135, 27, 3), az: 170, el: 32, dist: 30, labels: ['mc'] },
    'ch-06': { target: at(180, 27, 11), az: 20, el: 10, dist: 34, labels: ['ledpanel', 'ledpi'] },
    'ch-07': { target: at(225, 27, 4), az: 72, el: 28, dist: 30, labels: ['desk', 'radio', 'printer'] },
    'ch-08': { target: at(315, 25, 6), az: 345, el: 26, dist: 32, labels: ['svc'] },
    'ch-09': { target: at(270, 27, 5), az: 300, el: 34, dist: 40, labels: ['launch'] },
    'ch-10': { target: at(160, 40, 5), az: 335, el: 18, dist: 40, labels: ['handheld'] },
  };
  // keep filler buildings out of every close-up's line of sight
  const sightlines = Object.entries(SHOTS).filter(([id]) => id !== 'ch-01').map(([, s]) => {
    const flat = Math.cos(rad(s.el)) * s.dist;
    return [s.target[0], s.target[2], s.target[0] + Math.cos(rad(s.az)) * flat, s.target[2] + Math.sin(rad(s.az)) * flat];
  });
  const segDist = (px, pz, [ax, az, bx, bz]) => {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  };

  // ---------- The rest of the city: towers, scaffolds and cranes ----------
  const cranes = [];
  const beacons = [];
  const BEACON = new THREE.MeshBasicMaterial({ color: 0xff4a3d });
  const nearDistrict = (x, z) => DISTRICTS.some((d) => {
    const [dx, dz] = polar(d, 27);
    return Math.hypot(x - dx, z - dz) < 12.5;
  }) || Math.hypot(x - polar(...HANDHELD_AT)[0], z - polar(...HANDHELD_AT)[1]) < 10 || sightlines.some((s) => segDist(x, z, s) < 8);
  const onRoad = (r, deg) => DISTRICTS.some((d) => {
    let diff = Math.abs(((deg - d + 540) % 360) - 180);
    diff = rad(diff) * r;
    return diff < 3.4 && r < 40;
  });
  let placed = 0;
  for (let n = 0; n < 900 && placed < 170; n += 1) {
    const r = 16 + rand() ** 0.8 * 53;
    const deg = rand() * 360;
    if ((r > 33.5 && r < 39.5) || onRoad(r, deg)) continue;
    const [x, z] = polar(deg, r);
    if (nearDistrict(x, z)) continue;
    placed += 1;
    const kind = rand();
    const w = 2.6 + rand() * 3.6;
    const far = r > 62;
    if (kind < 0.42) {
      const h = 5 + rand() * (r < 30 ? 9 : 20);
      const b = box(w, h, w, x, 0, z, towerMats[Math.floor(rand() * 3)], city, { cast: !far });
      b.rotation.y = -rad(deg);
      if (rand() < 0.4) box(w * 0.6, 1.2, w * 0.6, x, h, z, M.mid, city, { cast: !far });
      if (h > 16) beacons.push({ m: box(0.35, 0.35, 0.35, x, h + 0.1, z, BEACON, city, { edges: false, cast: false }), phase: rand() * 6 });
    } else if (kind < 0.75) {
      const h = 6 + rand() * 18;
      box(w * 0.66, h, w * 0.66, x, 0, z, M.dark, city, { cast: !far, line: LINE_SOFT });
      lattice(x, z, w, h, Math.max(2, Math.round(h / 3)), city, 0, far ? LINE_SOFT : LINE);
      if (rand() < 0.5) box(w * 1.02, 0.5, w * 1.02, x, h * 0.62, z, M.light, city, { edges: false, cast: false });
    } else {
      const h = 1.2 + rand() * 2.6;
      const b = box(w * 1.4, h, w, x, 0, z, stripeMat, city, { cast: !far });
      b.rotation.y = -rad(deg);
      box(0.9, 0.7, 0.9, x + 0.6, h, z, M.mid, city, { cast: false });
    }
    if (rand() < 0.12 && r < 70) {
      const h = 14 + rand() * 12;
      lattice(x + w, z, 0.9, h, Math.round(h / 1.6), city, 0, LINE_SOFT);
      const jib = new THREE.Group();
      jib.position.set(x + w, h, z);
      lines([-3, 0, 0, 9, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 9, 0, 0, 0, 2, 0, -3, 0, 0, 7, 0, 0, 7, -4 - rand() * 4, 0], LINE_SOFT, jib);
      city.add(jib);
      cranes.push({ jib, speed: (rand() - 0.5) * 0.3, phase: rand() * 6 });
    }
  }
  animators.push((t) => cranes.forEach((c) => { c.jib.rotation.y = c.phase + t * c.speed; }));

  let twinkleClock = 0;
  animators.push((t) => {
    beacons.forEach((b) => { b.m.visible = Math.sin(t * 2.2 + b.phase) > 0.6; });
    if (t - twinkleClock > 0.5) {
      twinkleClock = t;
      twinkle();
    }
  });

  // ---------- A plane overhead, the kind the LED wall tracks ----------
  const plane = new THREE.Group();
  box(5, 0.7, 0.7, 0, -0.35, 0, M.light, plane);
  box(1.4, 0.12, 6.4, 0.2, 0, 0, M.light, plane);
  box(0.8, 0.1, 2.4, -2.2, 0, 0, M.light, plane);
  box(0.7, 1.3, 0.1, -2.2, 0, 0, M.light, plane);
  const navRed = box(0.25, 0.25, 0.25, 0.2, 0, -3.3, new THREE.MeshBasicMaterial({ color: 0xff4a3d }), plane, { edges: false, cast: false });
  const navGreen = box(0.25, 0.25, 0.25, 0.2, 0, 3.3, new THREE.MeshBasicMaterial({ color: 0x4dff88 }), plane, { edges: false, cast: false });
  const strobe = box(0.3, 0.3, 0.3, -2.6, 1.3, 0, M.glow, plane, { edges: false, cast: false });
  scene.add(plane);
  let planeRgb = false;
  let rollStart = -10;
  animators.push((t) => {
    const a = t * 0.05;
    plane.position.set(Math.cos(a) * 78, 40 + Math.sin(t * 0.3) * 1.5, Math.sin(a) * 78);
    // banking into the turn, and a barrel roll whenever someone toggles RGB mode
    const rgb = root.classList.contains('rgb');
    if (rgb !== planeRgb) { planeRgb = rgb; rollStart = t; }
    const roll = Math.min(1, (t - rollStart) / 2.2);
    plane.rotation.set(0.12 + (roll < 1 ? roll * Math.PI * 2 : 0), -a - Math.PI / 2, 0);
    strobe.visible = (t % 1.4) < 0.08;
    navRed.visible = navGreen.visible = (t % 1) < 0.7;
  });

  // ---------- Traffic: packets on the rings and the radial roads ----------
  const cars = [];
  for (let i = 0; i < 36; i += 1) cars.push({ kind: 'ring', r: i % 2 ? 8.9 : 9.7, y: 0.4, dir: i % 2 ? 1 : -1, t: rand() * Math.PI * 2, speed: 0.22 + rand() * 0.08 });
  for (let i = 0; i < 60; i += 1) cars.push({ kind: 'ring', r: i % 2 ? 35.7 : 36.9, y: HIGH + 0.35, dir: i % 2 ? 1 : -1, t: rand() * Math.PI * 2, speed: 0.06 + rand() * 0.03 });
  DISTRICTS.forEach((deg) => {
    for (let i = 0; i < 6; i += 1) cars.push({ kind: 'radial', deg, lane: i % 2 ? 0.6 : -0.6, dir: i % 2 ? 1 : -1, t: rand(), speed: 0.09 + rand() * 0.05 });
  });
  const carMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.5, 0.5), M.light, cars.length);
  carMesh.castShadow = true;
  city.add(carMesh);
  function moveCars(dt) {
    cars.forEach((c, n) => {
      if (c.kind === 'ring') {
        c.t += c.dir * c.speed * dt;
        tmp.position.set(Math.cos(c.t) * c.r, c.y, Math.sin(c.t) * c.r);
        tmp.rotation.set(0, -c.t - Math.PI / 2, 0);
      } else {
        c.t = (c.t + c.speed * dt * c.dir + 1) % 1;
        const s = 11 + c.t * 23;
        const a = rad(c.deg);
        tmp.position.set(Math.cos(a) * s - Math.sin(a) * c.lane, 0.4, Math.sin(a) * s + Math.cos(a) * c.lane);
        tmp.rotation.set(0, -a, 0);
      }
      tmp.updateMatrix();
      carMesh.setMatrixAt(n, tmp.matrix);
    });
    carMesh.instanceMatrix.needsUpdate = true;
  }
  moveCars(0);

  // ---------- Camera ----------
  const cam ={ target: new THREE.Vector3(...SHOTS['ch-01'].target), az: 58, el: 50, dist: 118 };
  let from = { ...cam, target: cam.target.clone() };
  let to = SHOTS['ch-01'];
  let flyStart = -10;
  let shown = [];
  let chapter = null;

  function setChapter(id) {
    const shot = SHOTS[id];
    if (!shot || id === chapter) return;
    chapter = id;
    from = { ...cam, target: cam.target.clone() };
    to = shot;
    flyStart = clock;
    shown = shot.labels;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    tv.renderer?.setSize(w, h);
    camera.aspect = w / h;
    // push the picture away from the reading panel: right on wide screens, up on narrow ones
    const [ox, oy] = w >= 1180 ? [-Math.min(330, w * 0.22), 0] : w >= 900 ? [-w * 0.16, 0] : [0, h * 0.2];
    camera.setViewOffset(w, h, ox, oy, w, h);
    camera.updateProjectionMatrix();
    // CSS3DRenderer ignores the view offset, so shift its layer by hand to keep the video on the screen
    if (tv.renderer) tv.renderer.domElement.style.transform = `translate(${-ox}px, ${-oy}px)`;
  }
  window.addEventListener('resize', resize);
  resize();

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
  const v = new THREE.Vector3();
  let clock = 0;
  let last = performance.now();
  let idleUntil = 0;
  let shownWidth = 0;
  root.classList.add('three');

  function frame(now) {
    window.requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const active = root.classList.contains('in-chapters');
    if (active) idleUntil = now + 1500;
    if (now > idleUntil || document.hidden) return;
    clock += dt;

    const id = root.dataset.chapter;
    if (id) setChapter(id);

    const k = reduced ? 1 : Math.min(1, (clock - flyStart) / 1.6);
    const e = ease(k);
    cam.target.lerpVectors(from.target, v.set(...to.target), e);
    const drift = reduced ? 0 : Math.sin(clock * 0.12) * 5;
    cam.az = lerpAngle(from.az, to.az, e);
    cam.el = from.el + (to.el - from.el) * e;
    cam.dist = from.dist + (to.dist - from.dist) * e;
    const az = rad(cam.az + drift);
    const el = rad(cam.el);
    const dist = cam.dist * (camera.aspect < 0.8 ? 1.7 : 1); // tall phone screens crop the sides, so back off
    camera.position.set(
      cam.target.x + Math.cos(el) * Math.cos(az) * dist,
      cam.target.y + Math.sin(el) * dist,
      cam.target.z + Math.cos(el) * Math.sin(az) * dist
    );
    camera.lookAt(cam.target);

    if (!reduced) {
      moveCars(dt);
      animators.forEach((fn) => fn(clock, dt));
    } else if (ledTex) {
      ledTex.needsUpdate = true;
    }

    // egg colours: RGB mode cycles the line work, all eggs turns it gold
    const lineColor = root.classList.contains('rgb')
      ? new THREE.Color().setHSL((clock * 0.15) % 1, 0.8, 0.65)
      : root.classList.contains('root') ? new THREE.Color(0xd9b45a) : INK;
    [LINE, LINE_SOFT, LINE_FAINT].forEach((m) => m.color.copy(lineColor));
    const shake = root.classList.contains('boom-mc') ? 0.6 : 0;
    mc.position.set(mcHome.x + (Math.random() - 0.5) * shake, 0, mcHome.z + (Math.random() - 0.5) * shake);

    renderer.render(scene, camera);

    const w = window.innerWidth;
    const h = window.innerHeight;

    // the live screen: shown once the camera has settled on the Media chapter, muted again when it leaves
    if (tv.renderer) {
      const tvOn = chapter === 'ch-04' && k > 0.97 && root.classList.contains('in-chapters');
      if (tvOn !== tv.on) {
        tv.on = tvOn;
        root.classList.toggle('tv-on', tvOn);
        if (tvOn) tv.load();
        else if (tv.unmuted) tv.setSound(false);
      }
      if (tvOn) {
        tv.renderer.render(tv.scene, camera);
        v.copy(tvCorner).project(camera);
        tv.button.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
    }
    Object.entries(tags).forEach(([key, el]) => {
      if (!shown.includes(key) || k < 0.85) {
        el.classList.remove('on');
        return;
      }
      v.copy(anchors[key]).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.classList.toggle('on', visible);
      if (visible) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    });

    // the reference's "field width": how much ground the view spans at the target, in tenths of a unit
    const width = 2 * dist * Math.tan(rad(camera.fov / 2)) * camera.aspect * 10;
    shownWidth += (width - shownWidth) * 0.2;
    if (readout) readout.textContent = Math.round(shownWidth).toLocaleString('en-US');
    if (readoutMeta) readoutMeta.textContent = `HDG ${String(Math.round(((cam.az + drift + 180) % 360 + 360) % 360)).padStart(3, '0')}°  ·  ALT ${Math.round(camera.position.y)}`;
  }
  window.requestAnimationFrame(frame);
}
