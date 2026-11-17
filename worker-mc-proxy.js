// Cloudflare Worker script: mc-status proxy
// Deploy this as a Worker and set PROXY_URL in main.js to the worker URL.
//
// Locked down on purpose: it only looks up the hosts in ALLOWED_HOSTS and only answers pages on ALLOWED_ORIGINS,
// so nobody else can use it as a free relay for their own lookups (and burn this account's Worker quota).

const ALLOWED_HOSTS = new Set(['serber.kadents.com', 'mc.kadents.com', 'play.kadents.com']);
const ALLOWED_ORIGINS = new Set(['https://kadents.com', 'https://www.kadents.com']);

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = { Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(request, body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(request), ...extra },
  });
}

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(request), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
    });
  }
  if (request.method !== 'GET') return json(request, { error: 'method not allowed' }, 405, { Allow: 'GET, OPTIONS' });

  const host = (new URL(request.url).searchParams.get('host') || '').trim().toLowerCase();
  if (!host) return json(request, { error: 'missing host' }, 400);
  if (!ALLOWED_HOSTS.has(host)) return json(request, { error: 'host not allowed' }, 403);

  try {
    // Query a public API from the worker (server-side). This avoids CORS issues
    // and can bypass clients that block the public APIs or Minecraft port.
    const resp = await fetch(`https://api.mcsrvstat.us/2/${encodeURIComponent(host)}`, { cf: { cacheTtl: 10 } });
    if (!resp.ok) return json(request, { error: 'upstream error' }, 502);
    return new Response(await resp.text(), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=10', ...corsHeaders(request) },
    });
  } catch {
    // never echo the internal error message back to the caller
    return json(request, { error: 'upstream unreachable' }, 502);
  }
}
