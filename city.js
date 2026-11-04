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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow() ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const BG = 0x1d1f21;
  renderer.setClearColor(BG, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 130, 330);
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

  // ---------- Hub: the gateway, a giant router on a raised disc with a glowing rim ----------
  const hub = new THREE.Group();
  city.add(hub);
  const tmp = new THREE.Object3D();
  const discTex = texture((g, w, h) => {
    g.fillStyle = '#2b2d30';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4b4e53';
    g.lineWidth = 2;
    for (let i = 0; i < 32; i += 1) {
      const a = (i / 32) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2 + Math.cos(a) * 40, h / 2 + Math.sin(a) * 40);
      g.lineTo(w / 2 + Math.cos(a) * 126, h / 2 + Math.sin(a) * 126);
      g.stroke();
    }
    [40, 70, 98, 126].forEach((r) => { g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke(); });
  }, 256, 256);
  mesh(new THREE.CylinderGeometry(7.6, 8, 1.2, 64), M.dark, 0, 0.6, 0, hub);
  const discTop = new THREE.Mesh(new THREE.CircleGeometry(7.6, 64), std(0xffffff, { map: discTex }));
  discTop.rotation.x = -Math.PI / 2;
  discTop.position.y = 1.21;
  discTop.receiveShadow = true;
  hub.add(discTop);
  const glowTex = texture((g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, w * 0.36, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, 256, 256);
  const rimGlow = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  rimGlow.rotation.x = -Math.PI / 2;
  rimGlow.position.y = 0.09;
  hub.add(rimGlow);
  circle(7.95, 1.22, LINE, hub, 96);
  // the router itself: a low body with vent slots, a row of status lights, ports on the back and four antennas
  const router = new THREE.Group();
  router.position.y = 1.2;
  router.rotation.y = rad(58);
  hub.add(router);
  box(6.4, 1.3, 3.8, 0, 0.2, 0, M.dark, router);
  [-2.6, 2.6].forEach((x) => [-1.5, 1.5].forEach((z) => box(0.5, 0.2, 0.5, x, 0, z, M.mid, router, { edges: false })));
  const vents = [];
  for (let x = -2.2; x <= 2.2; x += 0.55) vents.push(x, 1.52, -1.2, x, 1.52, 1.2);
  lines(vents, LINE_SOFT, router);
  const wifiTex = texture((g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#e4e3de';
    g.lineWidth = 10;
    g.lineCap = 'round';
    [30, 58, 86].forEach((r) => { g.beginPath(); g.arc(w / 2, h * 0.86, r, Math.PI * 1.25, Math.PI * 1.75); g.stroke(); });
    g.fillStyle = '#e4e3de';
    g.beginPath();
    g.arc(w / 2, h * 0.86, 9, 0, Math.PI * 2);
    g.fill();
  }, 256, 128);
  const wifi = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: wifiTex, transparent: true, depthWrite: false }));
  wifi.rotation.x = -Math.PI / 2;
  wifi.position.set(0, 1.53, 0.2);
  router.add(wifi);
  const statusLeds = [];
  for (let i = 0; i < 7; i += 1) statusLeds.push(box(0.22, 0.12, 0.06, -1.8 + i * 0.6, 0.85, 1.92, M.glow, router, { edges: false, cast: false }));
  for (let i = 0; i < 5; i += 1) box(0.5, 0.36, 0.12, -1.6 + i * 0.8, 0.6, -1.92, M.mid, router, { line: LINE_SOFT, cast: false });
  [-2.4, -0.8, 0.8, 2.4].forEach((x, i) => {
    const hinge = new THREE.Group();
    hinge.position.set(x, 1.4, -1.7);
    hinge.rotation.set(-0.18, 0, (i - 1.5) * 0.12);
    router.add(hinge);
    const geo = new THREE.BoxGeometry(0.34, 4.6, 0.62);
    geo.translate(0, 2.3, 0);
    mesh(geo, M.mid, 0, 0, 0, hinge);
    box(0.4, 0.4, 0.7, 0, -0.2, 0, M.dark, hinge, { edges: false, cast: false });
  });
  animators.push((t) => statusLeds.forEach((l, i) => { l.visible = Math.sin(t * (3 + i * 1.7) + i) > -0.3; }));
  anchor('gw', 'GATEWAY', 0, 8.4, 0);

  // ---------- 02 Front door: a security checkpoint, with the internet as a globe in the sky ----------
  const gate = district(0, 30);
  // the scanner arch the road passes through
  box(1.1, 7.2, 1.1, 0, 0, -2.6, M.mid, gate);
  box(1.1, 7.2, 1.1, 0, 0, 2.6, M.mid, gate);
  box(1.6, 1.2, 6.4, 0, 7.2, 0, M.dark, gate);
  box(0.12, 6.6, 0.12, -0.5, 0.3, -2.1, M.glow, gate, { edges: false, cast: false });
  box(0.12, 6.6, 0.12, -0.5, 0.3, 2.1, M.glow, gate, { edges: false, cast: false });
  const signTex = texture((g, w, h) => {
    g.fillStyle = '#e4e3de';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d1f21';
    g.font = 'bold 44px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ACCESS CHECK', w / 2, h / 2 + 2);
  }, 512, 96);
  [[-0.81, -Math.PI / 2], [0.81, Math.PI / 2]].forEach(([x, ry]) => {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.05), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(x, 7.8, 0);
    sign.rotation.y = ry;
    gate.add(sign);
  });
  const warn = [-2.6, 2.6].map((z) => box(0.5, 0.5, 0.5, 0, 8.4, z, M.glow, gate, { edges: false, cast: false }));
  // a striped boom barrier across the lane, on its own post, that lifts as traffic arrives
  const stripeTex = texture((g, w, h) => {
    for (let x = 0; x < w; x += 32) {
      g.fillStyle = (x / 32) % 2 ? '#141516' : '#efeee9';
      g.fillRect(x, 0, 32, h);
    }
  }, 256, 16);
  box(0.7, 1.7, 0.7, -2.6, 0, -3.4, M.light, gate);
  const armGeo = new THREE.BoxGeometry(0.55, 0.55, 6.6);
  armGeo.translate(0, 0, 3.2);
  const arm = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ map: stripeTex, emissive: 0xffffff, emissiveMap: stripeTex, emissiveIntensity: 0.35, roughness: 0.6 }));
  arm.position.set(-2.6, 1.5, -3.2);
  arm.castShadow = true;
  gate.add(arm);
  box(0.4, 0.9, 0.4, -2.6, 0, 3.4, M.mid, gate);
  // the guard booth: windows on every side and a roof overhang
  box(3.6, 3.8, 3.4, 3, 0, -5.8, M.mid, gate);
  box(3.64, 1.4, 3.44, 3, 1.7, -5.8, M.glow, gate, { edges: false, cast: false });
  box(4.4, 0.35, 4.2, 3, 3.8, -5.8, M.dark, gate);
  box(0.9, 0.35, 0.9, 3, 4.15, -5.8, M.light, gate, { edges: false });
  // walls either side, and a comms mast
  box(0.8, 2.6, 8, 0, 0, -9.4, M.dark, gate);
  box(0.8, 2.6, 8, 0, 0, 9.4, M.dark, gate);
  lattice(6, 8, 1.8, 15, 6, gate);
  animators.push((t) => {
    const phase = (t * 0.3) % 1;
    arm.rotation.x = -Math.min(1, Math.max(0, Math.sin(phase * Math.PI) * 1.6)) * 1.35;
    warn.forEach((w, i) => { w.visible = Math.sin(t * 6 + i * Math.PI) > 0; });
  });
  // the internet: a globe with grayscale continents, a lat/long grid and a faint atmosphere
  const inet = new THREE.Group();
  const [ix, iz] = polar(0, 54);
  inet.position.set(ix, 27, iz);
  city.add(inet);
  const earthTex = texture((g, w, h) => {
    g.fillStyle = '#1b1c1e';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d2d3d5';
    // rough continent outlines as [lon, lat] points, drawn equirectangular
    [
      [[-165, 65], [-140, 70], [-95, 72], [-80, 62], [-60, 55], [-65, 45], [-80, 30], [-97, 20], [-90, 15], [-80, 8], [-105, 22], [-118, 33], [-125, 48], [-150, 60]],
      [[-80, 8], [-60, 10], [-35, -7], [-40, -22], [-55, -35], [-68, -55], [-75, -45], [-72, -18], [-81, -5]],
      [[-17, 15], [-10, 30], [10, 37], [32, 31], [43, 12], [51, 11], [40, -15], [32, -28], [20, -35], [12, -18], [9, 4], [-8, 5]],
      [[-10, 36], [-9, 43], [-5, 48], [5, 52], [10, 58], [25, 70], [60, 70], [100, 77], [140, 72], [180, 68], [160, 60], [140, 50], [122, 40], [120, 25], [108, 20], [100, 8], [95, 15], [80, 8], [72, 20], [57, 25], [50, 30], [35, 36], [28, 40], [20, 40], [12, 44], [0, 40]],
      [[113, -22], [122, -17], [131, -12], [142, -11], [153, -26], [150, -37], [140, -38], [132, -32], [115, -34]],
      [[-55, 60], [-45, 60], [-20, 70], [-25, 82], [-60, 82], [-70, 77]],
      [[-6, 50], [2, 51], [-3, 58], [-6, 56]],
      [[130, 31], [141, 36], [142, 44], [136, 36]],
      [[44, -13], [50, -15], [48, -25], [43, -22]],
      [[95, 5], [105, -6], [115, -8], [118, -2], [110, 2], [100, 6]],
      [[120, -2], [140, -3], [150, -6], [140, -9], [125, -8]],
      [[166, -46], [174, -36], [178, -38], [170, -46]],
      [[-85, 22], [-75, 20], [-74, 19], [-84, 21]],
    ].forEach((shape) => {
      g.beginPath();
      shape.forEach(([lon, lat]) => g.lineTo(((lon + 180) / 360) * w, ((90 - lat) / 180) * h));
      g.closePath();
      g.fill();
    });
    g.fillRect(0, h * 0.92, w, h * 0.08); // antarctica
    g.strokeStyle = 'rgba(228,227,222,0.28)';
    g.lineWidth = 1;
    for (let x = 0; x <= w; x += w / 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = h / 6; y < h; y += h / 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }, 512, 256);
  // the land glows a little so the continents read even on the night side
  const globe = new THREE.Mesh(new THREE.SphereGeometry(6, 48, 32), std(0xffffff, { map: earthTex, emissive: 0xffffff, emissiveMap: earthTex, emissiveIntensity: 0.65, roughness: 0.7 }));
  inet.add(globe);
  inet.rotation.z = 0.41; // the earth's axial tilt
  lines([0, -8, 0, 0, 8, 0], LINE, inet); // the axis
  const meridian = [];
  for (let k = 0; k <= 32; k += 1) {
    const a = (k / 32) * Math.PI - Math.PI / 2;
    const b = ((k + 1) / 32) * Math.PI - Math.PI / 2;
    if (k < 32) meridian.push(Math.cos(a) * 7.2, Math.sin(a) * 7.2, 0, Math.cos(b) * 7.2, Math.sin(b) * 7.2, 0);
  }
  lines(meridian, LINE, inet);
  const ring = mesh(new THREE.TorusGeometry(7.2, 0.18, 8, 48, Math.PI), M.light, 0, 0, 0, inet, { edges: false, cast: false });
  ring.rotation.z = -Math.PI / 2; // the half-ring holding it, like a desk globe
  mesh(new THREE.CylinderGeometry(0.12, 0.12, 15.2, 8), M.light, 0, 0, 0, inet, { edges: false, cast: false }); // axis rod
  const air = new THREE.Mesh(new THREE.SphereGeometry(6.5, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, side: THREE.BackSide, depthWrite: false }));
  inet.add(air);
  circle(9, 0, LINE_SOFT, inet, 96).rotation.x = 0.4;
  animators.push((t) => { globe.rotation.y = t * 0.12; });
  const fan = [];
  for (let i = 0; i < 18; i += 1) {
    const p = world(gate, (rand() - 0.5) * 1.4, 7.8, (rand() - 0.5) * 5);
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
  anchor('inet', 'INTERNET', ix, 34.5, iz);
  const cfTop = world(gate, 0, 9, 0);
  anchor('cf', 'CLOUDFLARE', cfTop.x, cfTop.y, cfTop.z);

  // ---------- 03 Network: the DNS Pi, a single-board computer under a glowing shield, beside a mast ----------
  const dns = district(45, 26);
  box(6, 0.5, 5, 0, 0, 0, M.mid, dns);
  const pcbTex = texture((g, w, h) => {
    g.fillStyle = '#585b60';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7b7f85';
    g.lineWidth = 2;
    for (let i = 0; i < 26; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 120, y);
      g.lineTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 80);
      g.stroke();
    }
    g.fillStyle = '#9a9ea4';
    [[10, 10], [w - 22, 10], [10, h - 22], [w - 22, h - 22]].forEach(([x, y]) => { g.beginPath(); g.arc(x + 6, y + 6, 6, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = '#e4e3de';
    g.font = 'bold 22px monospace';
    g.fillText('PI-HOLE DNS', 34, h - 18); // silkscreen
    g.font = '13px monospace';
    g.fillText('SINGLE-BOARD COMPUTER', 34, h - 44);
  }, 256, 170);
  const pi = new THREE.Group();
  pi.position.y = 0.5;
  dns.add(pi);
  box(4.6, 0.16, 3.1, 0, 0, 0, std(0xffffff, { map: pcbTex }), pi);
  box(1.05, 0.18, 1.05, -0.4, 0.16, -0.1, M.light, pi, { line: LINE_SOFT }); // the processor
  box(0.8, 0.14, 0.5, 0.75, 0.16, -0.5, M.mid, pi, { line: LINE_FAINT });
  // GPIO header: two rows of twenty pins along one long edge
  const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), M.light, 40);
  for (let i = 0; i < 40; i += 1) {
    tmp.position.set(-1.9 + (i % 20) * 0.19, 0.31, -1.35 + Math.floor(i / 20) * 0.17);
    tmp.rotation.set(0, 0, 0);
    tmp.updateMatrix();
    pins.setMatrixAt(i, tmp.matrix);
  }
  pi.add(pins);
  box(4.0, 0.12, 0.42, 0, 0.16, -1.27, M.dark, pi, { edges: false });
  // USB and Ethernet ports stacked on the short edge
  [[-0.95, 0.85], [0.05, 0.85], [1.02, 0.95]].forEach(([z, wdt], i) => {
    box(1.4, 1.0, wdt, 1.85, 0.16, z, i === 2 ? M.mid : M.light, pi, { line: LINE });
    box(0.06, 0.32, wdt * 0.6, 2.51, 0.36, z, M.dark, pi, { edges: false, cast: false });
    if (i < 2) box(0.06, 0.32, wdt * 0.6, 2.51, 0.66, z, M.dark, pi, { edges: false, cast: false });
  });
  box(0.4, 0.3, 0.55, -1.2, 0.16, 1.45, M.light, pi, { line: LINE_FAINT }); // HDMI
  box(0.5, 0.08, 0.7, -2.45, -0.06, 0, M.light, pi, { line: LINE_FAINT }); // SD card sticking out of the far edge
  box(0.4, 0.25, 0.4, -2.0, 0.16, 1.45, M.light, pi, { line: LINE_FAINT }); // power
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(4.6, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e4, transparent: true, opacity: 0.1, roughness: 0.2, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide })
  );
  shield.position.y = 0.5;
  dns.add(shield);
  const shieldLines = new THREE.Mesh(shield.geometry, new THREE.MeshBasicMaterial({ color: INK, wireframe: true, transparent: true, opacity: 0.06 }));
  shieldLines.position.y = 0.5;
  dns.add(shieldLines);
  circle(4.62, 0.52, LINE, dns, 80);
  lattice(-5, 5, 2.2, 21, 9, dns);
  const beacon = box(0.6, 0.6, 0.6, -5, 21.2, 5, M.glow, dns, { edges: false, cast: false });
  animators.push((t) => {
    beacon.visible = Math.sin(t * 3) > 0;
    shield.material.opacity = 0.08 + Math.max(0, Math.sin(t * 1.4)) * 0.06;
  });
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
  // the NAS: a giant network storage box, front facing the hub, with five hot-swap drive trays
  const nas = new THREE.Group();
  nas.position.set(3, 0, -4);
  media.add(nas);
  box(7, 10, 8, 0, 0.4, 0, M.dark, nas);
  [-2.9, 2.9].forEach((x) => [-3.4, 3.4].forEach((z) => box(0.7, 0.4, 0.7, x, 0, z, M.mid, nas, { edges: false })));
  box(0.2, 7.4, 6.6, -3.55, 1.4, 0, M.mid, nas, { cast: false });
  const nasLeds = [];
  for (let i = 0; i < 5; i += 1) {
    const z = -2.6 + i * 1.3;
    box(0.3, 6.9, 1.15, -3.68, 1.65, z, M.dark, nas, { line: LINE_SOFT, cast: false });
    for (let y = 2.2; y < 8; y += 0.45) box(0.04, 0.12, 0.8, -3.85, y, z, M.mid, nas, { edges: false, cast: false });
    box(0.12, 0.5, 0.6, -3.86, 1.9, z, M.light, nas, { edges: false, cast: false }); // tray handle
    nasLeds.push(box(0.08, 0.18, 0.18, -3.86, 8.1, z + 0.3, M.glow, nas, { edges: false, cast: false }));
  }
  const nasLabel = texture((g, w, h) => {
    g.fillStyle = '#1d1f21';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e4e3de';
    g.font = 'bold 54px monospace';
    g.textBaseline = 'middle';
    g.fillText('NAS', 18, h / 2 + 2);
    g.font = '28px monospace';
    g.fillText('5-BAY STORAGE', 150, h / 2 + 4);
  }, 512, 96);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1), new THREE.MeshBasicMaterial({ map: nasLabel }));
  plate.position.set(-3.68, 9.35, 0.6);
  plate.rotation.y = -Math.PI / 2;
  nas.add(plate);
  for (let i = 0; i < 5; i += 1) nasLeds.push(box(0.08, 0.16, 0.16, -3.86, 7.6, -2.6 + i * 1.3 - 0.3, M.glow, nas, { edges: false, cast: false }));
  const power = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 20), M.light, -3.56, 9.3, -2.6, nas, { edges: false, cast: false });
  power.rotation.z = Math.PI / 2;
  for (let i = 0; i < 4; i += 1) nasLeds.push(box(0.08, 0.14, 0.32, -3.56, 8.6, -1.4 + i * 0.6, M.glow, nas, { edges: false, cast: false }));
  const nasVents = [];
  for (let y = 2; y < 9.6; y += 0.5) [-4.02, 4.02].forEach((z) => nasVents.push(-2.4, y, z, 2.4, y, z));
  lines(nasVents, LINE_SOFT, nas);
  box(5, 7, 5, 3, 0, 5.5, stripeMat, media);
  lattice(3, 5.5, 5.6, 4, 2, media, 7);
  box(0.5, 4, 0.5, -4, 0, -4, M.mid, media);
  box(0.5, 4, 0.5, -4, 0, 4, M.mid, media);
  box(0.5, 6.4, 10.4, -4, 4, 0, M.dark, media);
  // the screen writes transparent pixels, so the YouTube player behind the canvas shows through it,
  // and anything in front of the screen still covers it like a real object would
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 5.8), windowMat);
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
    canvas.before(tv.renderer.domElement); // behind the canvas: seen only through the screen's window
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
  if (!tv.renderer) screen.material = new THREE.MeshBasicMaterial({ color: 0x111214 });
  const tvCorner = world(media, -4.4, 4.4, -4.6);
  box(1.3, 1.8, 1.1, -3, 0, 8.4, M.mid, media);
  box(0.9, 0.12, 0.06, -3.66, 1.3, 8.4, M.glow, media, { edges: false, cast: false }).rotation.y = Math.PI / 2;
  animators.push((t) => nasLeds.forEach((l, i) => { l.visible = Math.sin(t * (4 + (i % 5) * 2.3) + i * 1.7) > -0.2; }));
  [['nas', 'NAS', 3, 11.5, -4], ['media', 'MEDIA SERVER', 3, 11, 5.5], ['jelly', 'JELLYFIN', -4, 10.8, 0], ['seerr', 'SEERR', -3, 2.4, 8.4]].forEach(([id, text, x, y, z]) => {
    const p = world(media, x, y, z);
    anchor(id, text, p.x, p.y, p.z);
  });

  // ---------- 05 Minecraft: a floating chunk of a blocky sandbox world, in my own grayscale pixel textures ----------
  const mc = district(135, 27);
  const pixTex = (draw) => {
    const t = texture(draw, 16, 16);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  };
  const speckle = (base, dots, n) => (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 16, 16);
    for (let i = 0; i < n; i += 1) {
      g.fillStyle = dots[i % dots.length];
      g.fillRect(Math.floor(rand() * 16), Math.floor(rand() * 16), 1 + (rand() < 0.3 ? 1 : 0), 1);
    }
  };
  const dirtTex = pixTex(speckle('#5b5b5a', ['#474746', '#6c6c6a', '#3d3d3c'], 70));
  const stoneTex = pixTex((g) => {
    g.fillStyle = '#6b6b69';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#878785';
    [[1, 1, 6, 4], [9, 0, 6, 5], [0, 6, 4, 5], [5, 6, 6, 4], [12, 6, 4, 5], [2, 12, 7, 4], [10, 11, 5, 5]].forEach(([x, y, w, h]) => g.fillRect(x, y, w, h)); // cobbles
    g.fillStyle = '#4c4c4a';
    [[1, 5, 6, 1], [9, 5, 6, 1], [0, 11, 4, 1], [5, 10, 6, 1], [2, 16, 7, 1]].forEach(([x, y, w, h]) => g.fillRect(x, y, w, h));
    g.fillStyle = '#e8e8e4';
    [[3, 3], [4, 3], [11, 8], [12, 9], [6, 13]].forEach(([x, y]) => g.fillRect(x, y, 1, 1)); // ore flecks
  });
  const topTex = pixTex((g) => {
    speckle('#c4c4c0', ['#a8a8a4', '#d8d8d4'], 60)(g);
    g.fillStyle = '#9c9c98';
    for (let i = 0; i < 14; i += 1) g.fillRect(Math.floor(rand() * 16), Math.floor(rand() * 16), 1, 2); // blades of grass
  });
  const sideTex = pixTex((g) => {
    speckle('#5b5b5a', ['#474746', '#6c6c6a'], 55)(g);
    g.fillStyle = '#b9b9b5';
    g.fillRect(0, 0, 16, 3);
    for (let x = 0; x < 16; x += 1) if (rand() < 0.55) g.fillRect(x, 3, 1, 1 + Math.floor(rand() * 3)); // the top layer drips over the edge
  });
  const barkTex = pixTex((g) => {
    g.fillStyle = '#4e4e4c';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#383837';
    for (let x = 1; x < 16; x += 4) g.fillRect(x, 0, 2, 16);
    g.fillStyle = '#626260';
    for (let i = 0; i < 10; i += 1) g.fillRect(Math.floor(rand() * 16), Math.floor(rand() * 16), 1, 2);
  });
  const leafTex = pixTex((g) => {
    speckle('#4d4d4b', ['#3a3a39', '#606060', '#2e2e2d'], 110)(g);
    for (let i = 0; i < 34; i += 1) g.clearRect(Math.floor(rand() * 16), Math.floor(rand() * 16), 1, 1); // gaps you can see through
  });
  const mt = (map) => std(0xffffff, { map, roughness: 1 });
  const GRASS = [mt(sideTex), mt(sideTex), mt(topTex), mt(dirtTex), mt(sideTex), mt(sideTex)];
  const DIRT = mt(dirtTex);
  const STONE = mt(stoneTex);
  const BARK = [mt(barkTex), mt(barkTex), mt(dirtTex), mt(dirtTex), mt(barkTex), mt(barkTex)];
  const LEAF = std(0xffffff, { map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)).attributes.position.array;
  function voxels(list, mat, edgeMat = LINE_FAINT) {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    const edges = [];
    list.forEach(([x, y, z], n) => {
      tmp.position.set(x, y + 0.5, z);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      inst.setMatrixAt(n, tmp.matrix);
      for (let k = 0; k < unitEdges.length; k += 3) edges.push(unitEdges[k] + x, unitEdges[k + 1] + y + 0.5, unitEdges[k + 2] + z);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    mc.add(inst);
    lines(edges, edgeMat, mc);
  }
  // terrain: a rough island, grass on top, dirt under it, stone at the bottom, tapering like a floating chunk
  const grass = [];
  const dirt = [];
  const stone = [];
  const heights = {};
  for (let i = -5; i <= 5; i += 1) {
    for (let j = -5; j <= 5; j += 1) {
      if (i * i + j * j > 28) continue;
      const h = 3 + Math.round(1.2 * (Math.sin(i * 0.8 + 1) + Math.cos(j * 0.7)));
      heights[`${i},${j}`] = h;
      grass.push([i, h, j]);
      for (let y = h - 1; y >= h - 2; y -= 1) dirt.push([i, y, j]);
      const depth = Math.max(0, 4 - Math.floor(Math.hypot(i, j) * 0.8));
      for (let y = h - 3; y >= h - 3 - depth; y -= 1) stone.push([i, y, j]);
    }
  }
  const topAt = (i, j) => (heights[`${i},${j}`] ?? 3) + 1;
  // a blocky tree
  const ty = topAt(2, -2);
  const trunk = [];
  for (let y = 0; y < 5; y += 1) trunk.push([2, ty + y, -2]);
  const leaves = [];
  for (let i = -2; i <= 2; i += 1) {
    for (let j = -2; j <= 2; j += 1) {
      for (let y = 4; y <= 5; y += 1) if (!(Math.abs(i) === 2 && Math.abs(j) === 2) && !(i === 0 && j === 0)) leaves.push([2 + i, ty + y, -2 + j]);
    }
  }
  for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) if (Math.abs(i) + Math.abs(j) < 2) leaves.push([2 + i, ty + 6, -2 + j]);
  // a second, smaller tree on the far side
  const ty2 = topAt(-3, -2);
  for (let y = 0; y < 3; y += 1) trunk.push([-3, ty2 + y, -2]);
  for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (let y = 3; y <= 4; y += 1) if (!(y === 4 && Math.abs(i) + Math.abs(j) === 2)) leaves.push([-3 + i, ty2 + y, -2 + j]);
  // a little block hut with a doorway
  const hx = -2;
  const hz = 2;
  const hy = topAt(hx, hz);
  const hut = [];
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      for (let y = 0; y < 2; y += 1) {
        if (i === 0 && j === 0) continue;
        if (i === -1 && j === 0) continue; // doorway on the side facing the hub
        hut.push([hx + i, hy + y, hz + j]);
      }
    }
  }
  const hutRoof = [];
  for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) hutRoof.push([hx + i, hy + 2, hz + j]);
  voxels(stone, STONE);
  voxels(dirt, DIRT);
  voxels(grass, GRASS);
  voxels(trunk, BARK);
  voxels(leaves, LEAF);
  voxels(hut, mt(barkTex), LINE_SOFT);
  voxels(hutRoof, STONE, LINE_SOFT);
  box(0.16, 0.7, 0.16, hx - 1.6, hy + 0.8, hz + 0.6, mt(barkTex), mc, { edges: false });
  const flame = box(0.22, 0.22, 0.22, hx - 1.6, hy + 1.5, hz + 0.6, M.glow, mc, { edges: false, cast: false });
  animators.push((t) => { flame.scale.setScalar(0.85 + Math.sin(t * 13) * 0.15); });
  const benchTop = pixTex((g) => {
    g.fillStyle = '#8a8a86';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#5a5a57';
    [0, 5, 10, 15].forEach((v) => { g.fillRect(v, 0, 1, 16); g.fillRect(0, v, 16, 1); }); // the work grid
  });
  const benchSide = pixTex((g) => {
    g.fillStyle = '#6e6e6b';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#4e4e4b';
    for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1); // planks
    g.fillStyle = '#2e2e2c';
    g.fillRect(3, 5, 1, 8); g.fillRect(1, 5, 5, 2); // hammer
    g.fillRect(10, 5, 2, 8); g.fillRect(9, 12, 4, 1); // saw
    g.fillStyle = '#b8b8b4';
    g.fillRect(0, 0, 16, 2); // the lighter top edge
  });
  const BENCH = [mt(benchSide), mt(benchSide), mt(benchTop), mt(dirtTex), mt(benchSide), mt(benchSide)];
  box(1, 1, 1, 1.2, topAt(1, 1), 1, BENCH, mc, { line: LINE_SOFT });
  // an original blocky figure standing by the hut, two blocks tall
  const fy = topAt(0, 2);
  const figure = new THREE.Group();
  figure.position.set(0, fy, 2);
  figure.scale.setScalar(2.2);
  mc.add(figure);
  const CLOTH = std(0x2c2d30);
  const SKIN = std(0xd6d5d0, { emissive: 0x3a3a38 });
  box(0.25, 0.75, 0.25, 0, 0, -0.14, CLOTH, figure, { line: LINE_SOFT });
  box(0.25, 0.75, 0.25, 0, 0, 0.14, CLOTH, figure, { line: LINE_SOFT });
  box(0.3, 0.75, 0.55, 0, 0.75, 0, std(0x9a9b9f), figure, { line: LINE_SOFT });
  box(0.24, 0.72, 0.24, -0.05, 0.78, -0.42, std(0x4a4b4f), figure, { line: LINE_SOFT });
  box(0.24, 0.72, 0.24, 0.05, 0.78, 0.42, std(0x4a4b4f), figure, { line: LINE_SOFT });
  box(0.26, 0.2, 0.26, -0.05, 0.62, -0.42, SKIN, figure, { edges: false });
  box(0.26, 0.2, 0.26, 0.05, 0.62, 0.42, SKIN, figure, { edges: false });
  box(0.52, 0.52, 0.52, 0, 1.5, 0, SKIN, figure, { line: LINE_SOFT });
  box(0.54, 0.16, 0.54, 0, 1.88, 0, CLOTH, figure, { edges: false });
  [-0.13, 0.13].forEach((z) => {
    box(0.03, 0.09, 0.14, -0.27, 1.72, z, new THREE.MeshBasicMaterial({ color: 0xffffff }), figure, { edges: false, cast: false }); // eye white, unlit so it reads in shade
    box(0.04, 0.09, 0.07, -0.275, 1.72, z + (z > 0 ? -0.035 : 0.035), M.dark, figure, { edges: false, cast: false }); // pupil
  });
  box(0.03, 0.06, 0.24, -0.27, 1.56, 0, std(0x5a5b5e), figure, { edges: false, cast: false }); // mouth
  const pick = new THREE.Group(); // a pickaxe in the right hand, resting back over the shoulder
  pick.position.set(0.05, 0.7, 0.62);
  pick.rotation.z = -0.55;
  figure.add(pick);
  box(0.1, 1.3, 0.1, 0, 0, 0, std(0x5a5b5e), pick, { line: LINE_FAINT }); // handle
  box(0.16, 0.18, 1.2, 0, 1.25, 0, std(0xf0efea), pick, { line: LINE }); // head
  box(0.12, 0.12, 0.2, 0, 1.2, -0.68, std(0xf0efea), pick, { edges: false }); // drooping tips
  box(0.12, 0.12, 0.2, 0, 1.2, 0.68, std(0xf0efea), pick, { edges: false });
  figure.rotation.y = Math.PI * 0.75;
  // flat block clouds drifting over the chunk
  const clouds = new THREE.Group();
  clouds.position.y = ty + 11;
  mc.add(clouds);
  [[-3, 0, 4, 2.4], [2, -3, 3, 1.8], [-1, 3, 2.6, 2.2]].forEach(([x, z, w, d]) => box(w, 0.7, d, x, 0, z, M.glow, clouds, { line: LINE_FAINT, cast: false }));
  animators.push((t) => {
    clouds.position.x = Math.sin(t * 0.08) * 2;
    figure.rotation.y = Math.PI * 0.75 + Math.sin(t * 0.6) * 0.25;
  });
  const mcHome = mc.position.clone();
  const mcTop = world(mc, 0, ty + 8, 0);
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
  mesh(new THREE.CylinderGeometry(1.3, 1.6, 1, 20), M.mid, 2.5, 0.5, -11, lab);
  mesh(new THREE.CylinderGeometry(0.45, 0.55, 6.2, 16), M.dark, 2.5, 4.1, -11, lab, { line: LINE_SOFT });
  const dish = new THREE.Group(); // turns in azimuth
  dish.position.set(2.5, 7.4, -11);
  lab.add(dish);
  box(1.2, 0.5, 1.2, 0, -0.1, 0, M.mid, dish); // kept below the bowl so it does not poke through
  mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.25, 24), M.light, 0, -0.1, 0, dish, { line: LINE_SOFT }); // turntable
  const tilt = new THREE.Group(); // tipped back toward the sky
  tilt.position.y = 0.6;
  tilt.rotation.z = 0.85;
  dish.add(tilt);
  [-0.75, 0.75].forEach((z) => box(0.22, 1.5, 0.22, 0, 0, z, M.mid, dish, { line: LINE_SOFT })); // fork arms
  mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.7, 10), M.light, 0, 1.2, 0, dish, { edges: false, cast: false }).rotation.x = Math.PI / 2; // elevation axle
  const R = 3.2;
  const bowlGeo = new THREE.SphereGeometry(R, 40, 12, 0, Math.PI * 2, 0, 0.8);
  bowlGeo.rotateX(Math.PI);
  bowlGeo.translate(0, R, 0);
  mesh(bowlGeo, std(0xb4b5b7, { side: THREE.DoubleSide, roughness: 0.75 }), 0, 0, 0, tilt, { line: LINE_FAINT });
  const ribs = [];
  for (let k = 0; k < 12; k += 1) {
    const a = (k / 12) * Math.PI * 2;
    for (let j = 0; j < 6; j += 1) {
      const t0 = (j / 6) * 0.8;
      const t1 = ((j + 1) / 6) * 0.8;
      ribs.push(Math.cos(a) * R * Math.sin(t0), R - R * Math.cos(t0) + 0.03, Math.sin(a) * R * Math.sin(t0), Math.cos(a) * R * Math.sin(t1), R - R * Math.cos(t1) + 0.03, Math.sin(a) * R * Math.sin(t1));
    }
  }
  lines(ribs, LINE_SOFT, tilt);
  [0.35, 0.6].forEach((f) => circle(R * Math.sin(0.8 * f), R - R * Math.cos(0.8 * f) + 0.03, LINE_SOFT, tilt, 48));
  const rimR = R * Math.sin(0.8);
  const rimY = R - R * Math.cos(0.8);
  circle(rimR, rimY, LINE, tilt, 64);
  const lip = mesh(new THREE.TorusGeometry(rimR, 0.09, 6, 48), M.mid, 0, rimY, 0, tilt, { edges: false, cast: false });
  lip.rotation.x = Math.PI / 2;
  const focus = rimY + R * 0.55;
  const struts = [];
  for (let k = 0; k < 3; k += 1) {
    const a = (k / 3) * Math.PI * 2;
    struts.push(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR, 0, focus, 0);
  }
  lines(struts, LINE, tilt);
  for (let k = 0; k < struts.length; k += 6) {
    const a = new THREE.Vector3(struts[k], struts[k + 1], struts[k + 2]);
    const b = new THREE.Vector3(struts[k + 3], struts[k + 4], struts[k + 5]);
    const rod = mesh(new THREE.CylinderGeometry(0.07, 0.07, a.distanceTo(b), 6), M.mid, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, tilt, { edges: false, cast: false });
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  }
  mesh(new THREE.CylinderGeometry(0.28, 0.6, 1.1, 16), M.light, 0, focus - 0.55, 0, tilt, { edges: false, cast: false }); // feed horn
  animators.push((t) => { dish.rotation.y = Math.sin(t * 0.25) * 1.2; });
  // radio waves rising off the dish
  const waves = [0, 0.5].map((phase) => {
    const mat = new THREE.LineBasicMaterial({ color: INK.clone(), transparent: true, opacity: 0.5 });
    const ring = circle(1, 0, mat, lab, 48);
    return { ring, mat, phase };
  });
  animators.push((t) => waves.forEach((w) => {
    const p = (t * 0.45 + w.phase) % 1;
    w.ring.position.set(2.5, 12.5 + p * 7, -11);
    w.ring.scale.setScalar(1.5 + p * 6);
    w.mat.opacity = 0.5 * (1 - p);
  }));
  const deskTop = world(lab, 0, 7.4, 0);
  anchor('desk', 'LLM SCANNER', deskTop.x, deskTop.y, deskTop.z);
  const radioTop = world(lab, 2.5, 12.8, -11);
  anchor('radio', 'RADIO PI', radioTop.x, radioTop.y, radioTop.z);
  // a desktop 3D printer on its own stand: bed sliding back and forth, gantry climbing a layer at a time,
  // print head with its nozzle, lead screws, a filament spool on top feeding the head, and the print growing
  box(4.6, 2.4, 4.6, -3.2, 0, -5.6, M.dark, lab);
  const printer = new THREE.Group();
  printer.position.set(-3.2, 2.4, -5.6);
  printer.scale.setScalar(1.25);
  lab.add(printer);
  box(3.6, 0.55, 3.6, 0, 0, 0, M.mid, printer);
  box(0.06, 0.32, 1.1, -1.82, 0.12, 0.9, M.glow, printer, { edges: false, cast: false }); // the control screen
  mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12), M.light, -1.82, 0.28, -0.6, printer, { edges: false, cast: false }).rotation.z = Math.PI / 2;
  const bedGroup = new THREE.Group();
  bedGroup.position.y = 0.55;
  printer.add(bedGroup);
  box(2.9, 0.14, 2.9, 0, 0, 0, M.light, bedGroup, { line: LINE });
  lines([-1.45, 0.15, -1.45, 1.45, 0.15, 1.45, -1.45, 0.15, 1.45, 1.45, 0.15, -1.45].map((n, i) => n * (i % 3 === 1 ? 1 : 0.0)), LINE_FAINT, bedGroup);
  const printGeo = new THREE.CylinderGeometry(0.5, 0.72, 1, 20, 10);
  printGeo.translate(0, 0.5, 0);
  const print = mesh(printGeo, M.dark, 0, 0.14, 0, bedGroup, { line: LINE });
  // the upright frame: two towers and a top bar, straddling the bed
  [-1.62, 1.62].forEach((z) => {
    box(0.26, 4.6, 0.3, 0.2, 0.55, z, M.dark, printer);
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 8), M.light, 0.2, 2.75, z * 0.86, printer, { edges: false, cast: false });
    box(0.5, 0.5, 0.5, 0.2, 0.55, z, M.light, printer, { line: LINE_SOFT }); // stepper motors at the foot of each tower
  });
  box(0.26, 0.3, 3.54, 0.2, 5.1, 0, M.dark, printer);
  const gantry = box(0.22, 0.22, 3.2, 0.2, 2, 0, M.light, printer, { cast: false });
  const head = new THREE.Group();
  printer.add(head);
  box(0.62, 0.72, 0.5, 0, -0.36, 0, M.dark, head, { line: LINE });
  mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 14), M.light, -0.32, -0.3, 0, head, { edges: false, cast: false }).rotation.z = Math.PI / 2; // cooling fan
  const nozzle = mesh(new THREE.ConeGeometry(0.11, 0.26, 10), M.light, 0, -0.85, 0, head, { edges: false, cast: false });
  nozzle.rotation.x = Math.PI;
  // filament spool on a holder above the frame, with the filament running down to the head
  lines([0.2, 5.4, 0, 0.2, 6.1, 0], LINE, printer);
  const spool = new THREE.Group();
  spool.position.set(0.2, 6.6, 0);
  printer.add(spool);
  [-0.28, 0.28].forEach((z) => {
    const flange = mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 32), M.dark, 0, 0, z, spool, { line: LINE_SOFT, cast: false });
    flange.rotation.x = Math.PI / 2;
  });
  const coil = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.52, 32), M.light, 0, 0, 0, spool, { edges: false, cast: false });
  coil.rotation.x = Math.PI / 2;
  for (let r = 0.32; r < 0.76; r += 0.11) circle(r, 0, LINE_FAINT, spool, 32).rotation.x = Math.PI / 2;
  const filamentPts = new Float32Array(6);
  const filamentGeo = new THREE.BufferGeometry();
  filamentGeo.setAttribute('position', new THREE.BufferAttribute(filamentPts, 3));
  printer.add(new THREE.LineSegments(filamentGeo, LINE));
  animators.push((t) => {
    const layer = (t * 0.05) % 1;
    const h = 0.04 + layer * 1.7;
    print.scale.set(1, h, 1);
    bedGroup.position.x = Math.sin(t * 3.1) * 0.45; // the bed moves front to back
    const nozzleTip = 0.55 + 0.14 + h;
    head.position.set(bedGroup.position.x * 0 + 0.0, nozzleTip + 0.98, Math.sin(t * 4.3) * 0.55);
    gantry.position.y = nozzleTip + 0.98 - 0.12;
    spool.rotation.z = -t * 0.4;
    filamentPts.set([0.2, 5.9, 0.6, head.position.x, head.position.y, head.position.z]);
    filamentGeo.attributes.position.needsUpdate = true;
  });
  const printerTop = world(lab, -3.2, 11.6, -5.6);
  anchor('printer', '3D PRINTER', printerTop.x, printerTop.y, printerTop.z);

  // ---------- 10 Off the clock: a giant retro handheld playing snake at the edge of town ----------
  const HANDHELD_AT = [160, 45];
  const arcade = district(...HANDHELD_AT);
  const handheld = new THREE.Group();
  handheld.position.set(0, 0, 0);
  handheld.rotation.z = 0.12; // leaning back a little, like it's propped up
  arcade.add(handheld);
  box(3.2, 1, 9, 1.2, 0, 0, M.mid, arcade);
  box(1.6, 6.6, 10.4, 0, 1, 0, M.light, handheld);
  [-5.2, 5.2].forEach((z) => {
    const grip = mesh(new THREE.CylinderGeometry(3.3, 3.3, 1.7, 32, 1, false, z < 0 ? Math.PI : 0, Math.PI), M.light, 0, 4.3, z, handheld, { line: LINE_SOFT });
    grip.rotation.z = Math.PI / 2;
    box(0.5, 0.5, 2.6, 0.2, 7.55, z * 0.82, M.mid, handheld, { cast: false }); // shoulder buttons
  });
  box(0.2, 5, 7, -0.82, 1.8, 0, M.dark, handheld, { cast: false });
  const lcd = texture(() => {}, 96, 64);
  const lcdFace = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 4.1), new THREE.MeshBasicMaterial({ map: lcd }));
  lcd.magFilter = THREE.NearestFilter;
  lcdFace.position.set(-0.93, 4.3, 0);
  lcdFace.rotation.y = -Math.PI / 2;
  handheld.add(lcdFace);
  // left: thumbstick above a d-pad; right: four face buttons in a diamond above a thumbstick
  const stick = (z, y) => {
    mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 24), M.dark, -0.95, y, z, handheld, { edges: false, cast: false }).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.5, 24), M.mid, -1.3, y, z, handheld, { line: LINE_FAINT, cast: false }).rotation.z = Math.PI / 2;
  };
  stick(-5.6, 5.6);
  stick(5.6, 2.9);
  box(0.3, 0.55, 1.7, -0.92, 3.0, -5.6, M.mid, handheld, { cast: false, line: LINE_SOFT });
  box(0.3, 1.7, 0.55, -0.92, 2.42, -5.6, M.mid, handheld, { cast: false, line: LINE_SOFT });
  [[0, 0.65], [0, -0.65], [0.65, 0], [-0.65, 0]].forEach(([dy, dz]) => {
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 16), M.dark, -0.92, 5.6 + dy, 5.6 + dz, handheld, { edges: false, cast: false }).rotation.z = Math.PI / 2;
  });
  [-0.6, 0.6].forEach((z) => box(0.15, 0.2, 0.7, -0.84, 1.15, z, M.mid, handheld, { edges: false, cast: false })); // start and select
  const grille = [];
  for (let i = 0; i < 4; i += 1) grille.push(-0.83, 1.2 + i * 0.25, -4.4, -0.83, 1.2 + i * 0.25, -3.6, -0.83, 1.2 + i * 0.25, 3.6, -0.83, 1.2 + i * 0.25, 4.4);
  lines(grille, LINE_SOFT, handheld);
  // snake that chases its food around the little screen
  const snake = { body: [[6, 8], [5, 8], [4, 8]], food: [16, 5] };
  function drawLcd() {
    const g = lcd.image.getContext('2d');
    g.fillStyle = '#c9c9c5';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#2b2b2b';
    snake.body.forEach(([x, y]) => g.fillRect(x * 4, y * 4, 3, 3));
    g.fillRect(snake.food[0] * 4 + 1, snake.food[1] * 4 + 1, 2, 2);
    g.fillRect(0, 0, 96, 1);
    g.fillRect(0, 63, 96, 1);
    g.fillRect(0, 0, 1, 64);
    g.fillRect(95, 0, 1, 64);
    [[20, 20, 20, 2], [56, 40, 22, 2], [40, 10, 2, 14], [70, 18, 2, 12]].forEach(([x, y, w, h]) => g.fillRect(x, y, w, h));
    g.fillRect(4, 4, 3, 5); g.fillRect(8, 4, 3, 5); g.fillRect(12, 4, 3, 5);
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
  const steel = std(0xc9c9c5, { metalness: 0.85, roughness: 0.3 });
  const lockBody = mesh(new THREE.BoxGeometry(2.8, 2.4, 1.1), std(0x8e8e8a, { metalness: 0.8, roughness: 0.35 }), 0, -1.2, 0, lock, { line: LINE_SOFT });
  lockBody.castShadow = true;
  mesh(new THREE.TorusGeometry(0.95, 0.26, 14, 32, Math.PI), steel, 0, 0, 0, lock, { line: LINE_FAINT });
  [-0.95, 0.95].forEach((x) => mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 14), steel, x, -0.2, 0, lock, { edges: false }));
  [0.56, -0.56].forEach((z) => {
    const hole = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 20), M.dark, 0, -0.95, z, lock, { edges: false, cast: false });
    hole.rotation.x = Math.PI / 2;
    box(0.2, 0.55, 0.04, 0, -1.55, z, M.dark, lock, { edges: false, cast: false }); // the keyhole's slot below the round part
  });
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
    'ch-01': { target: [0, 0, 0], az: 58, el: 46, dist: 150, labels: ['gw', 'cf', 'nas', 'mc', 'ledpanel', 'launch', 'desk', 'dns', 'svc', 'stage'] },
    'ch-02': { target: at(0, 40, 13), az: 38, el: 26, dist: 70, labels: ['inet', 'cf'] },
    'ch-03': { target: at(26, 14, 4), az: 82, el: 32, dist: 50, labels: ['gw', 'dns'] },
    'ch-04': { target: at(90, 25, 6), az: 238, el: 16, dist: 30, labels: ['nas', 'media', 'jelly', 'seerr'] },
    'ch-05': { target: at(135, 27, 3), az: 170, el: 28, dist: 23, labels: ['mc'] },
    'ch-06': { target: at(180, 27, 11), az: 20, el: 10, dist: 34, labels: ['ledpanel', 'ledpi', 'stage'] },
    'ch-07': { target: at(225, 27, 4), az: 72, el: 28, dist: 30, labels: ['desk', 'radio', 'printer'] },
    'ch-08': { target: at(315, 25, 6), az: 345, el: 26, dist: 32, labels: ['svc'] },
    'ch-09': { target: at(270, 27, 5), az: 300, el: 34, dist: 40, labels: ['launch'] },
    'ch-10': { target: at(160, 40, 5), az: 335, el: 18, dist: 40, labels: ['handheld', 'stage'] },
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

  // ---------- The rest of the city: streets, blocks and neighborhoods that match their district ----------
  const cranes = [];
  const beacons = [];
  const fans = [];
  const searchlights = [];
  const BEACON = new THREE.MeshBasicMaterial({ color: 0xffffff }); // white strobes keep the city grayscale
  const SIDEWALK = std(0x313337);
  const ROOF = std(0x46494e);
  const GREEN = std(0x3e4043); // parks and trees, in the same grays as everything else
  const sites = []; // landmarks the generator keeps clear of
  const keepClear = ([x, z], r) => sites.push([x, z, r]);
  const STAGE_AT = [202, 49];
  keepClear(polar(...HANDHELD_AT), 10);
  keepClear(polar(...STAGE_AT), 12);
  const blocked = (x, z) => DISTRICTS.some((d) => {
    const [dx, dz] = polar(d, 27);
    return Math.hypot(x - dx, z - dz) < 12.5;
  }) || sites.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr) || sightlines.some((s) => segDist(x, z, s) < 7.5);

  // streets: three ground avenues and a cross street every 22.5 degrees
  [[40.4, 42.6], [56.2, 58.4], [72, 74]].forEach(([r1, r2]) => ringRoad(r1, r2, 0.05));
  for (let d = 0; d < 360; d += 22.5) {
    const [x, z] = polar(d, 55.8);
    box(36.4, 0.1, 1.8, x, 0, z, M.road, city, { line: LINE_SOFT, cast: false }).rotation.y = -rad(d);
  }

  // a lot is a group at its centre with local +x pointing away from the hub, so buildings face their street
  function lot(x, z, deg) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = -rad(deg);
    city.add(g);
    return g;
  }
  const prism = (len, r) => {
    const geo = new THREE.CylinderGeometry(r, r, len, 3);
    geo.rotateX(Math.PI / 2);
    geo.rotateZ(Math.PI / 2);
    return geo;
  };
  const addBeacon = (g, x, y, z) => beacons.push({ m: box(0.35, 0.35, 0.35, x, y + 0.1, z, BEACON, g, { edges: false, cast: false }), phase: rand() * 6 });

  const ARCH = {
    // a tower that steps back as it rises, with something on the roof
    tower(g, d, w, near) {
      const h = (8 + rand() * 22) * (g.position.length() < 40 ? 0.45 : 1); // keep the inner ring low so the districts stay visible
      const mat = towerMats[Math.floor(rand() * 3)];
      box(d, h * 0.62, w, 0, 0, 0, mat, g, { cast: near });
      box(d * 0.78, h * 0.28, w * 0.78, 0, h * 0.62, 0, mat, g, { cast: near });
      const top = h * 0.9;
      box(d * 0.5, h * 0.1, w * 0.5, 0, h * 0.9, 0, ROOF, g, { cast: near });
      if (rand() < 0.5) {
        mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 12), M.mid, d * 0.15, h + 0.7, w * 0.12, g, { cast: false });
      } else lines([0, h, 0, 0, h + 4 + rand() * 4, 0], LINE_SOFT, g);
      if (top > 18) addBeacon(g, 0, h + (rand() < 0.5 ? 0 : 0.2), 0);
    },
    // a round tower ringed with light bands
    round(g, d, w, near) {
      const r = Math.min(d, w) / 2.2;
      const h = (10 + rand() * 18) * (g.position.length() < 40 ? 0.45 : 1);
      mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 24), M.dark, 0, h / 2, 0, g, { cast: near, line: LINE_SOFT });
      for (let y = 3; y < h - 1; y += 3.2) mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.35, 24), M.light, 0, y, 0, g, { edges: false, cast: false });
      mesh(new THREE.CylinderGeometry(r * 0.6, r, 1.2, 24), ROOF, 0, h + 0.6, 0, g, { cast: false, line: LINE_SOFT });
      if (h > 18) addBeacon(g, 0, h + 1.2, 0);
    },
    // a building going up: core, scaffold and a crane
    build(g, d, w) {
      const h = 8 + rand() * 14;
      box(d * 0.66, h * 0.7, w * 0.66, 0, 0, 0, M.dark, g, { line: LINE_SOFT });
      lattice(0, 0, Math.min(d, w), h, Math.max(2, Math.round(h / 3)), g);
      const ch = h + 6 + rand() * 6;
      lattice(d / 2, 0, 0.9, ch, Math.round(ch / 1.6), g, 0, LINE_SOFT);
      const jib = new THREE.Group();
      jib.position.set(d / 2, ch, 0);
      lines([-3, 0, 0, 9, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 9, 0, 0, 0, 2, 0, -3, 0, 0, 7, 0, 0, 7, -4 - rand() * 4, 0], LINE_SOFT, jib);
      g.add(jib);
      cranes.push({ jib, speed: (rand() - 0.5) * 0.3, phase: rand() * 6 });
    },
    // a warehouse with a sawtooth roof
    warehouse(g, d, w, near) {
      const h = 2.6 + rand() * 1.6;
      box(d, h, w, 0, 0, 0, stripeMat, g, { cast: near });
      const teeth = Math.max(2, Math.floor(d / 2.2));
      for (let i = 0; i < teeth; i += 1) mesh(prism(w * 0.96, 0.9), ROOF, -d / 2 + (i + 0.5) * (d / teeth), h + 0.45, 0, g, { cast: false, line: LINE_SOFT });
    },
    // a data hall: low and wide, with cooling fans spinning on the roof
    datacenter(g, d, w, near) {
      const h = 3 + rand() * 2;
      box(d, h, w, 0, 0, 0, M.dark, g, { cast: near });
      box(d * 1.01, 0.35, w * 1.01, 0, h * 0.55, 0, M.light, g, { edges: false, cast: false });
      for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 1) {
          const fan = new THREE.Group();
          fan.position.set(i * d * 0.22, h + 0.25, j * w * 0.28);
          mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.4, 14), M.mid, 0, 0, 0, fan, { cast: false, line: LINE_SOFT });
          lines([-0.65, 0.22, 0, 0.65, 0.22, 0, 0, 0.22, -0.65, 0, 0.22, 0.65], LINE, fan);
          g.add(fan);
          fans.push(fan);
        }
      }
    },
    // houses with pitched roofs and a tree or two
    houses(g, d, w) {
      const n = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i += 1) {
        const z = -w / 2 + (i + 0.5) * (w / n);
        const hw = Math.min(w / n - 0.8, 3.2);
        box(2.6, 2, hw, -d * 0.15, 0, z, M.light, g, { line: LINE_SOFT });
        mesh(prism(hw * 1.05, 1.65), ROOF, -d * 0.15, 2.7, z, g, { cast: true, line: LINE_SOFT }).rotation.x = 0;
      }
      tree(g, d * 0.3, w * 0.3);
      if (rand() < 0.6) tree(g, d * 0.32, -w * 0.3);
    },
    // a small park
    park(g, d, w) {
      box(d * 0.9, 0.22, w * 0.9, 0, 0, 0, GREEN, g, { line: LINE_FAINT, cast: false });
      for (let i = 0; i < 5; i += 1) tree(g, (rand() - 0.5) * d * 0.7, (rand() - 0.5) * w * 0.7);
      lines([-d * 0.45, 0.25, 0, d * 0.45, 0.25, 0], LINE_SOFT, g);
    },
    // stepped voxel blocks for the Minecraft side of town
    voxel(g, d, w, near) {
      const steps = 2 + Math.floor(rand() * 3);
      let y = 0;
      for (let i = 0; i < steps; i += 1) {
        const k = 1 - i * 0.22;
        const h = 2 + Math.floor(rand() * 3);
        box(Math.round(d * k), h, Math.round(w * k), 0, y, 0, i % 2 ? M.mid : M.dark, g, { cast: near });
        y += h;
      }
      if (rand() < 0.5) box(1, 1, 1, d * 0.2, y, 0, M.light, g, { cast: false });
    },
    // a tower with a screen on the roof showing the LED wall
    screen(g, d, w, near) {
      const h = 7 + rand() * 9;
      box(d, h, w, 0, 0, 0, towerMats[Math.floor(rand() * 3)], g, { cast: near });
      box(0.4, 5, Math.min(w, 6), -d * 0.2, h, 0, M.dark, g, { cast: false });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, 6) * 0.9, 4.5), new THREE.MeshBasicMaterial({ map: ledTex, color: ledTex ? 0xffffff : 0x222222 }));
      face.position.set(-d * 0.2 - 0.21, h + 2.5, 0);
      face.rotation.y = -Math.PI / 2;
      g.add(face);
    },
    // an exchange building with a tall comms mast and a dish
    mast(g, d, w, near) {
      box(d * 0.8, 3.5, w * 0.8, 0, 0, 0, stripeMat, g, { cast: near });
      const h = 16 + rand() * 12;
      lattice(d * 0.25, w * 0.2, 1.6, h, Math.round(h / 2.2), g);
      addBeacon(g, d * 0.25, h, w * 0.2);
      const dish = mesh(new THREE.SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, 0.9), std(0x3b3e42, { side: THREE.DoubleSide }), -d * 0.2, 4.6, -w * 0.2, g, { cast: false, line: LINE_SOFT });
      dish.rotation.z = Math.PI / 2.3;
    },
    // a walled compound with a watchtower and a searchlight
    fort(g, d, w, near) {
      [[0, -w / 2, d, 0.5], [0, w / 2, d, 0.5], [-d / 2, 0, 0.5, w], [d / 2, 0, 0.5, w]].forEach(([x, z, dx, dz]) => box(dx, 2.2, dz, x, 0, z, M.mid, g, { cast: near }));
      box(d * 0.45, 3, w * 0.45, 0, 0, 0, M.dark, g, { cast: near });
      mesh(new THREE.CylinderGeometry(0.9, 1.1, 8, 10), M.mid, d * 0.42, 4, w * 0.42, g, { cast: near, line: LINE_SOFT });
      box(2.4, 0.6, 2.4, d * 0.42, 8, w * 0.42, M.dark, g, { cast: false });
      if (searchlights.length < 3) {
        const pivot = new THREE.Group();
        pivot.position.set(d * 0.42, 8.8, w * 0.42);
        const coneGeo = new THREE.ConeGeometry(4, 18, 20, 1, true);
        coneGeo.translate(0, -9, 0);
        const beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xeeede8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
        beam.rotation.z = -1.0;
        pivot.add(beam);
        g.add(pivot);
        searchlights.push({ pivot, phase: rand() * 6 });
      }
    },
  };
  function tree(g, x, z) {
    mesh(new THREE.CylinderGeometry(0.12, 0.16, 1, 6), M.mid, x, 0.5, z, g, { edges: false });
    mesh(new THREE.ConeGeometry(0.9 + rand() * 0.4, 2.4 + rand(), 7), GREEN, x, 2.2, z, g, { line: LINE_FAINT });
  }
  // which buildings each neighbourhood is made of, by the district it sits behind
  const THEMES = {
    0: ['datacenter', 'mast', 'tower', 'tower'],
    45: ['mast', 'tower', 'warehouse', 'round'],
    90: ['round', 'tower', 'warehouse', 'tower'],
    135: ['voxel', 'voxel', 'park', 'houses'],
    180: ['screen', 'screen', 'tower', 'build'],
    225: ['datacenter', 'datacenter', 'build', 'tower'],
    270: ['houses', 'park', 'round', 'houses'],
    315: ['fort', 'fort', 'tower', 'datacenter'],
  };
  const plinths = [];
  [[16, 33.4, 1], [43.4, 55.6, 2], [59.2, 71.2, 2], [76, 92, 2]].forEach(([r1, r2, nr]) => {
    for (let sector = 0; sector < 16; sector += 1) {
      const rm = (r1 + r2) / 2;
      const margin = (1.7 / rm) * (180 / Math.PI);
      const a0 = sector * 22.5 + margin;
      const span = 22.5 - margin * 2;
      const nt = Math.max(1, Math.floor((rad(span) * rm) / 6.8));
      for (let i = 0; i < nr; i += 1) {
        for (let j = 0; j < nt; j += 1) {
          const rc = r1 + (i + 0.5) * ((r2 - r1) / nr);
          const ac = a0 + (j + 0.5) * (span / nt);
          const [x, z] = polar(ac, rc);
          if (blocked(x, z)) continue;
          const depth = (r2 - r1) / nr - 1.4;
          const width = (rad(span / nt) * rc) - 1.4;
          plinths.push([x, z, ac, depth + 1, width + 1]);
          const near = rc < 58;
          const theme = THEMES[(Math.round(ac / 45) * 45) % 360];
          const kind = theme[Math.floor(rand() * theme.length)];
          ARCH[kind](lot(x, z, ac), Math.min(depth, 9), Math.min(width, 10), near);
        }
      }
    }
  });
  // sidewalks under every lot, drawn as one instanced mesh
  const plinthMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.16, 1), SIDEWALK, plinths.length);
  plinths.forEach(([x, z, ac, d, w], n) => {
    tmp.position.set(x, 0.08, z);
    tmp.rotation.set(0, -rad(ac), 0);
    tmp.scale.set(d, 1, w);
    tmp.updateMatrix();
    plinthMesh.setMatrixAt(n, tmp.matrix);
  });
  tmp.scale.set(1, 1, 1);
  plinthMesh.receiveShadow = true;
  city.add(plinthMesh);
  animators.push((t, dt) => {
    cranes.forEach((c) => { c.jib.rotation.y = c.phase + t * c.speed; });
    fans.forEach((f) => { f.rotation.y += dt * 4; });
    searchlights.forEach((s) => { s.pivot.rotation.y = s.phase + t * 0.6; });
  });

  // ---------- A concert: a festival stage with an LED wall, line arrays, a DJ booth, light fans and a crowd ----------
  const stage = district(...STAGE_AT);
  // the deck, with steps and a bright front edge
  box(7, 1.6, 17, 4.5, 0, 0, M.mid, stage);
  box(0.08, 0.12, 17, 1, 1.5, 0, M.glow, stage, { edges: false, cast: false });
  [-3, 3].forEach((z) => box(1.2, 0.8, 2.4, 0.4, 0, z, M.dark, stage));
  // the LED wall: an equaliser and a waveform drawn live
  const wallTex = texture(() => {}, 512, 256);
  const wallCtx = wallTex.image.getContext('2d');
  box(0.8, 9.4, 14, 7.6, 1.6, 0, M.dark, stage);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 8.6), new THREE.MeshBasicMaterial({ map: wallTex }));
  wall.position.set(7.18, 6.3, 0);
  wall.rotation.y = -Math.PI / 2;
  stage.add(wall);
  function drawWall(t) {
    wallCtx.fillStyle = '#0d0e0f';
    wallCtx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 32; i += 1) {
      const v = Math.abs(Math.sin(t * 4.2 + i * 0.55) * Math.cos(t * 1.7 + i * 0.21));
      const h = 20 + v * 170;
      wallCtx.fillStyle = '#d9d8d3';
      for (let y = 0; y < h; y += 9) wallCtx.fillRect(14 + i * 15.5, 236 - y, 11, 6);
    }
    wallCtx.strokeStyle = '#ffffff';
    wallCtx.lineWidth = 3;
    wallCtx.beginPath();
    for (let x = 0; x <= 512; x += 8) wallCtx.lineTo(x, 46 + Math.sin(x * 0.04 + t * 6) * 16 * Math.sin(t * 1.3 + x * 0.01));
    wallCtx.stroke();
    wallTex.needsUpdate = true;
  }
  // truss towers either side with a roof truss across, and a line array hanging from each
  lattice(3.5, -9.6, 1.4, 15, 8, stage, 0);
  lattice(3.5, 9.6, 1.4, 15, 8, stage, 0);
  const roof = [];
  [[1, 15], [7.6, 15]].forEach(([x, y]) => roof.push(x, y, -10, x, y, 10));
  for (let z = -10; z <= 10; z += 2.5) roof.push(1, 15, z, 7.6, 15, z, 1, 15, z, 7.6, 15, z + 2.5);
  lines(roof, LINE, stage);
  box(7.4, 0.5, 21, 4.3, 15, 0, M.dark, stage); // roof canopy
  for (let z = -7.5; z <= 7.5; z += 2.5) {
    const spot = mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.8, 12), M.light, 1.6, 14.4, z, stage, { edges: false, cast: false });
    spot.rotation.z = -0.6;
  }
  [-8.6, 8.6].forEach((z) => {
    lines([1.6, 15, z, 1.6, 12.6, z], LINE_SOFT, stage);
    for (let k = 0; k < 6; k += 1) {
      const cab = box(1.3, 0.75, 1.9, 1.6 - k * 0.08, 12.4 - k * 0.78, z, M.mid, stage, { cast: false });
      cab.rotation.z = -0.05 * k; // the array curves as it hangs
      box(0.04, 0.5, 1.6, 0.93 - k * 0.08, 12.55 - k * 0.78, z, M.mid, stage, { edges: false, cast: false });
    }
    box(2, 2.2, 2.4, 0.2, 0, z * 1.18, M.dark, stage); // ground subwoofers
    mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 20), M.mid, -0.82, 1.1, z * 1.18, stage, { edges: false, cast: false }).rotation.z = Math.PI / 2;
  });
  // the DJ booth with two decks and a mixer
  box(1.6, 1.3, 4.6, 3.2, 1.6, 0, M.dark, stage);
  [-1.2, 1.2].forEach((z) => {
    const deck = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 24), M.light, 3.2, 2.95, z, stage, { line: LINE_FAINT, cast: false });
    deck.userData.spin = true;
  });
  box(0.7, 0.12, 0.9, 3.2, 2.9, 0, M.mid, stage, { edges: false, cast: false });
  const decks = [];
  stage.traverse((o) => { if (o.userData.spin) decks.push(o); });
  // light fans from the roof truss
  const fanPts = new Float32Array(2 * 14 * 2 * 3);
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.BufferAttribute(fanPts, 3));
  const fanMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  stage.add(new THREE.LineSegments(fanGeo, fanMat));
  // the crowd, packed in front of the stage, with a barrier
  lines([-0.4, 1.1, -9, -0.4, 1.1, 9], LINE, stage);
  const people = [];
  for (let i = 0; i < 260; i += 1) {
    const a = (rand() - 0.5) * 2.3;
    const r = 2 + rand() * 11;
    people.push({ x: -1.2 - Math.cos(a) * r, z: Math.sin(a) * r * 1.15, phase: rand() * 6, h: 0.75 + rand() * 0.3 });
  }
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 1, 0.34), M.mid, people.length);
  crowd.castShadow = true;
  stage.add(crowd);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), M.light, people.length);
  stage.add(heads);
  let wallClock = -1;
  animators.push((t) => {
    if (t - wallClock > 1 / 20) {
      wallClock = t;
      drawWall(t);
    }
    decks.forEach((d) => { d.rotation.y = t * 3; });
    let n = 0;
    [-1, 1].forEach((side) => {
      for (let k = 0; k < 14; k += 1) {
        const ang = (k / 13 - 0.5) * 1.3 + Math.sin(t * 0.8 + side) * 0.35;
        fanPts.set([1.2, 14.8, side * 5, -9 + Math.cos(ang) * -6, 1.5 + Math.abs(Math.sin(ang)) * 4, side * 5 + Math.sin(ang) * 16], n * 6);
        n += 1;
      }
    });
    fanGeo.attributes.position.needsUpdate = true;
    const beat = Math.max(0, Math.sin(t * 7.5));
    people.forEach((p, i) => {
      tmp.position.set(p.x, p.h * 0.5 + beat * 0.28 * Math.max(0, Math.sin(t * 7.5 + p.phase)), p.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, p.h, 1);
      tmp.updateMatrix();
      crowd.setMatrixAt(i, tmp.matrix);
      tmp.position.y += p.h * 0.5 + 0.2;
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      heads.setMatrixAt(i, tmp.matrix);
    });
    heads.instanceMatrix.needsUpdate = true;
    tmp.scale.set(1, 1, 1);
    crowd.instanceMatrix.needsUpdate = true;
  });
  const stageTop = world(stage, 4, 17.5, 0);
  anchor('stage', 'MUSIC STAGE', stageTop.x, stageTop.y, stageTop.z);

  // ---------- Satellites on tilted orbits ----------
  const panelTex = texture((g2, w, h) => {
    g2.fillStyle = '#8c9096';
    g2.fillRect(0, 0, w, h);
    g2.fillStyle = '#3f4349';
    for (let x = 2; x < w; x += 16) for (let y = 2; y < h; y += 16) g2.fillRect(x, y, 13, 13); // individual cells
    g2.fillStyle = '#9a9ea4';
    g2.fillRect(0, 0, w, 2);
    g2.fillRect(0, h - 2, w, 2);
    g2.fillRect(0, 0, 2, h);
    g2.fillRect(w - 2, 0, 2, h);
  }, 64, 128);
  const panelMat = std(0xffffff, { map: panelTex, metalness: 0.5, roughness: 0.35 });
  const foilTex = texture((g2, w, h) => {
    g2.fillStyle = '#b8b8b4';
    g2.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i += 1) {
      g2.fillStyle = rand() < 0.5 ? '#d8d8d4' : '#8f8f8b';
      g2.fillRect(rand() * w, rand() * h, 3 + rand() * 9, 1 + rand() * 3); // crinkled insulation foil
    }
  }, 64, 64);
  const foilMat = std(0xffffff, { map: foilTex, metalness: 0.15, roughness: 0.45, emissive: 0x2a2a28 });
  const sats = [[78, 44, 0.35, 0.05], [96, 54, -0.28, -0.035], [66, 38, 0.12, 0.07]].map(([r, y, tilt, speed], i) => {
    const orbit = new THREE.Group();
    orbit.position.y = y;
    orbit.rotation.set(tilt, i * 1.7, tilt * 0.5);
    scene.add(orbit);
    circle(r, 0, LINE_FAINT, orbit, 180);
    const sat = new THREE.Group();
    sat.position.set(r, 0, 0);
    sat.scale.setScalar(1.8);
    orbit.add(sat);
    // the bus: a foil-wrapped body with an equipment deck on top
    box(1.7, 2.2, 1.7, 0, -1.1, 0, foilMat, sat, { cast: false });
    box(1.9, 0.18, 1.9, 0, 1.1, 0, M.dark, sat, { cast: false });
    box(1.9, 0.18, 1.9, 0, -1.28, 0, M.dark, sat, { cast: false });
    // two long solar wings on booms, each made of three panels
    [-1, 1].forEach((sgn) => {
      lines([0, 0, sgn * 0.85, 0, 0, sgn * 1.7], LINE, sat);
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8), M.light, 0, 0, sgn * 1.27, sat, { edges: false, cast: false }).rotation.x = Math.PI / 2;
      for (let k = 0; k < 3; k += 1) box(1.7, 0.06, 2.1, 0, -0.03, sgn * (2.8 + k * 2.2), panelMat, sat, { cast: false, line: LINE_SOFT });
    });
    // a big dish antenna on a short mast under the bus, its bowl aimed down at the ground, with a feed horn
    lines([0, -2.38, 0, 0, -3.2, 0], LINE, sat);
    const dish = mesh(new THREE.SphereGeometry(1.5, 28, 10, 0, Math.PI * 2, 0, 0.8), std(0xd6d6d2, { side: THREE.DoubleSide, roughness: 0.6 }), 0, -1.75, 0, sat, { cast: false, line: LINE_FAINT });
    dish.scale.set(1, 0.55, 1);
    dish.position.y = -2.4 - 1.5 * 0.55;
    lines([0, -3.2, 0, 0, -3.9, 0, 0.9, -3.4, 0.4, 0, -3.9, 0, -0.9, -3.4, -0.4, 0, -3.9, 0], LINE_SOFT, sat);
    box(0.22, 0.3, 0.22, 0, -4.15, 0, M.glow, sat, { edges: false, cast: false });
    // whip antennas and a small sensor on the deck
    lines([0.6, 1.2, 0.6, 1.1, 3.0, 1.1, -0.6, 1.2, -0.6, -1.1, 3.0, -1.1], LINE, sat);
    mesh(new THREE.CylinderGeometry(0.25, 0.32, 0.6, 12), M.light, 0.4, 1.5, -0.4, sat, { edges: false, cast: false });
    return { orbit, speed, sat };
  });
  animators.push((t) => sats.forEach((s) => {
    s.orbit.rotation.y += s.speed * 0.016;
    s.sat.rotation.y = t * 0.2;
  }));

  // ---------- An elevated train looping the middle avenue ----------
  const RAIL_R = 57.3;
  const RAIL_Y = 6.4;
  const railBed = new THREE.Mesh(new THREE.RingGeometry(RAIL_R - 0.6, RAIL_R + 0.6, 160), M.dark);
  railBed.rotation.x = -Math.PI / 2;
  railBed.position.y = RAIL_Y;
  city.add(railBed);
  circle(RAIL_R - 0.35, RAIL_Y + 0.12, LINE, city, 200);
  circle(RAIL_R + 0.35, RAIL_Y + 0.12, LINE, city, 200);
  for (let d = 0; d < 360; d += 7.5) {
    const [x, z] = polar(d, RAIL_R);
    if (blocked(x, z) && sites.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr)) continue;
    box(0.5, RAIL_Y, 0.5, x, 0, z, M.mid, city, { line: LINE_SOFT });
  }
  const trainTex = texture((g2, w, h) => {
    g2.fillStyle = '#d2d1cc';
    g2.fillRect(0, 0, w, h);
    g2.fillStyle = '#2a2c2f';
    for (let x = 6; x < w - 6; x += 14) g2.fillRect(x, h * 0.3, 9, h * 0.32);
  }, 128, 32);
  const trainMat = std(0xffffff, { map: trainTex });
  const cars2 = Array.from({ length: 6 }, () => box(2.8, 1.25, 1.15, 0, 0, 0, trainMat, city, { line: LINE_SOFT }));
  animators.push((t) => cars2.forEach((c, i) => {
    const a = t * 0.11 - i * 0.052;
    c.position.set(Math.cos(a) * RAIL_R, RAIL_Y + 0.75, Math.sin(a) * RAIL_R);
    c.rotation.y = -a - Math.PI / 2;
  }));

  // ---------- People on the sidewalks ----------
  const walkers = Array.from({ length: 160 }, (_, i) => ({
    r: [39.9, 43.1, 55.7, 58.9][i % 4] + (rand() - 0.5) * 0.4,
    a: rand() * Math.PI * 2,
    speed: (rand() < 0.5 ? -1 : 1) * (0.006 + rand() * 0.006),
    phase: rand() * 6,
  }));
  const walkerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.85, 0.3), M.light, walkers.length);
  city.add(walkerMesh);
  animators.push((t, dt) => {
    walkers.forEach((p, n) => {
      p.a += p.speed * dt * 4;
      tmp.position.set(Math.cos(p.a) * p.r, 0.6 + Math.abs(Math.sin(t * 8 + p.phase)) * 0.05, Math.sin(p.a) * p.r);
      tmp.rotation.set(0, -p.a, 0);
      tmp.updateMatrix();
      walkerMesh.setMatrixAt(n, tmp.matrix);
    });
    walkerMesh.instanceMatrix.needsUpdate = true;
  });

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
  const navRed = box(0.25, 0.25, 0.25, 0.2, 0, -3.3, M.glow, plane, { edges: false, cast: false });
  const navGreen = box(0.25, 0.25, 0.25, 0.2, 0, 3.3, M.glow, plane, { edges: false, cast: false });
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
  // the ground avenues get their own traffic
  [[41, 42], [56.8, 57.8], [72.5, 73.5]].forEach(([r1, r2]) => {
    for (let i = 0; i < 26; i += 1) cars.push({ kind: 'ring', r: i % 2 ? r1 : r2, y: 0.4, dir: i % 2 ? 1 : -1, t: rand() * Math.PI * 2, speed: 0.025 + rand() * 0.02 });
  });
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
  const cam = { target: new THREE.Vector3(...SHOTS['ch-01'].target), az: 58, el: 46, dist: 150 };
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
    // fly in an arc, up and back mid-flight, like a map zooming between places
    const hop = Math.sin(e * Math.PI) * Math.min(1, from.target.distanceTo(v.set(...to.target)) / 30);
    cam.el = from.el + (to.el - from.el) * e + hop * 16;
    cam.dist = (from.dist + (to.dist - from.dist) * e) * (1 + hop * 0.45);
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
      : root.classList.contains('root') ? new THREE.Color(0xffffff) : INK;
    [LINE, LINE_SOFT, LINE_FAINT].forEach((m) => m.color.copy(lineColor));
    const shake = root.classList.contains('boom-mc') ? 0.6 : 0;
    mc.position.set(mcHome.x + (Math.random() - 0.5) * shake, 0, mcHome.z + (Math.random() - 0.5) * shake);

    renderer.render(scene, camera);

    const w = window.innerWidth;
    const h = window.innerHeight;

    // the live screen plays from the first chapter on; its sound tag only appears in the Media chapter
    if (tv.renderer) {
      if (!tv.on) {
        tv.on = true;
        tv.load();
      }
      tv.renderer.render(tv.scene, camera);
      const soundHere = chapter === 'ch-04' && k > 0.97;
      if (soundHere !== root.classList.contains('tv-sound-on')) {
        root.classList.toggle('tv-sound-on', soundHere);
        if (!soundHere && tv.unmuted) tv.setSound(false);
      }
      if (soundHere) {
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
  animators.forEach((fn) => fn(2.2, 0.016));
  moveCars(0);
  window.requestAnimationFrame(frame);
}
