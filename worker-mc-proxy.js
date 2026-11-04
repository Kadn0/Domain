// Cloudflare Worker script: mc-status proxy
// Deploy this as a Worker and set PROXY_URL in main.js to the worker URL.
// Only answers for the hosts below and only to kadents.com, so it can't be used as an open relay.

const ALLOW_ORIGIN = 'https://kadents.com';
const ALLOWED_HOSTS = new Set(['mc.kadents.com']);
const CORS = { 'Access-Control-Allow-Origin': ALLOW_ORIGIN, 'Access-Control-Allow-Methods': 'GET,OPTIONS', Vary: 'Origin' };
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  try {
    const host = (new URL(request.url).searchParams.get('host') || '').toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return json({ error: 'host not allowed' }, 400);

    // Query a public API from the worker (server-side). This avoids CORS issues
    // and can bypass clients that block the public APIs or Minecraft port.
    const resp = await fetch(`https://api.mcsrvstat.us/2/${encodeURIComponent(host)}`, { cf: { cacheTtl: 10 } });
    return new Response(await resp.text(), {
      status: resp.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=10', ...CORS },
    });
  } catch {
    return json({ error: 'upstream error' }, 502);
  }
}
