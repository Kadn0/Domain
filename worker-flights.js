// Cloudflare Worker: flights relay for the World extra on kadents.com.
// Browsers can't read OpenSky directly (no CORS), so this Worker asks OpenSky for every aircraft over the lower 48 in one call,
// trims each to [lat, lon, track, altitude ft, callsign], and caches the answer.
//
// Deploy:   wrangler deploy worker-flights.js --name flights --compatibility-date 2024-09-01
// Then set FLIGHTS_URL in world.js to the Worker's URL.
//
// Optional, for fresher data: a free OpenSky account's API client. Add it as two Worker secrets
// (wrangler secret put OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET). Without them the Worker uses
// OpenSky's anonymous allowance and refreshes every 15 minutes; with them, every 90 seconds.

const ALLOW_ORIGIN = 'https://kadents.com';
const BOX = 'lamin=24&lomin=-125&lamax=50&lomax=-66';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

async function token(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET }),
  });
  return r.ok ? (await r.json()).access_token : null;
}

export default {
  async fetch(request, env, ctx) {
    const cors = { 'Access-Control-Allow-Origin': ALLOW_ORIGIN, 'Access-Control-Allow-Methods': 'GET,OPTIONS', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors });

    const cache = caches.default;
    const key = new Request('https://flights-cache.local/us');
    const hit = await cache.match(key);
    if (hit) return new Response(await hit.text(), { headers: { 'content-type': 'application/json', ...cors } });

    const bearer = await token(env).catch(() => null);
    const ttl = bearer ? 90 : 900;
    const r = await fetch(`https://opensky-network.org/api/states/all?${BOX}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    if (!r.ok) return new Response(JSON.stringify({ error: `opensky ${r.status}` }), { status: 502, headers: { 'content-type': 'application/json', ...cors } });
    const data = await r.json();
    const ac = (data.states || [])
      .filter((s) => typeof s[5] === 'number' && typeof s[6] === 'number' && !s[8]) // has a position and is airborne
      .map((s) => [+s[6].toFixed(3), +s[5].toFixed(3), Math.round(s[10] ?? 0), Math.round((s[7] ?? s[13] ?? 0) * 3.281), (s[1] || '').trim()]);
    const body = JSON.stringify({ t: Date.now(), ac });
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } })));
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.min(ttl, 90)}`, ...cors } });
  },
};
