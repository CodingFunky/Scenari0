// Cloudflare Worker — multi-source proxy for Scenari0.
//
// Why this exists: the app is a static client-side site, so it has no server
// and no env vars. Putting API keys in browser JS would expose them publicly.
// This Worker holds each provider's key in a server-side secret, injects it the
// way that provider expects, and adds CORS so the browser app can call it.
//
// Routes:
//   /competitions/*  -> football-data.org   (auth: X-Auth-Token header, secret FOOTBALL_DATA_KEY)
//   /odds/*          -> The Odds API        (auth: apiKey query param,   secret ODDS_API_KEY)
//
// Deploy (CLI):
//   npm i -g wrangler
//   wrangler login
//   wrangler secret put FOOTBALL_DATA_KEY   # paste your football-data.org key
//   wrangler secret put ODDS_API_KEY        # paste your The Odds API key
//   wrangler deploy
// Then paste the Worker URL into the app's ⚙ Sync settings field.

const ROUTES = [
  {
    prefix: '/competitions',
    upstream: 'https://api.football-data.org/v4',
    strip: false,                  // keep /competitions in the forwarded path
    secret: 'FOOTBALL_DATA_KEY',
    auth: { type: 'header', name: 'X-Auth-Token' },
  },
  {
    prefix: '/odds',
    upstream: 'https://api.the-odds-api.com/v4',
    strip: true,                   // strip /odds before forwarding
    secret: 'ODDS_API_KEY',
    auth: { type: 'query', name: 'apiKey' },
  },
];

// Tighten this to your GitHub Pages origin in production, e.g. 'https://you.github.io'.
const ALLOW_ORIGIN = '*';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    const route = ROUTES.find(
      r => url.pathname === r.prefix || url.pathname.startsWith(r.prefix + '/')
    );
    if (!route) return json({ error: 'Path not allowed' }, 403);

    // Per-IP rate limit (Cloudflare Rate Limiting binding). Enforced before any
    // upstream call, so over-limit requests never touch your API quota. Keyed by
    // IP + route so a burst on one provider doesn't block the other. Guarded so
    // the Worker still runs if the binding isn't configured. Best-effort per
    // Cloudflare data center. NOTE: this caps a single visitor — it does NOT
    // enforce a global monthly budget (that's the KV-counter approach).
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: `${ip}:${route.prefix}` });
      if (!success) {
        return json({ error: 'Rate limit exceeded — please wait a minute and try again.' }, 429);
      }
    }

    const key = env[route.secret];
    if (!key) return json({ error: `Proxy is missing the ${route.secret} secret` }, 500);

    const path = route.strip ? url.pathname.slice(route.prefix.length) : url.pathname;
    const upstreamUrl = new URL(route.upstream + path);
    upstreamUrl.search = url.search;

    const headers = { Accept: 'application/json' };
    if (route.auth.type === 'header') {
      headers[route.auth.name] = key;
    } else {
      upstreamUrl.searchParams.set(route.auth.name, key);
    }

    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamUrl.toString(), { headers });
    } catch (err) {
      return json({ error: 'Upstream fetch failed: ' + err.message }, 502);
    }

    const body = await upstreamRes.text();
    return new Response(body, {
      status: upstreamRes.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
