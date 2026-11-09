"""Crawls Deezer's public API (no key) for the music map: artists, their fan-based "related artists",
fan counts, pictures and top albums with covers.

    python tools/fetch_deezer.py <cache dir> [max artists]

Seeds from Deezer's charts and every genre's artist list, then walks related-artist links breadth first,
keeping artists with enough fans. Writes <cache dir>/deezer_artists.jsonl (resumable).
Deezer allows about 50 requests per 5 seconds, so this paces itself to ~8 per second.
"""
import json
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

API = "https://api.deezer.com"
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
MAX = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
MIN_FANS = 25_000
FILE = OUT / "deezer_artists.jsonl"

session = requests.Session()
lock = threading.Lock()
last = [0.0]


def get(path, **params):
    for attempt in range(6):
        with lock:  # global pacing
            wait = last[0] + 0.125 - time.time()
            if wait > 0:
                time.sleep(wait)
            last[0] = time.time()
        try:
            r = session.get(API + path, params=params, timeout=20)
            d = r.json()
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if isinstance(d, dict) and "error" in d:
            if d["error"].get("code") == 4:  # quota exceeded
                time.sleep(5); continue
            return None
        return d
    return None


META = {}  # id -> (name, fans, picture), learned from related lists so most artists need no extra call


def fetch_artist(aid):
    rel = get(f"/artist/{aid}/related", limit=25) or {}
    alb = get(f"/artist/{aid}/albums", limit=50) or {}
    albums = [a for a in alb.get("data", []) if a.get("record_type") in ("album", "ep")]
    albums.sort(key=lambda a: -(a.get("fans") or 0))
    for r in rel.get("data", []):
        META.setdefault(r["id"], (r.get("name", ""), r.get("nb_fan", 0), r.get("picture_medium", "")))
    if aid not in META:
        info = get(f"/artist/{aid}") or {}
        META[aid] = (info.get("name", ""), info.get("nb_fan", 0), info.get("picture_medium", ""))
    name, fans, pic = META[aid]
    return {
        "id": aid, "name": name, "fans": fans,
        "pic": pic,
        "albums": [{"id": a["id"], "t": a["title"], "y": (a.get("release_date") or "")[:4], "cover": a.get("cover_medium", ""), "fans": a.get("fans", 0)} for a in albums[:6]],
        "related": [[r["id"], r.get("name", ""), r.get("nb_fan", 0)] for r in rel.get("data", [])],
    }


def main():
    done = {}
    if FILE.exists():
        for line in FILE.open():
            a = json.loads(line); done[a["id"]] = a
    queue, seen = deque(), set(done)
    genre_of = {}

    def push(aid, fans, genre=None):
        if genre and aid not in genre_of:
            genre_of[aid] = genre
        if aid not in seen and fans >= MIN_FANS:
            seen.add(aid); queue.append(aid)

    genres = (get("/genre") or {}).get("data", [])
    for g in genres:
        if g["id"] == 0:
            continue
        for a in (get(f"/genre/{g['id']}/artists") or {}).get("data", []):
            push(a["id"], 10**9, g["name"])
    for a in (get("/chart/0/artists", limit=100) or {}).get("data", []):
        push(a["id"], 10**9)
    for a in done.values():  # resume: re-queue neighbours of what we have
        for rid, nm, f in a["related"]:
            push(rid, f)
    print(f"seeded {len(queue)} artists ({len(done)} cached)", flush=True)

    with FILE.open("a") as out, ThreadPoolExecutor(12) as pool:
        while queue and len(done) < MAX:
            batch = [queue.popleft() for _ in range(min(24, len(queue)))]
            for a in pool.map(fetch_artist, batch):
                if not a or not a["name"]:
                    continue
                a["genre"] = genre_of.get(a["id"])
                done[a["id"]] = a
                out.write(json.dumps(a, ensure_ascii=False) + "\n")
                for rid, _, f in a["related"]:
                    push(rid, f)
            out.flush()
            if len(done) // 500 != (len(done) - len(batch)) // 500:
                print(f"{len(done)} artists, {len(queue)} queued", flush=True)
    print(f"done: {len(done)} artists", flush=True)


if __name__ == "__main__":
    main()
