"""Crawls TMDB for the movie and TV maps: the most-voted and most-popular titles, each with posters, genres,
keywords, top cast, creators, and TMDB's "recommendations" (what people who engage with one title also
engage with). Those recommendations are what places Better Call Saul next to Breaking Bad.

    TMDB_TOKEN=... python tools/fetch_tmdb.py <cache dir> movie|tv [pages]

The token is a TMDB "API Read Access Token" (free: themoviedb.org > Settings > API), sent as a Bearer header.
(In the cloud session that built this, a proxy injected it, so TMDB_TOKEN was a placeholder.)
Writes <cache dir>/tmdb_<kind>.jsonl, resumable.
"""
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

API = "https://api.themoviedb.org/3"
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
KIND = sys.argv[2]
PAGES = int(sys.argv[3]) if len(sys.argv) > 3 else 500
FILE = OUT / f"tmdb_{KIND}.jsonl"

session = requests.Session()
session.headers["Authorization"] = f"Bearer {os.environ.get('TMDB_TOKEN', 'proxy-injected')}"
session.mount("https://", requests.adapters.HTTPAdapter(pool_maxsize=32))
lock = threading.Lock()
last = [0.0]


def get(path, **params):
    for attempt in range(6):
        with lock:  # ~35 requests/second, under TMDB's limit
            wait = last[0] + 0.028 - time.time()
            if wait > 0:
                time.sleep(wait)
            last[0] = time.time()
        try:
            r = session.get(API + path, params=params, timeout=20)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 429:
            time.sleep(float(r.headers.get("Retry-After", 2))); continue
        if r.status_code == 404:
            return None
        if r.status_code >= 500:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code in (401, 403):
            sys.exit(f"TMDB refused the request ({r.status_code}): check the token")
        return r.json()
    return None


def discover():
    ids = {}
    sorts = ["vote_count.desc", "popularity.desc"]
    jobs = [(s, p) for s in sorts for p in range(1, PAGES + 1)]
    extra = {"vote_count.gte": 30} if KIND == "movie" else {"vote_count.gte": 15}

    def page(job):
        s, p = job
        d = get(f"/discover/{KIND}", sort_by=s, page=p, include_adult="false", **({} if s == "vote_count.desc" else extra))
        return (d or {}).get("results", [])

    with ThreadPoolExecutor(16) as pool:
        for res in pool.map(page, jobs):
            for r in res:
                ids[r["id"]] = r.get("vote_count", 0)
    return ids


def detail(tid):
    app = "recommendations,similar,keywords," + ("credits" if KIND == "movie" else "aggregate_credits")
    d = get(f"/{KIND}/{tid}", append_to_response=app)
    if not d:
        return None
    rec = [[r["id"], r.get("vote_count", 0)] for r in (d.get("recommendations") or {}).get("results", [])]
    sim = [r["id"] for r in (d.get("similar") or {}).get("results", [])]
    kw = (d.get("keywords") or {}).get("keywords" if KIND == "movie" else "results", [])
    cr = d.get("credits") or d.get("aggregate_credits") or {}
    cast = [c["name"] for c in cr.get("cast", [])[:6]]
    crew = [c["name"] for c in cr.get("crew", []) if c.get("job") in ("Director", "Screenplay", "Writer") or "Director" in str(c.get("jobs", ""))][:3]
    if KIND == "tv":
        crew = [c["name"] for c in d.get("created_by", [])][:3] or crew
    date = d.get("release_date") or d.get("first_air_date") or ""
    return {
        "id": tid, "t": d.get("title") or d.get("name"), "ot": d.get("original_title") or d.get("original_name"),
        "y": date[:4], "p": d.get("poster_path") or "", "r": d.get("vote_average", 0), "v": d.get("vote_count", 0),
        "pop": d.get("popularity", 0), "lang": d.get("original_language", ""),
        "g": [g["name"] for g in d.get("genres", [])], "kw": [k["name"] for k in kw][:25],
        "cast": cast, "crew": crew, "ov": (d.get("overview") or "")[:300],
        "net": [n["name"] for n in d.get("networks", [])][:2] if KIND == "tv" else [c["name"] for c in d.get("production_companies", [])][:2],
        "seasons": d.get("number_of_seasons"), "runtime": d.get("runtime"),
        "col": (d.get("belongs_to_collection") or {}).get("name") if KIND == "movie" else None,
        "rec": rec, "sim": sim, "imdb": (d.get("imdb_id") or ""),
    }


def main():
    done = set()
    if FILE.exists():
        done = {json.loads(l)["id"] for l in FILE.open()}
    ids = discover()
    todo = [i for i in sorted(ids, key=lambda i: -ids[i]) if i not in done]
    print(f"{KIND}: {len(ids)} discovered, {len(done)} cached, {len(todo)} to fetch", flush=True)
    with FILE.open("a") as out, ThreadPoolExecutor(24) as pool:
        for n, d in enumerate(pool.map(detail, todo), 1):
            if d:
                out.write(json.dumps(d, ensure_ascii=False) + "\n")
            if n % 1000 == 0:
                out.flush(); print(f"  {n}/{len(todo)}", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
