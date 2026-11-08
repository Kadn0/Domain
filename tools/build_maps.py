"""Builds the dot maps behind /movies/, /tv/ and /music/.

Every title becomes a vector (genres, people, places, decade and the words of its description; for songs, how
they sound). UMAP flattens those vectors to 2-D so similar things land near each other, then HDBSCAN finds the
clumps and each clump is named from what is most over-represented in it.

    pip install umap-learn scikit-learn pandas
    python tools/build_maps.py <data dir> [movies tv music]

<data dir> holds the source CSVs (none are committed; all are public):
  movies_metadata.csv       The Movies Dataset (TMDB, ~45k films), e.g. RunestoneInteractive/httlads Data/
  netflix_titles.csv        rfordatascience/tidytuesday data/2021/2021-04-20/
  amazon_prime.csv, hulu.csv, disney_plus.csv
                            the matching Prime / Hulu / Disney+ catalogs (same columns as Netflix)
  spotify_songs.csv         rfordatascience/tidytuesday data/2020/2020-01-21/
Writes maps/<name>.json next to the pages.
"""
import ast
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import umap
from scipy import sparse
from sklearn.cluster import HDBSCAN
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import normalize, StandardScaler

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "maps"
SEED = 7


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")


def lit(s, default):
    try:
        v = ast.literal_eval(s)
        return v if v is not None else default
    except Exception:
        return default


def embed(X, n_neighbors=15, min_dist=0.05, metric="cosine"):
    return umap.UMAP(n_neighbors=n_neighbors, min_dist=min_dist, metric=metric, random_state=SEED).fit_transform(X)


def cluster(xy, min_size):
    labels = HDBSCAN(min_cluster_size=min_size, min_samples=max(5, min_size // 4)).fit_predict(xy)
    noise = labels < 0
    if noise.any() and (~noise).any():  # give stragglers the colour of their neighbourhood
        knn = KNeighborsClassifier(n_neighbors=7).fit(xy[~noise], labels[~noise])
        labels[noise] = knn.predict(xy[noise])
    # renumber biggest first
    order = [c for c, _ in Counter(labels).most_common()]
    remap = {c: i for i, c in enumerate(order)}
    return np.array([remap[c] for c in labels])


def name_clusters(labels, tokens, pretty, k=2, min_share=0.2, second_share=0.35):
    """tokens: list of sets per item. Name each cluster by its most over-represented tokens.
    The second word must cover more of the cluster than the first, so names stay honest; repeats get a third word."""
    n = len(labels)
    total = Counter(t for ts in tokens for t in ts)
    ranked = []
    for c in range(labels.max() + 1):
        idx = np.where(labels == c)[0]
        cnt = Counter(t for i in idx for t in tokens[i])
        scored = []
        for t, f in cnt.items():
            share = f / len(idx)
            if share < min_share or total[t] < 5 or not pretty(t):
                continue
            lift = share / (total[t] / n)
            scored.append((share * math.log(lift + 1e-9), share, pretty(t)))
        scored.sort(reverse=True)
        out = []
        for i, (_, share, p) in enumerate(scored):
            if p not in out and (not out or share >= second_share):
                out.append(p)
        ranked.append(out)
    names = [" · ".join(r[:k]) or "Miscellany" for r in ranked]
    seen = Counter(names)
    for c, nm in enumerate(names):
        if seen[nm] > 1 and len(ranked[c]) > k:
            names[c] = " · ".join(ranked[c][: k + 1])
    # anything still repeated gets numbered, biggest first (clusters are already ordered by size)
    count = Counter()
    for c, nm in enumerate(names):
        if Counter(names)[nm] > 1 or count[nm]:
            count[nm] += 1
            names[c] = f"{nm} {['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][min(count[nm], 7)]}"
    return names


def write(name, xy, labels, names, cols, meta):
    lo, hi = xy.min(0), xy.max(0)
    span = (hi - lo).max()
    q = np.round((xy - lo) / span * 10000).astype(int)
    clusters = []
    for c, nm in enumerate(names):
        idx = labels == c
        clusters.append({"name": nm, "n": int(idx.sum()), "x": int(np.median(q[idx, 0])), "y": int(np.median(q[idx, 1]))})
    doc = {"meta": meta, "clusters": clusters, "x": q[:, 0].tolist(), "y": q[:, 1].tolist(), "c": labels.tolist(), **cols}
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print(f"{name}: {len(labels)} points, {len(names)} clusters, {path.stat().st_size / 1e6:.1f} MB")
    for c in clusters[:40]:
        print(f"   {c['n']:5d}  {c['name']}")


# ---------------------------------------------------------------- movies
LANG = {"en": "English", "fr": "French", "ja": "Japanese", "it": "Italian", "de": "German", "es": "Spanish",
        "ru": "Russian", "hi": "Hindi", "ko": "Korean", "zh": "Chinese", "cn": "Cantonese", "sv": "Swedish",
        "da": "Danish", "pt": "Portuguese", "fi": "Finnish", "nl": "Dutch", "pl": "Polish", "tr": "Turkish",
        "ta": "Tamil", "te": "Telugu", "ml": "Malayalam", "th": "Thai", "no": "Norwegian", "fa": "Persian",
        "cs": "Czech", "hu": "Hungarian", "el": "Greek", "ar": "Arabic", "he": "Hebrew", "tl": "Tagalog"}
STOP_WORDS = "english"


def movies():
    m = pd.read_csv(SRC / "movies_metadata.csv", low_memory=False)
    m["votes"] = pd.to_numeric(m.vote_count, errors="coerce")
    m["year"] = pd.to_datetime(m.release_date, errors="coerce").dt.year
    m = m[(m.votes >= 10) & m.year.notna()].drop_duplicates("id").reset_index(drop=True)
    m["overview"] = m.overview.fillna("")
    toks, docs = [], []
    for r in m.itertuples():
        g = [d["name"] for d in lit(r.genres, [])]
        col = lit(r.belongs_to_collection, {}) if isinstance(r.belongs_to_collection, str) else {}
        comp = [d["name"] for d in lit(r.production_companies, [])][:3]
        ctry = [d["iso_3166_1"] for d in lit(r.production_countries, [])][:2]
        t = {f"g_{slug(x)}" for x in g} | {f"l_{r.original_language}"} | {f"c_{x}" for x in ctry}
        t |= {f"p_{slug(x)}" for x in comp} | {f"d_{int(r.year) // 10 * 10}"}
        if col:
            t.add(f"k_{slug(col.get('name', ''))}")
        toks.append(t)
        docs.append(" ".join(sorted(t)) + " " + " ".join(f"g_{slug(x)}" for x in g) * 2)  # genres count triple
    meta = TfidfVectorizer(token_pattern=r"\S+", min_df=2, sublinear_tf=True).fit_transform(docs)
    words = TfidfVectorizer(stop_words=STOP_WORDS, min_df=3, max_features=20000, sublinear_tf=True).fit_transform(m.overview)
    X = sparse.hstack([meta, 0.6 * words]).tocsr()
    X = normalize(TruncatedSVD(120, random_state=SEED).fit_transform(X))
    xy = embed(X)
    labels = cluster(xy, max(40, len(m) // 250))

    def pretty(t):
        kind, v = t[:2], t[2:]
        if kind == "g_":
            return v.replace("_", " ").title().replace("Tv ", "TV ")
        if kind == "l_" and v != "en":
            return LANG.get(v, v.upper())
        if kind == "d_":
            return f"{v}s"
        if kind == "k_":
            return v.replace("_", " ").title().replace(" Collection", "")
        return None

    names = name_clusters(labels, toks, pretty)
    g = [", ".join(d["name"] for d in lit(s, [])[:3]) for s in m.genres]
    write("movies", xy, labels, names, {
        "t": m.title.fillna("").tolist(),
        "yr": m.year.astype(int).tolist(),
        "r": pd.to_numeric(m.vote_average, errors="coerce").fillna(0).round(1).tolist(),
        "v": m.votes.astype(int).tolist(),
        "g": g,
        "p": [p if isinstance(p, str) else "" for p in m.poster_path],
        "im": m.imdb_id.fillna("").tolist(),
        "d": [o[:220] + ("…" if len(o) > 220 else "") for o in m.overview],
    }, {"kind": "movies", "source": "The Movies Dataset (TMDB metadata), films with 10+ votes", "size": "v", "poster": "https://image.tmdb.org/t/p/w185"})


# ---------------------------------------------------------------- tv
# The four services name the same genres differently; fold them together, and drop tags that say nothing.
TV_GENRE = [
    (r"^(international tv shows|international|tv shows|series|special interest|tv|shows|lgbtq|faith & spirituality|black stories|latino|international|adult animation)$", None),
    (r"docuseries|documentar", "Documentary"), (r"anime", "Anime"), (r"kids|children", "Kids"),
    (r"sci-fi|science fiction", "Sci-Fi & Fantasy"), (r"^fantasy$", "Sci-Fi & Fantasy"),
    (r"reality|unscripted|game show|competition", "Reality"), (r"stand-up|talk show|late night", "Talk & Stand-Up"),
    (r"romanti|romance", "Romance"), (r"crime", "Crime"), (r"thriller|suspense", "Thriller"), (r"myster", "Mystery"),
    (r"horror", "Horror"), (r"sitcom", "Sitcom"), (r"comed", "Comedy"), (r"drama", "Drama"),
    (r"action|adventure", "Action & Adventure"), (r"teen|coming of age|young adult", "Teen"),
    (r"korean", "Korean"), (r"spanish|latino|latin", "Spanish-language"), (r"british", "British"),
    (r"science & nature|science|nature|animals", "Nature & Science"), (r"cooking|food", "Food"),
    (r"lifestyle|travel|home", "Lifestyle"), (r"histor", "History"), (r"music", "Music"), (r"sport", "Sports"),
    (r"animation|cartoon", "Animation"), (r"famil", "Family"), (r"news|politic", "News & Politics"),
    (r"classic|cult", "Classic"),
]


def tv_genre(g):
    g = g.strip().lower()
    for pat, out in TV_GENRE:
        if re.search(pat, g):
            return out
    return g.title()


def tv():
    frames = []
    for f, plat in [("netflix_titles", "Netflix"), ("amazon_prime", "Prime Video"), ("hulu", "Hulu"), ("disney_plus", "Disney+")]:
        d = pd.read_csv(SRC / f"{f}.csv")
        d = d[d.type == "TV Show"].copy()
        d["plat"] = plat
        frames.append(d)
    a = pd.concat(frames, ignore_index=True)
    a["key"] = a.title.str.lower().str.strip()
    rows = []
    for key, grp in a.groupby("key", sort=False):
        r = grp.iloc[0]
        genres = sorted({tv_genre(g) for s in grp.listed_in.dropna() for g in s.split(",") if g.strip()} - {None})
        cast = [c.strip() for c in str(r.cast).split(",")][:6] if isinstance(r.cast, str) else []
        ctry = [c.strip() for c in str(r.country).split(",") if c.strip()][:2] if isinstance(r.country, str) else []
        rows.append({"title": r.title, "year": int(r.release_year) if not pd.isna(r.release_year) else 0, "genres": genres,
                     "cast": cast, "country": ctry, "plat": sorted(set(grp.plat)),
                     "desc": next((x for x in grp.description if isinstance(x, str)), ""), "seasons": str(r.duration or "")})
    df = pd.DataFrame(rows)
    toks, docs = [], []
    for r in df.itertuples():
        g = r.genres
        t = {f"g_{slug(x)}" for x in g} | {f"c_{slug(x)}" for x in r.country} | {f"d_{r.year // 10 * 10}"} | {f"a_{slug(x)}" for x in r.cast}
        toks.append(t)
        docs.append(" ".join(sorted(t)) + " " + " ".join(f"g_{slug(x)}" for x in g) * 2)
    meta = TfidfVectorizer(token_pattern=r"\S+", min_df=2, sublinear_tf=True).fit_transform(docs)
    words = TfidfVectorizer(stop_words=STOP_WORDS, min_df=3, sublinear_tf=True).fit_transform(df.desc)
    X = normalize(TruncatedSVD(80, random_state=SEED).fit_transform(sparse.hstack([meta, 0.6 * words]).tocsr()))
    xy = embed(X, n_neighbors=12)
    labels = cluster(xy, max(30, len(df) // 80))

    def pretty(t):
        kind, v = t[:2], t[2:]
        if kind == "g_":
            return GENRE_NAME.get(v, v.replace("_", " ").title())
        if kind == "c_" and v not in ("united_states", "united_kingdom", "south_korea", "japan"):
            return v.replace("_", " ").title()
        return None

    GENRE_NAME = {slug(o): o for _, o in TV_GENRE if o}
    names = name_clusters(labels, toks, pretty)
    write("tv", xy, labels, names, {
        "t": df.title.tolist(), "yr": df.year.tolist(),
        "g": [", ".join(x[:3]) for x in df.genres], "pl": [", ".join(x) for x in df.plat],
        "s": df.seasons.tolist(), "a": [", ".join(x[:3]) for x in df.cast],
        "d": [o[:220] for o in df.desc],
    }, {"kind": "tv", "source": "Netflix, Prime Video, Hulu and Disney+ catalogs (2021)"})


# ---------------------------------------------------------------- music
AUDIO = ["danceability", "energy", "loudness", "speechiness", "acousticness", "instrumentalness", "liveness", "valence", "tempo"]


def music():
    s = pd.read_csv(SRC / "spotify_songs.csv")
    s = s.dropna(subset=["track_name"])
    sub = s.groupby("track_id").playlist_subgenre.agg(lambda x: sorted(set(x)))
    s = s.sort_values("track_popularity", ascending=False).drop_duplicates("track_id")
    s = s.drop_duplicates(["track_name", "track_artist"]).reset_index(drop=True)
    s["subs"] = s.track_id.map(sub)
    A = StandardScaler().fit_transform(s[AUDIO].clip(lower=s[AUDIO].quantile(0.01), upper=s[AUDIO].quantile(0.99), axis=1))
    allsub = sorted({x for xs in s.subs for x in xs})
    S = np.array([[1.0 if g in xs else 0.0 for g in allsub] for xs in s.subs])
    X = np.hstack([A, 1.6 * S])
    xy = embed(X, n_neighbors=20, min_dist=0.08, metric="euclidean")
    labels = cluster(xy, max(60, len(s) // 120))
    toks = [{f"s_{x}" for x in xs} | {f"q_{q}" for q in moods(r)} for xs, r in zip(s.subs, s[AUDIO].to_dict("records"))]

    def pretty(t):
        return t[2:].title().replace("Edm", "EDM").replace("R&B", "R&B").replace("Hip Hop", "Hip-Hop") if t.startswith("s_") else (t[2:] if t.startswith("q_") else None)

    names = name_clusters(labels, toks, pretty)
    year = pd.to_datetime(s.track_album_release_date, errors="coerce", format="mixed").dt.year.fillna(0).astype(int)
    write("music", xy, labels, names, {
        "t": s.track_name.tolist(), "ar": s.track_artist.fillna("").tolist(), "al": s.track_album_name.fillna("").tolist(),
        "yr": year.tolist(), "v": s.track_popularity.astype(int).tolist(),
        "g": [", ".join(x) for x in s.subs], "id": s.track_id.tolist(),
        "f": s[["danceability", "energy", "valence", "acousticness"]].round(2).values.tolist(),
    }, {"kind": "music", "source": "Spotify songs via TidyTuesday (2020)", "size": "v"})


def moods(r):
    out = []
    if r["acousticness"] > 0.6: out.append("Acoustic")
    if r["instrumentalness"] > 0.5: out.append("Instrumental")
    if r["speechiness"] > 0.3: out.append("Wordy")
    if r["energy"] > 0.85: out.append("High energy")
    if r["energy"] < 0.4: out.append("Mellow")
    if r["valence"] > 0.75: out.append("Upbeat")
    if r["valence"] < 0.25: out.append("Dark")
    if r["danceability"] > 0.8: out.append("Danceable")
    return out


if __name__ == "__main__":
    for which in sys.argv[2:] or ["movies", "tv", "music"]:
        {"movies": movies, "tv": tv, "music": music}[which]()
