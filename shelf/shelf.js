/* Shelf: renders one list from window.SHELF (data.js) as a poster grid. Each page (/movies/, /tv/, /music/)
   names its list with <body data-kind>. Items are grouped by the year each thing was finished.
   Artwork comes from the iTunes Search API, which needs no key. It is fetched over JSONP (the API's CORS
   headers are unreliable), one request at a time to stay under its rate limit, and cached in localStorage. */
(() => {
  const DATA = window.SHELF || { movies: [], tv: [], music: [] };
  const KINDS = { movies: "Movie", tv: "TV show", music: "Album" };
  const CACHE_KEY = "shelf-art-v1";
  const $ = (s, r = document) => r.querySelector(s);

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const artCache = store.get(CACHE_KEY, {});
  const tab = document.body.dataset.kind in KINDS ? document.body.dataset.kind : "movies";
  const VIEW_KEY = `shelf-view-${tab}`;
  const state = { sort: "recent", q: "", ...store.get(VIEW_KEY, {}) };

  /* ---------- artwork lookup ---------- */
  const keyOf = (tab, it) => `${tab}|${it.title}|${it.artist || ""}|${it.year || ""}`.toLowerCase();
  const big = (url) => url && url.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/, "/600x900bb.jpg");
  let seq = 0;
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = `__shelf${++seq}`;
      const s = document.createElement("script");
      const done = () => { delete window[cb]; s.remove(); clearTimeout(t); };
      const t = setTimeout(() => { done(); reject(new Error("timeout")); }, 8000);
      window[cb] = (d) => { done(); resolve(d); };
      s.onerror = () => { done(); reject(new Error("network")); };
      s.src = `${url}&callback=${cb}`;
      document.head.appendChild(s);
    });
  }
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function pick(results, tab, it) {
    if (!results.length) return null;
    const yr = (r) => +String(r.releaseDate || "").slice(0, 4);
    const name = (r) => norm(tab === "music" ? r.collectionName : tab === "tv" ? (r.artistName || r.collectionName) : r.trackName);
    const score = (r) => {
      let s = 0;
      const n = name(r), want = norm(it.title);
      if (n === want) s += 4; else if (n.startsWith(want) || n.includes(want)) s += 2;
      if (it.year && yr(r) === it.year) s += 3; else if (it.year && Math.abs(yr(r) - it.year) <= 1) s += 1;
      if (tab === "tv" && /season 1\b/i.test(r.collectionName || "")) s += 2;
      if (it.artist && norm(r.artistName).includes(norm(it.artist))) s += 3;
      return s;
    };
    return results.slice().sort((a, b) => score(b) - score(a))[0];
  }
  async function lookup(tab, it) {
    const term = encodeURIComponent(tab === "music" && it.artist ? `${it.artist} ${it.title}` : it.title);
    const q = { movies: "media=movie&entity=movie", tv: "media=tv&entity=tvSeason", music: "media=music&entity=album" }[tab];
    const d = await jsonp(`https://itunes.apple.com/search?term=${term}&${q}&limit=15&country=us`);
    const r = pick(d.results || [], tab, it);
    return r ? { art: big(r.artworkUrl100), link: r.trackViewUrl || r.collectionViewUrl || "" } : { art: "", link: "" };
  }
  const queue = [];
  let running = false;
  function want(tab, it, img) {
    if (it.art) return show(img, it.art);
    const k = keyOf(tab, it);
    if (artCache[k]) return artCache[k].art && show(img, artCache[k].art);
    queue.push({ tab, it, k, img });
    pump();
  }
  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      if (!artCache[job.k]) {
        try { artCache[job.k] = await lookup(job.tab, job.it); store.set(CACHE_KEY, artCache); }
        catch { continue; } /* leave uncached so the next visit retries */
        await new Promise((r) => setTimeout(r, 250));
      }
      if (artCache[job.k].art && job.img.isConnected) show(job.img, artCache[job.k].art);
    }
    running = false;
  }
  function show(img, src) {
    img.onload = () => img.classList.add("in");
    img.src = src;
  }

  /* ---------- rendering ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function stars(r) {
    if (r == null) return "";
    const full = Math.floor(r), half = r - full >= 0.5;
    return "★".repeat(full) + (half ? "½" : "");
  }
  const finishedYear = (it) => (it.date ? it.date.slice(0, 4) : "Undated");

  function sorted(list) {
    const by = {
      recent: (a, b) => (b.date || "").localeCompare(a.date || ""),
      rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.date || "").localeCompare(a.date || ""),
      title: (a, b) => a.title.replace(/^the /i, "").localeCompare(b.title.replace(/^the /i, "")),
      year: (a, b) => (b.year || 0) - (a.year || 0),
    }[state.sort];
    return list.slice().sort(by);
  }

  function groups(list) {
    if (state.sort === "recent") return group(list, finishedYear);
    if (state.sort === "rating") return group(list, (it) => (it.rating == null ? "Unrated" : `${stars(Math.floor(it.rating))}${it.rating % 1 ? "½" : ""}`));
    if (state.sort === "year") return group(list, (it) => (it.year ? `${Math.floor(it.year / 10) * 10}s` : "Unknown"));
    return [["", list]];
  }
  function group(list, fn) {
    const m = new Map();
    for (const it of list) { const k = fn(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    return [...m];
  }

  function card(tab, it, i) {
    const b = document.createElement("button");
    b.className = "card";
    b.type = "button";
    b.dataset.i = i;
    const sub = tab === "music" ? it.artist || it.year || "" : it.year || "";
    b.innerHTML = `
      <div class="art"><img alt="" loading="lazy"><div class="ph">${esc(it.title)}</div>${it.fav ? '<i class="fav" aria-label="Favourite">♥</i>' : ""}</div>
      <div class="cap"><b>${esc(it.title)}</b><span><em>${esc(sub)}</em><i class="stars" aria-label="${it.rating ?? "no"} stars">${stars(it.rating)}</i></span></div>`;
    want(tab, it, $("img", b));
    return b;
  }

  function render() {
    const all = DATA[tab] || [];
    const q = norm(state.q);
    const list = q ? all.filter((it) => norm(`${it.title} ${it.artist || ""} ${it.year || ""} ${it.note || ""}`).includes(q)) : all;

    document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sort === state.sort));

    const rated = all.filter((it) => it.rating != null);
    const avg = rated.length ? (rated.reduce((s, it) => s + it.rating, 0) / rated.length).toFixed(1) : "–";
    const thisYear = String(new Date().getFullYear());
    $("#stats").innerHTML = [
      [all.length, tab === "music" ? "albums" : tab === "tv" ? "shows" : "films"],
      [all.filter((it) => finishedYear(it) === thisYear).length, `in ${thisYear}`],
      [avg, "avg rating"],
      [all.filter((it) => it.fav).length, "favourites"],
    ].map(([v, l]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join("");

    const main = $("#shelf");
    main.className = tab;
    main.textContent = "";
    if (!list.length) { main.innerHTML = `<p class="empty">${all.length ? "Nothing matches that search." : "Nothing here yet."}</p>`; return; }
    const index = new Map(all.map((it, i) => [it, i]));
    for (const [label, items] of groups(sorted(list))) {
      const sec = document.createElement("section");
      sec.className = "group";
      if (label) sec.innerHTML = `<h2>${esc(label)} <small>${items.length}</small></h2>`;
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const it of items) grid.appendChild(card(tab, it, index.get(it)));
      sec.appendChild(grid);
      main.appendChild(sec);
    }
    store.set(VIEW_KEY, { sort: state.sort });
  }

  /* ---------- detail dialog ---------- */
  const dlg = $("#detail");
  function open(i) {
    const it = DATA[tab][i];
    const c = artCache[keyOf(tab, it)] || {};
    const src = it.art || c.art || "";
    const img = $(".d-art img", dlg);
    img.hidden = !src;
    img.src = src;
    $(".d-art", dlg).hidden = !src;
    dlg.classList.toggle("no-art", !src);
    $(".d-kind", dlg).textContent = KINDS[tab] + (it.fav ? " · Favourite" : "");
    $(".d-title", dlg).textContent = it.title;
    $(".d-meta", dlg).textContent = [it.artist, it.year, it.date && `Finished ${new Date(it.date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`].filter(Boolean).join(" · ");
    $(".d-stars", dlg).textContent = it.rating != null ? `${stars(it.rating)}  ${it.rating}/5` : "Unrated";
    $(".d-note", dlg).textContent = it.note || "";
    $(".d-more", dlg).innerHTML = c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">View on Apple &rarr;</a>` : "";
    dlg.showModal();
  }
  $("#shelf").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) open(+c.dataset.i); });
  $(".close", dlg).addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  /* ---------- controls ---------- */
  document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { state.sort = b.dataset.sort; render(); }));
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; render(); }, 120); });

  render();
})();
