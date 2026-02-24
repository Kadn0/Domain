Cloudflare Worker Minecraft Status Proxy

Overview
- This repo includes a simple Cloudflare Worker script `worker-mc-proxy.js` that proxies Minecraft server status requests to a server-side API.
- Deploy the worker and set `PROXY_URL` in `main.js` to the worker URL (e.g. `https://your-subdomain.workers.dev`).

Worker behavior
- Accepts a `host` query parameter (host or host:port).
- Forwards the request to `https://api.mcsrvstat.us/2/<host>` and returns the JSON response.

Deploy (quick)
1. Install Wrangler: `npm install -g wrangler`.
2. Authenticate and create a worker: `wrangler login`.
3. Publish: `wrangler publish worker-mc-proxy.js --name mc-status-proxy`.

Notes
- Cloudflare Workers are globally distributed and often reachable where some domains are blocked.
- If you cannot deploy a worker, you can deploy a small Node/Express server or use Vercel/Netlify functions instead. The worker code is the simplest serverless option.
