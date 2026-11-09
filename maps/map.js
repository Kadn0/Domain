/* Dot map: every title is a dot, placed by tools/build_maps.py so similar things sit together.
   Canvas 2D; drag or pinch to pan, wheel or pinch to zoom, hover for a name, click for details and neighbours. */
(() => {
  const KIND = document.body.dataset.kind;
  const $ = (s) => document.querySelector(s);
  const cv = $("#map"), ctx = cv.getContext("2d");
  const tip = $("#tip"), card = $("#card"), list = $("#clusters");
  let D, N, W = 0, H = 0, dpr = 1;
  const view = { x: 5000, y: 5000, k: 1 }; // data coords at screen centre, pixels per data unit (set on load)
  let base = 1, hover = -1, sel = -1, focus = -1, near = [];

  /* ---------- colours: one muted hue per cluster, spaced by the golden angle ---------- */
  const colour = (c) => `hsl(${(c * 137.508 + 18) % 360} 52% 63%)`;

  /* ---------- data ---------- */
  fetch(`/maps/${KIND}.json`).then((r) => r.json()).then((d) => {
    D = d; N = d.x.length;
    D.col = d.clusters.map((_, i) => colour(i));
    D.rad = new Float32Array(N);
    const sz = d.meta.size && d[d.meta.size];
    if (sz) {
      const mx = Math.log1p(Math.max(...sz));
      for (let i = 0; i < N; i++) D.rad[i] = 0.75 + 1.0 * (Math.log1p(sz[i]) / mx) ** 2;
    } else D.rad.fill(1);
    D.lc = d.t.map((s) => String(s).toLowerCase());
    buildGrid();
    $("#count").textContent = N.toLocaleString();
    $("#source").textContent = d.meta.source;
    list.innerHTML = d.clusters.map((c, i) => `<li><button data-c="${i}"><i style="background:${D.col[i]}"></i><span>${esc(c.name)}</span><small>${c.n}</small></button></li>`).join("");
    resize(); fit(); fromHash();
    document.body.classList.add("ready");
  }).catch(() => { $("#loading").textContent = "Couldn't load the map data."; });

  /* spatial grid over data space for hover / neighbour lookups */
  const G = 64, CELL = 10001 / G;
  let grid;
  function buildGrid() {
    grid = Array.from({ length: G * G }, () => []);
    for (let i = 0; i < N; i++) grid[((D.y[i] / CELL) | 0) * G + ((D.x[i] / CELL) | 0)].push(i);
  }
  function nearest(x, y, maxD, skip) {
    let best = -1, bd = maxD * maxD;
    const r = Math.ceil(maxD / CELL), cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    for (let gy = Math.max(0, cy - r); gy <= Math.min(G - 1, cy + r); gy++)
      for (let gx = Math.max(0, cx - r); gx <= Math.min(G - 1, cx + r); gx++)
        for (const i of grid[gy * G + gx]) {
          if (skip && skip(i)) continue;
          const dx = D.x[i] - x, dy = D.y[i] - y, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = i; }
        }
    return best;
  }
  function kNearest(i, k) {
    const out = [];
    for (let r = 60; r <= 2400 && out.length < k; r *= 2) {
      out.length = 0;
      const cx = (D.x[i] / CELL) | 0, cy = (D.y[i] / CELL) | 0, g = Math.ceil(r / CELL);
      for (let gy = Math.max(0, cy - g); gy <= Math.min(G - 1, cy + g); gy++)
        for (let gx = Math.max(0, cx - g); gx <= Math.min(G - 1, cx + g); gx++)
          for (const j of grid[gy * G + gx]) if (j !== i) {
            const dx = D.x[j] - D.x[i], dy = D.y[j] - D.y[i], dd = dx * dx + dy * dy;
            if (dd <= r * r) out.push([dd - weight(j) * 40, j]);
          }
    }
    return out.sort((a, b) => a[0] - b[0]).slice(0, k).map((a) => a[1]);
  }
  const weight = (i) => (D.v ? Math.log1p(D.v[i]) : 0); // nudge better-known neighbours up the list

  /* ---------- view ---------- */
  const sx = (x) => (x - view.x) * view.k + W / 2;
  const sy = (y) => (y - view.y) * view.k + H / 2;
  const dx = (px) => (px - W / 2) / view.k + view.x;
  const dy = (py) => (py - H / 2) / view.k + view.y;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    draw();
  }
  function fit() {
    base = Math.min(W, H) / 10400;
    Object.assign(view, { x: 5000, y: 5000, k: base });
    draw();
  }
  const clampK = (k) => Math.min(Math.max(k, base * 0.6), base * 80);

  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(paint); }
  function paint() {
    raf = 0;
    if (!D) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const z = view.k / base;
    const r0 = Math.max(1.5, Math.min(6, 1.7 * z ** 0.5));
    const dim = focus >= 0;
    // dots, batched by colour
    for (let c = 0; c < D.clusters.length; c++) {
      ctx.fillStyle = D.col[c];
      ctx.globalAlpha = dim && c !== focus ? 0.1 : z < 2 ? 0.85 : 0.92;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (D.c[i] !== c) continue;
        const x = sx(D.x[i]), y = sy(D.y[i]);
        if (x < -8 || y < -8 || x > W + 8 || y > H + 8) continue;
        const r = r0 * D.rad[i];
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // neighbours and selection
    if (sel >= 0) {
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1;
      for (const j of near) { ctx.beginPath(); ctx.moveTo(sx(D.x[sel]), sy(D.y[sel])); ctx.lineTo(sx(D.x[j]), sy(D.y[j])); ctx.stroke(); }
      ring(sel, "#fff", 2);
    }
    if (hover >= 0 && hover !== sel) ring(hover, "#fff", 1.5);
    labels(z);
    // individual titles once zoomed in far enough to read them
    if (z > 7) titles(z);
  }
  function ring(i, c, w) {
    ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(sx(D.x[i]), sy(D.y[i]), 6 + D.rad[i] * 2, 0, 6.2832); ctx.stroke();
  }
  function labels(z) {
    if (z > 7) return;
    const placed = [];
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const cls = D.clusters.map((c, i) => [c, i]).sort((a, b) => b[0].n - a[0].n);
    const limit = Math.round(8 + z * 10);
    let shown = 0;
    for (const [c, i] of cls) {
      if (shown >= limit) break;
      if (focus >= 0 && i !== focus) continue;
      const x = sx(c.x), y = sy(c.y);
      if (x < 0 || y < 0 || x > W || y > H) continue;
      const fs = Math.round(Math.max(11, Math.min(15, 10 + Math.sqrt(c.n) / 6)));
      ctx.font = `500 ${fs}px "Hanken Grotesk", sans-serif`;
      const w = ctx.measureText(c.name).width + 12, h = fs + 8;
      const box = [x - w / 2, y - h / 2, w, h];
      if (placed.some((b) => box[0] < b[0] + b[2] && b[0] < box[0] + box[2] && box[1] < b[1] + b[3] && b[1] < box[1] + box[3])) continue;
      placed.push(box);
      ctx.fillStyle = "rgba(20,21,23,.72)"; ctx.fillRect(...box);
      ctx.fillStyle = "#f2f1ec"; ctx.fillText(c.name, x, y + 0.5);
      shown++;
    }
  }
  function titles(z) {
    ctx.font = `400 11px "Hanken Grotesk", sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(242,241,236,.85)";
    const placed = [];
    const vis = [];
    for (let i = 0; i < N; i++) {
      const x = sx(D.x[i]), y = sy(D.y[i]);
      if (x > -50 && y > 0 && x < W && y < H) vis.push(i);
    }
    if (vis.length > 6000) return;
    vis.sort((a, b) => weight(b) - weight(a));
    for (const i of vis) {
      if (placed.length > 160) break;
      const x = sx(D.x[i]) + 6 + D.rad[i] * 2, y = sy(D.y[i]);
      const w = ctx.measureText(D.t[i]).width;
      const box = [x, y - 7, w, 14];
      if (placed.some((b) => box[0] < b[0] + b[2] && b[0] < box[0] + box[2] && box[1] < b[1] + b[3] && b[1] < box[1] + box[3])) continue;
      placed.push(box);
      ctx.fillText(D.t[i], x, y);
    }
  }

  /* ---------- pointer: pan, pinch, hover, click ---------- */
  const pts = new Map();
  let moved = 0, pinch = 0;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; pinch = 0; });
  cv.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return onHover(e);
    if (pts.size === 1) {
      view.x -= (e.clientX - p[0]) / view.k; view.y -= (e.clientY - p[1]) / view.k;
      moved += Math.abs(e.clientX - p[0]) + Math.abs(e.clientY - p[1]);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      hideTip(); draw();
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const [a2, b2] = [...pts.values()];
      const d1 = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
      const mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
      if (d0 > 0) zoomAt(mx, my, d1 / d0);
      pinch = 1; moved += 10;
    }
  });
  const up = (e) => {
    const wasTap = pts.size === 1 && moved < 6 && !pinch;
    pts.delete(e.pointerId);
    if (wasTap) {
      const r = cv.getBoundingClientRect();
      const i = pick(e.clientX - r.left, e.clientY - r.top, e.pointerType === "touch" ? 22 : 12);
      if (i >= 0) select(i, false); else if (sel >= 0) deselect(); else if (focus >= 0) setFocus(-1);
    }
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", (e) => pts.delete(e.pointerId));
  cv.addEventListener("pointerleave", () => { if (!pts.size) hideTip(); });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });
  cv.addEventListener("dblclick", (e) => { const r = cv.getBoundingClientRect(); animateZoom(e.clientX - r.left, e.clientY - r.top, 2.5); });
  function zoomAt(px, py, f) {
    const x = dx(px), y = dy(py);
    view.k = clampK(view.k * f);
    view.x = x - (px - W / 2) / view.k; view.y = y - (py - H / 2) / view.k;
    draw();
  }
  function animateZoom(px, py, f) {
    let t = 0; const steps = 14, s = f ** (1 / steps);
    const tick = () => { zoomAt(px, py, s); if (++t < steps) requestAnimationFrame(tick); };
    tick();
  }
  function flyTo(x, y, k) {
    const from = { ...view }, to = { x, y, k: clampK(k) }, t0 = performance.now(), dur = 700;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      view.k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      view.x = from.x + (to.x - from.x) * e; view.y = from.y + (to.y - from.y) * e;
      paint();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function pick(px, py, tol) {
    if (!D) return -1;
    const skip = focus >= 0 ? (i) => D.c[i] !== focus : null;
    return nearest(dx(px), dy(py), tol / view.k, skip);
  }
  function onHover(e) {
    if (e.pointerType === "touch") return;
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const i = pick(px, py, 12);
    cv.style.cursor = i >= 0 ? "pointer" : "grab";
    if (i !== hover) { hover = i; draw(); }
    if (i < 0) return hideTip();
    tip.innerHTML = `<b>${esc(D.t[i])}</b><span>${esc(sub(i))}</span>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.transform = `translate(${Math.min(px + 14, W - tw - 8)}px, ${py + 14 + th > H ? py - th - 10 : py + 14}px)`;
  }
  function hideTip() { tip.hidden = true; if (hover >= 0) { hover = -1; draw(); } }

  /* ---------- details card ---------- */
  function sub(i) {
    if (KIND === "music") return [D.ar[i], D.yr[i] || ""].filter(Boolean).join(" · ");
    return [D.yr[i] || "", D.g[i]].filter(Boolean).join(" · ");
  }
  function select(i, fly) {
    sel = i; near = kNearest(i, 8);
    hideTip();
    const c = D.c[i];
    let art = "", facts = [], link = "";
    if (KIND === "movies") {
      if (D.p[i]) art = `<img src="${esc(D.meta.poster + D.p[i])}" alt="" onerror="this.remove()">`;
      if (D.r[i]) facts.push(`★ ${D.r[i].toFixed(1)} <small>(${D.v[i].toLocaleString()} votes)</small>`);
      if (D.im[i]) link = `https://www.imdb.com/title/${encodeURIComponent(D.im[i])}/`;
    } else if (KIND === "tv") {
      facts.push(esc(D.s[i]), esc(D.pl[i]));
      if (D.a[i]) facts.push(`With ${esc(D.a[i])}`);
      link = `https://www.justwatch.com/us/search?q=${encodeURIComponent(D.t[i])}`;
    } else {
      facts.push(`From ${esc(D.al[i])}`, esc(D.g[i]));
      const [dn, en, va, ac] = D.f[i];
      facts.push(`<span class="bars">${bar("Dance", dn)}${bar("Energy", en)}${bar("Mood", va)}${bar("Acoustic", ac)}</span>`);
      link = `https://open.spotify.com/track/${encodeURIComponent(D.id[i])}`;
    }
    card.innerHTML = `
      <button class="x" type="button" aria-label="Close">&times;</button>
      <div class="c-top">${art}<div>
        <p class="c-cl"><i style="background:${D.col[c]}"></i><button type="button" data-c="${c}">${esc(D.clusters[c].name)}</button></p>
        <h2>${esc(D.t[i])}</h2>
        <p class="c-sub">${esc(sub(i))}</p>
        ${facts.map((f) => `<p class="c-f">${f}</p>`).join("")}
        ${D.d && D.d[i] ? `<p class="c-d">${esc(D.d[i])}</p>` : ""}
        ${link ? `<a class="c-link" href="${esc(link)}" target="_blank" rel="noopener">${KIND === "movies" ? "IMDb" : KIND === "tv" ? "Where to watch" : "Play on Spotify"} &rarr;</a>` : ""}
      </div></div>
      <p class="c-h">Nearby</p>
      <ol class="near">${near.map((j) => `<li><button type="button" data-i="${j}"><i style="background:${D.col[D.c[j]]}"></i>${esc(D.t[j])} <small>${esc(KIND === "music" ? D.ar[j] : D.yr[j] || "")}</small></button></li>`).join("")}</ol>`;
    card.hidden = false;
    history.replaceState(null, "", `#${encodeURIComponent(D.t[i])}`);
    if (fly) {
      // zoom so the item and its neighbours fill the middle of the screen
      let r = 0;
      for (const j of near.slice(0, 5)) r = Math.max(r, Math.abs(D.x[j] - D.x[i]), Math.abs(D.y[j] - D.y[i]));
      const k = Math.min(W, H) * 0.32 / Math.max(r, 30);
      flyTo(D.x[i], D.y[i], Math.min(Math.max(k, base * 3), base * 30));
    }
    draw();
  }
  const bar = (l, v) => `<span><em>${l}</em><b style="--v:${v}"></b></span>`;
  function deselect() { sel = -1; near = []; card.hidden = true; history.replaceState(null, "", location.pathname); draw(); }
  card.addEventListener("click", (e) => {
    const n = e.target.closest("[data-i]"), cl = e.target.closest("[data-c]");
    if (e.target.closest(".x")) deselect();
    else if (n) select(+n.dataset.i, true);
    else if (cl) setFocus(+cl.dataset.c, true);
  });

  /* ---------- clusters list ---------- */
  function setFocus(c, fly) {
    focus = focus === c ? -1 : c;
    list.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.c === focus));
    if (focus >= 0 && fly !== false) {
      const cl = D.clusters[focus];
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < N; i++) if (D.c[i] === focus) { x0 = Math.min(x0, D.x[i]); x1 = Math.max(x1, D.x[i]); y0 = Math.min(y0, D.y[i]); y1 = Math.max(y1, D.y[i]); }
      flyTo((x0 + x1) / 2 || cl.x, (y0 + y1) / 2 || cl.y, Math.min(W / (x1 - x0 + 200), H / (y1 - y0 + 200)) * 0.85);
    }
    draw();
  }
  list.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) setFocus(+b.dataset.c); });
  $("#groupsBtn").addEventListener("click", () => document.body.classList.toggle("groups-open"));

  /* ---------- search ---------- */
  const q = $("#q"), res = $("#results");
  let hits = [], active = 0;
  q.addEventListener("input", () => {
    const s = q.value.trim().toLowerCase();
    if (!D || s.length < 2) { res.hidden = true; return; }
    hits = [];
    const bare = (t) => t.replace(/^(the|a|an) /, "");
    for (let i = 0; i < N; i++) {
      const t = D.lc[i], at = t.indexOf(s);
      let rank = -1;
      if (t === s || bare(t) === bare(s)) rank = 0;
      else if (at === 0 || bare(t).startsWith(s)) rank = 1;
      else if (at > 0 && /\W/.test(t[at - 1])) rank = 2;
      else if (at > 0) rank = 3;
      else if (KIND === "music" && D.ar[i].toLowerCase().includes(s)) rank = 2;
      if (rank >= 0) hits.push([rank, -weight(i), t.length, i]);
    }
    hits = hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).slice(0, 8).map((h) => h[3]);
    active = 0;
    res.innerHTML = hits.length ? hits.map((i, n) => `<li><button type="button" data-i="${i}" ${n === 0 ? 'class="on"' : ""}><i style="background:${D.col[D.c[i]]}"></i>${esc(D.t[i])} <small>${esc(sub(i))}</small></button></li>`).join("") : `<li class="none">No match</li>`;
    res.hidden = false;
  });
  q.addEventListener("keydown", (e) => {
    if (res.hidden || !hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      res.querySelectorAll("button").forEach((b, n) => b.classList.toggle("on", n === active));
    } else if (e.key === "Enter") { go(hits[active]); }
    else if (e.key === "Escape") res.hidden = true;
  });
  res.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) go(+b.dataset.i); });
  function go(i) { res.hidden = true; q.value = ""; q.blur(); if (focus >= 0 && D.c[i] !== focus) setFocus(-1, false); select(i, true); }
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); }
    if (e.key === "Escape" && document.activeElement !== q) { if (sel >= 0) deselect(); else if (focus >= 0) setFocus(-1); }
  });

  /* ---------- zoom buttons, deep links ---------- */
  $("#zin").addEventListener("click", () => animateZoom(W / 2, H / 2, 2));
  $("#zout").addEventListener("click", () => animateZoom(W / 2, H / 2, 0.5));
  $("#zfit").addEventListener("click", () => { setFocus(-1, false); flyTo(5000, 5000, base); });
  function fromHash() {
    const t = decodeURIComponent(location.hash.slice(1)).toLowerCase();
    if (!t) return;
    let best = -1;
    for (let i = 0; i < N; i++) if (D.lc[i] === t && (best < 0 || weight(i) > weight(best))) best = i;
    if (best >= 0) select(best, true);
  }
  addEventListener("hashchange", () => { if (D) fromHash(); });
  addEventListener("resize", () => { const k = view.k / base; resize(); base = Math.min(W, H) / 10400; view.k = base * k; draw(); });

  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
})();
