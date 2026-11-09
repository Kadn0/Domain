"""'People who loved this also loved...' for films, from MovieLens 32M (32 million ratings by 200k people,
GroupLens, University of Minnesota: https://grouplens.org/datasets/movielens/).

    python tools/movielens_cf.py <cache dir> [min ratings]

Needs <cache dir>/ml-32m/{ratings,links,movies}.csv. Writes <cache dir>/ml_neighbors.jsonl: for every film with
enough ratings, its TMDB id and its 30 most similar films with scores.

The formula, step by step:
  1. A rating of 4 or more counts as "loved it"; anything else is ignored.
  2. Each person's loves are weighted 1/log(2 + how many films they loved), so someone who loves 3,000 films
     says less about any pair than someone who loves 40.
  3. Two films' score is how much weighted love they share, divided by (popularity_a x popularity_b) ** 0.5 for
     the *rarer* pairing and pulled down with a shrinkage term for pairs only a handful of people share.
     That is cosine similarity with shrinkage; ALPHA tilts it away from always recommending blockbusters.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse

SRC = Path(sys.argv[1])
MIN_RATINGS = int(sys.argv[2]) if len(sys.argv) > 2 else 150
LOVE = 4.0
SHRINK = float(sys.argv[4]) if len(sys.argv) > 4 else 25.0   # co-likes needed before a pair's score is trusted fully
ALPHA = float(sys.argv[3]) if len(sys.argv) > 3 else 0.55    # 0.5 = plain cosine; higher favours less-popular matches
K = 30


def main():
    ml = SRC / "ml-32m"
    r = pd.read_csv(ml / "ratings.csv", usecols=[0, 1, 2], dtype={"userId": np.int32, "movieId": np.int32, "rating": np.float32})
    counts = r.movieId.value_counts()
    keep = counts[counts >= MIN_RATINGS].index
    r = r[r.movieId.isin(keep)]
    loved = r[r.rating >= LOVE]
    print(f"{len(keep)} films with {MIN_RATINGS}+ ratings, {len(loved):,} loves", flush=True)

    films = np.sort(loved.movieId.unique())
    fidx = pd.Series(np.arange(len(films)), index=films)
    users = loved.userId.unique()
    uidx = pd.Series(np.arange(len(users)), index=users)
    per_user = loved.userId.map(loved.userId.value_counts()).to_numpy()
    w = (1.0 / np.log(2 + per_user)).astype(np.float32)
    X = sparse.csr_matrix((w, (uidx[loved.userId].to_numpy(), fidx[loved.movieId].to_numpy())), shape=(len(users), len(films)))
    B = sparse.csr_matrix((np.ones(len(loved), np.float32), (uidx[loved.userId].to_numpy(), fidx[loved.movieId].to_numpy())), shape=X.shape)

    cache = SRC / "ml_cooc.npz"
    if cache.exists() and np.load(cache)["films"].shape == films.shape:
        z = np.load(cache); co, n_co = z["co"], z["n_co"]
    else:
        co = (X.T @ X).toarray()                  # weighted co-love
        n_co = (B.T @ B).toarray()                # raw number of people who loved both
        np.savez(cache, co=co, n_co=n_co, films=films)
    pop = np.diag(co).copy()
    np.fill_diagonal(co, 0)
    # asymmetric cosine: sim(a->b) = co / (pop_a^(1-ALPHA) * pop_b^ALPHA), shrunk by support
    denom = np.outer(pop ** (1 - ALPHA), pop ** ALPHA) + 1e-9
    sim = co / denom * (n_co / (n_co + SHRINK))
    np.fill_diagonal(sim, 0)

    links = pd.read_csv(ml / "links.csv").set_index("movieId")
    meta = pd.read_csv(ml / "movies.csv").set_index("movieId")
    out = SRC / "ml_neighbors.jsonl"
    with out.open("w") as f:
        for a, mid in enumerate(films):
            top = np.argpartition(-sim[a], K)[:K]
            top = top[np.argsort(-sim[a, top])]
            tmdb = links.tmdbId.get(mid)
            if pd.isna(tmdb):
                continue
            f.write(json.dumps({
                "ml": int(mid), "tmdb": int(tmdb), "title": meta.title.get(mid, ""), "loves": int(B[:, a].sum()),
                "nn": [[int(links.tmdbId.get(films[b])) if not pd.isna(links.tmdbId.get(films[b])) else None, round(float(sim[a, b]), 5)] for b in top],
            }) + "\n")
    print(f"wrote {out}", flush=True)


if __name__ == "__main__":
    main()
