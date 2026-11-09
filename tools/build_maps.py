"""Builds the maps behind /movies/, /tv/ and /music/ from what people actually watch and listen to together.

Placement comes mostly from recommendation links: TMDB's per-title recommendations for films and TV, Deezer's
fan-based related artists for music. Two titles land close when they recommend each other or are recommended
by the same titles. Genres, keywords, cast and creators add a lighter pull, so titles with few links still
find a sensible home. UMAP flattens that to 2-D, HDBSCAN finds the regions, and each region is named.

    pip install umap-learn scikit-learn requests
    python tools/fetch_tmdb.py <cache> tv        # needs a TMDB read token; see the script
    python tools/fetch_tmdb.py <cache> movie
    python tools/fetch_deezer.py <cache>         # no key
    python tools/build_maps.py <cache> [movies tv music]

Writes maps/<name>.json next to the pages.
"""
import datetime
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import umap
from scipy import sparse
from sklearn.cluster import HDBSCAN
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import KNeighborsClassifier, NearestNeighbors
from sklearn.preprocessing import normalize

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "maps"
SEED = 7
TODAY = datetime.date.today().isoformat()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")


def load(name):
    rows, seen = [], set()
    for line in (SRC / name).open():
        r = json.loads(line)
        if r["id"] not in seen:
            seen.add(r["id"]); rows.append(r)
    return rows


# ---------------------------------------------------------------- shared machinery
def link_matrix(n, links, decay=4.0, mutual=2.0):
    """links: per node, an ordered list of node indices it recommends. Symmetric adjacency where a link's
    weight falls with its rank, and pairs that recommend each other (Breaking Bad <-> Better Call Saul)
    pull harder."""
    pos = [{j: r for r, j in enumerate(js)} for js in links]
    r, c, w = [], [], []
    for i, js in enumerate(links):
        for rank, j in enumerate(js):
            if j == i:
                continue
            wt = math.exp(-rank / decay)
            if i in pos[j]:
                wt *= 1 + mutual * math.exp(-pos[j][i] / decay)
            r.append(i); c.append(j); w.append(wt)
    A = sparse.csr_matrix((w, (r, c)), shape=(n, n))
    return A + A.T


def features(A, docs, meta_weight):
    """Each title's direct links, plus its links smoothed one hop (titles that share neighbours get similar
    rows), plus TF-IDF metadata; reduced with SVD and normalised for cosine distance."""
    n = A.shape[0]
    R = normalize(A + sparse.identity(n, format="csr"))
    parts = [R, 0.5 * normalize(R @ R)]
    if docs is not None:
        M = TfidfVectorizer(token_pattern=r"\S+", min_df=2, sublinear_tf=True).fit_transform(docs)
        parts.append(meta_weight * normalize(M))
    X = sparse.hstack(parts).tocsr()
    return normalize(TruncatedSVD(min(160, n - 1), random_state=SEED).fit_transform(X))


def layout(X, n_neighbors=12, min_dist=0.1):
    return umap.UMAP(n_neighbors=n_neighbors, min_dist=min_dist, metric="cosine", random_state=SEED).fit_transform(X)


def cluster(xy, min_size):
    labels = HDBSCAN(min_cluster_size=min_size, min_samples=max(5, min_size // 4)).fit_predict(xy)
    noise = labels < 0
    if noise.any() and (~noise).any():
        labels[noise] = KNeighborsClassifier(n_neighbors=7).fit(xy[~noise], labels[~noise]).predict(xy[noise])
    order = [c for c, _ in Counter(labels).most_common()]
    remap = {c: i for i, c in enumerate(order)}
    return np.array([remap[c] for c in labels])


def name_by_tokens(labels, tokens, pretty, k=2, min_share=0.2, second_share=0.3):
    """Name each region by the tags most over-represented in it."""
    n = len(labels)
    total = Counter(t for ts in tokens for t in ts)
    names = []
    for c in range(labels.max() + 1):
        idx = np.where(labels == c)[0]
        cnt = Counter(t for i in idx for t in tokens[i])
        scored = []
        for t, f in cnt.items():
            share, p = f / len(idx), pretty(t)
            if share < min_share or total[t] < 5 or not p:
                continue
            scored.append((share * math.log(share / (total[t] / n) + 1e-9), share, p))
        scored.sort(reverse=True)
        out = []
        for _, share, p in scored:
            if p not in out and (not out or share >= second_share):
                out.append(p)
        names.append(" · ".join(out[:k]))
    return names


def examples(labels, titles, weight, k=2):
    """Each region's best-known titles, e.g. 'Drake · Travis Scott'."""
    w = np.asarray(weight)
    out = []
    for c in range(labels.max() + 1):
        idx = np.where(labels == c)[0]
        out.append(" · ".join(titles[i] for i in idx[np.argsort(-w[idx])][:k]))
    return out


def unique(names):
    seen, count, out = Counter(names), Counter(), []
    for nm in names:
        if seen[nm] > 1:
            count[nm] += 1
            nm = f"{nm} {['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][min(count[nm], 9)]}"
        out.append(nm)
    return out


def nearby(X, links, weight, k=10):
    """'If you like this': the source's own recommendations first, in its order, then the closest
    better-known titles in feature space to fill the list."""
    _, knn = NearestNeighbors(n_neighbors=40, metric="cosine").fit(X).kneighbors(X)
    w = np.log1p(np.asarray(weight, float))
    out = []
    for i, js in enumerate(links):
        seen, lst = {i}, []
        for j in js:
            if j not in seen:
                seen.add(j); lst.append(j)
        cand = sorted((j for j in knn[i][1:] if j not in seen), key=lambda j: -w[j])
        lst += cand[: max(0, k - len(lst))]
        out.append([int(j) for j in lst[:k]])
    return out


def write(name, xy, labels, names, cols, meta):
    lo, hi = xy.min(0), xy.max(0)
    q = np.round((xy - lo) / (hi - lo).max() * 10000).astype(int)
    clusters = [{"name": nm, "n": int((labels == c).sum()), "x": int(np.median(q[labels == c, 0])),
                 "y": int(np.median(q[labels == c, 1]))} for c, nm in enumerate(names)]
    doc = {"meta": meta, "clusters": clusters, "x": q[:, 0].tolist(), "y": q[:, 1].tolist(), "c": labels.tolist(), **cols}
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print(f"{name}: {len(labels)} points, {len(names)} regions, {path.stat().st_size / 1e6:.1f} MB", flush=True)
    for c in clusters:
        print(f"   {c['n']:5d}  {c['name']}")


# ---------------------------------------------------------------- films and TV (TMDB)
LANG = {"ja": "Japanese", "ko": "Korean", "fr": "French", "es": "Spanish", "hi": "Hindi", "zh": "Chinese",
        "it": "Italian", "de": "German", "cn": "Cantonese", "ta": "Tamil", "te": "Telugu", "ru": "Russian",
        "tr": "Turkish", "th": "Thai", "pt": "Portuguese", "sv": "Swedish", "da": "Danish", "ml": "Malayalam",
        "tl": "Filipino", "id": "Indonesian", "no": "Norwegian", "pl": "Polish", "nl": "Dutch", "ar": "Arabic"}
DULL_KW = {"based_on_novel_or_book", "woman_director", "duringcreditsstinger", "aftercreditsstinger", "sequel",
           "remake", "based_on_comic", "based_on_true_story", "biography", "anime", "live_action_remake", "lgbt",
           "sitcom", "miniseries", "based_on_manga", "based_on_young_adult_novel", "adult_animation", "shounen",
           "based_on_video_game", "based_on_play_or_musical", "musical", "short_film", "duringcreditsstinger",
           "seinen", "shoujo", "josei", "reboot", "spin_off", "prequel", "new_york_city", "los_angeles_california"}


def screen(kind, min_votes):
    rows = [r for r in load(f"tmdb_{kind}.jsonl") if r["v"] >= min_votes and r["t"] and r["p"]]
    idx = {r["id"]: i for i, r in enumerate(rows)}
    n = len(rows)
    links = [[idx[j] for j, _ in r["rec"] if j in idx] for r in rows]
    sims = [[idx[j] for j in r["sim"][:8] if j in idx] for r in rows]
    A = link_matrix(n, links) + 0.25 * link_matrix(n, sims)
    toks, docs = [], []
    for r in rows:
        t = {f"g_{slug(g)}" for g in r["g"]} | {f"k_{slug(k)}" for k in r["kw"][:15]} | {f"l_{r['lang']}"}
        t |= {f"a_{slug(a)}" for a in r["cast"][:4]} | {f"c_{slug(c)}" for c in r["crew"]} | {f"n_{slug(x)}" for x in r["net"]}
        if r.get("col"):
            t.add(f"s_{slug(r['col'])}")
        if r["y"]:
            t.add(f"d_{int(r['y']) // 10 * 10}")
        toks.append(t)
        docs.append(" ".join(sorted(t)) + " " + " ".join(f"g_{slug(g)}" for g in r["g"]))
    X = features(A, docs, meta_weight=0.3)
    xy = layout(X)
    labels = cluster(xy, max(30, n // 160))

    def pretty(t):
        k_, v = t[:2], t[2:]
        if k_ == "g_":
            return v.replace("_", " ").title().replace("Tv ", "TV ").replace("Sci Fi", "Sci-Fi").replace(" And ", " & ")
        if k_ == "l_":
            return LANG.get(v)
        if k_ == "k_" and v not in DULL_KW:
            return v.replace("_", " ").capitalize()
        if k_ == "s_":
            return v.replace("_", " ").title().replace(" Collection", "")
        return None

    tags = name_by_tokens(labels, toks, pretty)
    eg = examples(labels, [r["t"] for r in rows], [r["v"] for r in rows], k=1)
    # "Crime · Drug dealer" reads better with a landmark: "Crime · Drug dealer (Breaking Bad)"
    names = unique([f"{t} ({e})" if t else e for t, e in zip(tags, eg)])
    nn = nearby(X, links, [r["v"] for r in rows])
    cols = {
        "id": [r["id"] for r in rows], "t": [r["t"] for r in rows], "yr": [int(r["y"] or 0) for r in rows],
        "p": [r["p"] for r in rows], "r": [round(r["r"], 1) for r in rows], "v": [r["v"] for r in rows],
        "g": [", ".join(r["g"][:3]) for r in rows], "nn": nn,
        "a": [", ".join(r["cast"][:3]) for r in rows], "cr": [", ".join(r["crew"][:2]) for r in rows],
        "d": [r["ov"][:220] for r in rows],
    }
    if kind == "tv":
        cols["s"] = [r.get("seasons") or 0 for r in rows]
        cols["net"] = [", ".join(r["net"]) for r in rows]
    else:
        cols["im"] = [r.get("imdb", "") for r in rows]
    name = "movies" if kind == "movie" else "tv"
    write(name, xy, labels, names, cols, {"kind": name, "source": "TMDB", "size": "v", "built": TODAY})


# ---------------------------------------------------------------- music (Deezer)
def music(min_fans=25_000):
    rows = [r for r in load("deezer_artists.jsonl") if r["fans"] >= min_fans and r["albums"]]
    idx = {r["id"]: i for i, r in enumerate(rows)}
    n = len(rows)
    links = [[idx[j] for j, _, _ in r["related"] if j in idx] for r in rows]
    X = features(link_matrix(n, links), None, 0)
    xy = layout(X)
    labels = cluster(xy, max(25, n // 140))
    names = unique(examples(labels, [r["name"] for r in rows], [r["fans"] for r in rows], k=2))
    nn = nearby(X, links, [r["fans"] for r in rows])
    md5 = lambda u: (re.search(r"/(?:cover|artist)/([0-9a-f]{32})/", u or "") or [None, ""])[1]
    write("music", xy, labels, names, {
        "id": [r["id"] for r in rows], "t": [r["name"] for r in rows], "v": [r["fans"] for r in rows],
        "p": [md5(r["albums"][0]["cover"]) for r in rows], "pic": [md5(r["pic"]) for r in rows],
        "al": [[[a["id"], a["t"], a["y"], md5(a["cover"])] for a in r["albums"][:6]] for r in rows],
        "nn": nn,
    }, {"kind": "music", "source": "Deezer", "size": "v", "built": TODAY})


if __name__ == "__main__":
    for which in sys.argv[2:] or ["movies", "tv", "music"]:
        {"movies": lambda: screen("movie", 150), "tv": lambda: screen("tv", 40), "music": music}[which]()
