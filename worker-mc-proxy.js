// Cloudflare Worker script: mc-status proxy
// Deploy this as a Worker and set PROXY_URL in main.js to the worker URL.

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  // Respond to CORS preflight quickly
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    if (!host) return new Response(JSON.stringify({ error: 'missing host' }), { status: 400 });

    // Query a public API from the worker (server-side). This avoids CORS issues
    // and can bypass clients that block the public APIs or Minecraft port.
    const apiUrl = `https://api.mcsrvstat.us/2/${encodeURIComponent(host)}`;
    const resp = await fetch(apiUrl, { cf: { cacheTtl: 10 } });
    const text = await resp.text();

    return new Response(text, {
      status: resp.status,
      headers: {
        'content-type': resp.headers.get('content-type') || 'application/json',
        'cache-control': 'public, max-age=10',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
